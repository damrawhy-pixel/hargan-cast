// SPDX-License-Identifier: AGPL-3.0-only
//
// hargan-ps-core: PlayStation cloud sidecar.
//
// Control: one JSON object per line on stdin, one per line on stdout. Secrets
// (the NPSSO) only ever travel over stdin, never argv. Logs go to stderr.
// Media:   loopback WebSocket, see media_server.h.

#include "controller_io.h"
#include "curl_http.h"
#include "dualsense.h"
#include "haptics.h"
#include "media_server.h"

#include <chiaki/cloudcatalog.h>
#include <chiaki/cloudsession.h>
#include <chiaki/common.h>
#include <chiaki/log.h>
#include <chiaki/opusdecoder.h>
#include <chiaki/session.h>

#include <curl/curl.h>
#include <json-c/json_object.h>
#include <json-c/json_tokener.h>

#include <winsock2.h>
#include <windows.h>
#include <process.h>

#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum { CODEC_FAMILY_H264, CODEC_FAMILY_H265 } CodecFamily;

typedef struct
{
	int id;
	char *service, *game, *npsso, *country, *lang, *game_lang, *owned_ent, *owned_platform;
	char *datacenter, *prior_datacenters;
	bool foreign, attr_passed, hevc;
	bool native_dualsense, triggers, vibration, ps_chord;
	int resolution, bitrate, haptic_strength, packet_loss_max;
} StreamRequest;

typedef struct
{
	int id;
	char *npsso, *locale, *cache_dir;
	bool force;
} CatalogRequest;

static CRITICAL_SECTION out_lock;
static ChiakiLog core_log;

static ChiakiSession session;
static ChiakiOpusDecoder opus;
static volatile LONG stream_busy;
static volatile LONG session_live;
static volatile LONG stop_requested;
static volatile LONG key_frame_needed;

static CRITICAL_SECTION input_lock;
static ChiakiControllerState renderer_state, dualsense_state;
static float haptic_gain = 1.0f;
static bool haptic_motor_on;
static bool triggers_enabled = true;
static int trigger_intensity_bits, rumble_intensity_bits;
// The user's settings, applied on top of what the game asks for.
static float user_haptic_gain = 1.0f;
static bool user_triggers = true, user_vibration = true;
static bool use_native_dualsense;
static HANDLE quit_event;

static uint32_t audio_channels = 2;
static uint32_t audio_rate = 48000;
static bool audio_format_sent;
static CodecFamily stream_codec;
static uint8_t *video_header;
static size_t video_header_size;

static void on_log(ChiakiLogLevel level, const char *msg, void *user)
{
	EnterCriticalSection(&out_lock);
	fprintf(stderr, "[%c] %s\n", chiaki_log_level_char(level), msg);
	fflush(stderr);
	LeaveCriticalSection(&out_lock);
}

static void emit(json_object *o)
{
	const char *s = json_object_to_json_string_ext(o, JSON_C_TO_STRING_PLAIN);
	EnterCriticalSection(&out_lock);
	fputs(s, stdout);
	fputc('\n', stdout);
	fflush(stdout);
	LeaveCriticalSection(&out_lock);
	json_object_put(o);
}

static void emit_event(const char *name, const char *key, const char *value)
{
	json_object *o = json_object_new_object();
	json_object_object_add(o, "ev", json_object_new_string(name));
	if(key)
		json_object_object_add(o, key, json_object_new_string(value ? value : ""));
	emit(o);
}

static void emit_reply_error(int id, const char *message)
{
	json_object *o = json_object_new_object();
	json_object_object_add(o, "id", json_object_new_int(id));
	json_object_object_add(o, "ok", json_object_new_boolean(0));
	json_object_object_add(o, "error", json_object_new_string(message ? message : "Bilinmeyen hata"));
	emit(o);
}

static char *dup_field(json_object *cmd, const char *key)
{
	json_object *v;
	if(json_object_object_get_ex(cmd, key, &v) && json_object_is_type(v, json_type_string))
		return strdup(json_object_get_string(v));
	return strdup("");
}

static int int_field(json_object *cmd, const char *key, int fallback)
{
	json_object *v;
	return json_object_object_get_ex(cmd, key, &v) ? json_object_get_int(v) : fallback;
}

static bool bool_field(json_object *cmd, const char *key)
{
	json_object *v;
	return json_object_object_get_ex(cmd, key, &v) && json_object_get_boolean(v);
}

// --- HTTP via the app ------------------------------------------------------
//
// Every service request goes through Chromium's network stack in the main
// process: some networks and CDNs reject or stall libcurl's TLS handshake while
// the browser passes. Blocking from the caller's point of view, like libcurl.

#define HTTP_SLOTS 32
#define HTTP_DEFAULT_TIMEOUT_MS 30000
#define HTTP_REPLY_GRACE_MS 5000

typedef struct
{
	bool used;
	HANDLE done;
	CCHttpResponse *response;
	ChiakiErrorCode err;
} HttpSlot;

static CRITICAL_SECTION http_lock;
static HttpSlot http_slots[HTTP_SLOTS];

static ChiakiErrorCode http_via_app(ChiakiLog *log, const CCHttpRequest *request, CCHttpResponse *response)
{
	int rid = -1;
	EnterCriticalSection(&http_lock);
	for(int i = 0; i < HTTP_SLOTS; i++)
	{
		if(!http_slots[i].used)
		{
			rid = i;
			http_slots[i].used = true;
			http_slots[i].response = response;
			http_slots[i].err = CHIAKI_ERR_NETWORK;
			break;
		}
	}
	LeaveCriticalSection(&http_lock);
	if(rid < 0)
		return CHIAKI_ERR_OVERFLOW;

	long timeout = request->timeout_ms > 0 ? request->timeout_ms : HTTP_DEFAULT_TIMEOUT_MS;

	json_object *o = json_object_new_object();
	json_object_object_add(o, "ev", json_object_new_string("http"));
	json_object_object_add(o, "rid", json_object_new_int(rid));
	json_object_object_add(o, "method", json_object_new_string(request->method ? request->method : "GET"));
	json_object_object_add(o, "url", json_object_new_string(request->url));
	json_object_object_add(o, "follow", json_object_new_boolean(request->follow_redirects));
	json_object_object_add(o, "timeout", json_object_new_int((int)timeout));
	json_object *headers = json_object_new_array();
	for(size_t i = 0; i < request->header_count; i++)
		json_object_array_add(headers, json_object_new_string(request->headers[i]));
	json_object_object_add(o, "headers", headers);
	if(request->body)
		json_object_object_add(o, "body", json_object_new_string_len(request->body,
			(int)(request->body_len ? request->body_len : strlen(request->body))));
	emit(o);

	ResetEvent(http_slots[rid].done);
	ChiakiErrorCode err = WaitForSingleObject(http_slots[rid].done, (DWORD)timeout + HTTP_REPLY_GRACE_MS) == WAIT_OBJECT_0
		? http_slots[rid].err : CHIAKI_ERR_NETWORK;

	EnterCriticalSection(&http_lock);
	http_slots[rid].used = false;
	http_slots[rid].response = NULL;
	LeaveCriticalSection(&http_lock);

	if(err != CHIAKI_ERR_SUCCESS && log)
		CHIAKI_LOGE(log, "HTTP failed: %s", request->url);
	return err;
}

static char *string_field(json_object *cmd, const char *key, size_t *size_out)
{
	json_object *v;
	if(!json_object_object_get_ex(cmd, key, &v) || !json_object_is_type(v, json_type_string))
		return NULL;
	size_t size = (size_t)json_object_get_string_len(v);
	char *copy = malloc(size + 1);
	if(!copy)
		return NULL;
	memcpy(copy, json_object_get_string(v), size);
	copy[size] = 0;
	if(size_out)
		*size_out = size;
	return copy;
}

static void handle_http_reply(json_object *cmd)
{
	int rid = int_field(cmd, "rid", -1);
	if(rid < 0 || rid >= HTTP_SLOTS)
		return;
	EnterCriticalSection(&http_lock);
	HttpSlot *slot = &http_slots[rid];
	if(slot->used && slot->response)
	{
		if(int_field(cmd, "status", 0) > 0)
		{
			CCHttpResponse *r = slot->response;
			r->status_code = int_field(cmd, "status", 0);
			r->data = string_field(cmd, "body", &r->size);
			r->headers = string_field(cmd, "headers", &r->headers_size);
			r->redirect_url = string_field(cmd, "redirect", NULL);
			slot->err = CHIAKI_ERR_SUCCESS;
		}
		SetEvent(slot->done);
	}
	LeaveCriticalSection(&http_lock);
}

// --- catalog ---------------------------------------------------------------

static unsigned __stdcall catalog_thread(void *arg)
{
	CatalogRequest *req = arg;
	ChiakiCloudCatalogConfig cfg = { 0 };
	cfg.npsso = req->npsso;
	cfg.locale = req->locale;
	cfg.cache_dir = req->cache_dir;
	cfg.force_refresh = req->force;

	ChiakiCloudCatalogResult res;
	memset(&res, 0, sizeof(res));
	chiaki_cloudcatalog_fetch_unified(&cfg, &res, &core_log);
	if(res.json)
	{
		// The payload is already JSON; splice it in rather than reparsing megabytes.
		EnterCriticalSection(&out_lock);
		fprintf(stdout, "{\"id\":%d,\"ok\":true,\"catalog\":%s}\n", req->id, res.json);
		fflush(stdout);
		LeaveCriticalSection(&out_lock);
	}
	else
		emit_reply_error(req->id, res.error_message ? res.error_message : chiaki_error_string(res.err));

	chiaki_cloudcatalog_result_fini(&res);
	SecureZeroMemory(req->npsso, strlen(req->npsso));
	free(req->npsso);
	free(req->locale);
	free(req->cache_dir);
	free(req);
	return 0;
}

// --- media callbacks -------------------------------------------------------

typedef struct
{
	bool has_params, has_key, has_slice;
} NalScan;

// Walks start codes up to the first slice; anything after it is coded data.
static NalScan scan_nals(const uint8_t *b, size_t n, CodecFamily codec)
{
	NalScan r = { false, false, false };
	for(size_t i = 0; i + 4 < n; i++)
	{
		if(b[i] || b[i + 1] || b[i + 2] != 1)
			continue;
		uint8_t h = b[i + 3];
		if(codec == CODEC_FAMILY_H264)
		{
			uint8_t t = h & 0x1f;
			if(t == 7 || t == 8)
				r.has_params = true;
			else if(t >= 1 && t <= 5)
			{
				r.has_slice = true;
				r.has_key = t == 5;
				return r;
			}
		}
		else
		{
			uint8_t t = (h >> 1) & 0x3f;
			if(t >= 32 && t <= 34)
				r.has_params = true;
			else if(t <= 21)
			{
				r.has_slice = true;
				r.has_key = t >= 16;
				return r;
			}
		}
		i += 3;
	}
	return r;
}

static bool on_video(uint8_t *buf, size_t size, int32_t frames_lost, bool recovered, void *user)
{
	NalScan nal = scan_nals(buf, size, stream_codec);

	// The protocol library hands over parameter sets as a standalone sample. WebCodecs needs
	// them in-band on every key chunk of an annex-b stream, so keep them around.
	if(nal.has_params && !nal.has_slice)
	{
		uint8_t *copy = malloc(size);
		if(!copy)
			return true;
		memcpy(copy, buf, size);
		free(video_header);
		video_header = copy;
		video_header_size = size;
		return true;
	}

	// Returning false reports a corrupt frame, which makes the server send a key frame.
	if(!nal.has_key && InterlockedExchange(&key_frame_needed, 0))
		return false;

	uint8_t head[5] = { (uint8_t)(nal.has_key ? 1 : 0) };
	memcpy(head + 1, &frames_lost, 4);

	if(nal.has_key && !nal.has_params && video_header)
	{
		uint8_t *joined = malloc(video_header_size + size);
		if(!joined)
			return false;
		memcpy(joined, video_header, video_header_size);
		memcpy(joined + video_header_size, buf, size);
		bool ok = media_server_send(MEDIA_VIDEO, head, sizeof(head), joined, video_header_size + size);
		free(joined);
		return ok;
	}
	return media_server_send(MEDIA_VIDEO, head, sizeof(head), buf, size);
}

static void on_audio_settings(uint32_t channels, uint32_t rate, void *user)
{
	audio_channels = channels;
	audio_rate = rate;
	audio_format_sent = false;
}

static void on_audio_frame(int16_t *buf, size_t samples, void *user)
{
	// Audio can start before the renderer's socket connects, so the format is
	// announced from here until it actually got queued for a client.
	if(!audio_format_sent)
	{
		uint32_t head[2] = { audio_rate, audio_channels };
		audio_format_sent = media_server_send(MEDIA_AUDIO_FORMAT, (const uint8_t *)head, sizeof(head), NULL, 0);
	}
	media_server_send(MEDIA_AUDIO_PCM, NULL, 0, (const uint8_t *)buf, samples * audio_channels * sizeof(int16_t));
}

// Keyboard or other gamepads from the renderer and a physical DualSense can be
// active together, so every update sends the union of both.
static void publish_controller_state(void)
{
	if(!InterlockedCompareExchange(&session_live, 0, 0))
		return;
	ChiakiControllerState merged;
	chiaki_controller_state_or(&merged, &dualsense_state, &renderer_state);
	chiaki_session_set_controller_state(&session, &merged);
}

static void on_dualsense_state(const ChiakiControllerState *state)
{
	EnterCriticalSection(&input_lock);
	dualsense_state = *state;
	publish_controller_state();
	LeaveCriticalSection(&input_lock);
}

static void on_dualsense_link(const char *transport)
{
	json_object *o = json_object_new_object();
	json_object_object_add(o, "ev", json_object_new_string("dualsense"));
	if(transport)
		json_object_object_add(o, "transport", json_object_new_string(transport));
	emit(o);

	if(!transport)
	{
		EnterCriticalSection(&input_lock);
		chiaki_controller_state_set_idle(&dualsense_state);
		publish_controller_state();
		LeaveCriticalSection(&input_lock);
	}
}

static void on_input(const uint8_t *buf, size_t size, void *user)
{
	// Report 2: the decoder lost sync and needs a clean key frame.
	if(size == 1 && buf[0] == 2)
	{
		InterlockedExchange(&key_frame_needed, 1);
		return;
	}
	ChiakiControllerState state;
	if(!controller_report_decode(buf, size, &state))
		return;
	EnterCriticalSection(&input_lock);
	renderer_state = state;
	publish_controller_state();
	LeaveCriticalSection(&input_lock);
}

static void on_haptics(uint8_t *buf, size_t size, void *user)
{
	const int16_t *samples = (const int16_t *)buf;
	size_t frames = size / (2 * sizeof(int16_t));
	float gain = haptic_gain * user_haptic_gain;
	if(gain <= 0.0f)
		return;

	if(haptics_active())
	{
		haptics_push(samples, frames, gain);
		return;
	}

	// No audio path, as on Bluetooth: approximate the effect with the motors.
	uint8_t level = haptics_to_motor(samples, frames, gain);
	if(level || haptic_motor_on)
		dualsense_set_rumble(level, level);
	haptic_motor_on = level != 0;
}

static void apply_intensity(void)
{
	dualsense_set_intensity((uint8_t)(trigger_intensity_bits | rumble_intensity_bits));
}

static void on_event(ChiakiEvent *event, void *user)
{
	switch(event->type)
	{
		case CHIAKI_EVENT_CONNECTED:
			emit_event("connected", NULL, NULL);
			break;
		case CHIAKI_EVENT_RUMBLE:
		{
			if(!user_vibration)
				break;
			// The renderer only rumbles pads the core does not own itself.
			dualsense_set_rumble(event->rumble.left, event->rumble.right);
			uint8_t head[2] = { event->rumble.left, event->rumble.right };
			media_server_send(MEDIA_RUMBLE, head, sizeof(head), NULL, 0);
			break;
		}
		case CHIAKI_EVENT_TRIGGER_EFFECTS:
			if(triggers_enabled && user_triggers)
				dualsense_set_triggers(event->trigger_effects.type_left, event->trigger_effects.left,
					event->trigger_effects.type_right, event->trigger_effects.right);
			break;
		case CHIAKI_EVENT_LED_COLOR:
			dualsense_set_led(event->led_state);
			break;
		case CHIAKI_EVENT_PLAYER_INDEX:
			dualsense_set_player(event->player_index);
			break;
		case CHIAKI_EVENT_MOTION_RESET:
			dualsense_reset_motion();
			break;
		case CHIAKI_EVENT_HAPTIC_INTENSITY:
			switch(event->intensity)
			{
				case Off: haptic_gain = 0.0f; rumble_intensity_bits = 0x0f; break;
				case Weak: haptic_gain = 0.33f; rumble_intensity_bits = 0x03; break;
				case Medium: haptic_gain = 0.5f; rumble_intensity_bits = 0x02; break;
				default: haptic_gain = 1.0f; rumble_intensity_bits = 0x00; break;
			}
			apply_intensity();
			break;
		case CHIAKI_EVENT_TRIGGER_INTENSITY:
			triggers_enabled = event->intensity != Off;
			switch(event->intensity)
			{
				case Off: trigger_intensity_bits = 0xf0; break;
				case Weak: trigger_intensity_bits = 0x90; break;
				case Medium: trigger_intensity_bits = 0x60; break;
				default: trigger_intensity_bits = 0x00; break;
			}
			apply_intensity();
			break;
		case CHIAKI_EVENT_QUIT:
		{
			json_object *o = json_object_new_object();
			json_object_object_add(o, "ev", json_object_new_string("quit"));
			json_object_object_add(o, "reason", json_object_new_string(chiaki_quit_reason_string(event->quit.reason)));
			json_object_object_add(o, "detail", json_object_new_string(event->quit.reason_str ? event->quit.reason_str : ""));
			json_object_object_add(o, "error", json_object_new_boolean(chiaki_quit_reason_is_error(event->quit.reason)));
			emit(o);
			SetEvent(quit_event);
			break;
		}
		default:
			break;
	}
}

// --- streaming -------------------------------------------------------------

static void on_progress(const char *stage, void *user)
{
	emit_event("progress", "stage", stage);
}

static bool is_cancelled(void *user)
{
	return InterlockedCompareExchange(&stop_requested, 0, 0) != 0;
}

static void free_request(StreamRequest *r)
{
	SecureZeroMemory(r->npsso, strlen(r->npsso));
	free(r->service); free(r->game); free(r->npsso); free(r->country); free(r->lang);
	free(r->game_lang); free(r->owned_ent); free(r->owned_platform);
	free(r->datacenter); free(r->prior_datacenters);
	free(r);
}

static void video_profile_for(ChiakiConnectVideoProfile *p, int resolution, int bitrate, bool hevc)
{
	memset(p, 0, sizeof(*p));
	switch(resolution)
	{
		case 720: p->width = 1280; p->height = 720; break;
		case 1440: p->width = 2560; p->height = 1440; break;
		case 2160: p->width = 3840; p->height = 2160; break;
		default: p->width = 1920; p->height = 1080; break;
	}
	p->bitrate = (unsigned int)bitrate;
	p->max_fps = 60;
	p->codec = hevc ? CHIAKI_CODEC_H265 : CHIAKI_CODEC_H264;
}

static unsigned __stdcall stream_thread(void *arg)
{
	StreamRequest *req = arg;
	bool pscloud = strcmp(req->service, "pscloud") == 0;

	ChiakiCloudProvisionConfig cfg;
	memset(&cfg, 0, sizeof(cfg));
	cfg.service_type = req->service;
	cfg.game_identifier = req->game;
	cfg.npsso = req->npsso;
	cfg.store_country = req->country;
	cfg.store_lang = req->lang;
	cfg.game_language = req->game_lang;
	cfg.owned_entitlement_id = req->owned_ent;
	cfg.owned_platform = req->owned_platform;
	cfg.catalog_is_foreign = req->foreign;
	cfg.skip_account_attr_check = req->attr_passed;
	cfg.forced_datacenter = req->datacenter;
	cfg.prior_datacenters_json = req->prior_datacenters;
	cfg.resolution = req->resolution;
	cfg.bitrate_kbps = req->bitrate;
	cfg.progress = on_progress;
	cfg.is_cancelled = is_cancelled;

	ChiakiCloudProvisionResult res;
	ChiakiErrorCode err = chiaki_cloud_provision_session(&cfg, &res, &core_log);

	json_object *reply = json_object_new_object();
	json_object_object_add(reply, "id", json_object_new_int(req->id));
	if(res.datacenter_pings)
		json_object_object_add(reply, "datacenters", json_object_new_string(res.datacenter_pings));

	if(err != CHIAKI_ERR_SUCCESS)
	{
		json_object_object_add(reply, "ok", json_object_new_boolean(0));
		json_object_object_add(reply, "error", json_object_new_string(res.error_message ? res.error_message : chiaki_error_string(err)));
		emit(reply);
		goto done;
	}

	ChiakiConnectInfo info;
	memset(&info, 0, sizeof(info));
	info.ps5 = pscloud;
	info.host = res.server_ip;
	video_profile_for(&info.video_profile, req->resolution, req->bitrate, req->hevc);
	info.video_profile_auto_downgrade = true;
	info.enable_dualsense = true;
	info.packet_loss_max = (double)req->packet_loss_max / 100.0;
	info.service_type = pscloud ? CHIAKI_SERVICE_TYPE_PSCLOUD : CHIAKI_SERVICE_TYPE_PSNOW;
	info.cloud_launch_spec = res.launch_spec;
	info.cloud_handshake_key = res.handshake_key;
	info.cloud_session_id = res.session_id;
	info.cloud_port = (uint16_t)res.server_port;
	info.cloud_psn_wrapper_type = res.psn_wrapper_type;
	info.cloud_mtu_in = res.mtu_in;
	info.cloud_mtu_out = res.mtu_out;
	info.cloud_rtt_us = res.rtt_us;

	stream_codec = req->hevc ? CODEC_FAMILY_H265 : CODEC_FAMILY_H264;
	free(video_header);
	video_header = NULL;
	video_header_size = 0;

	err = chiaki_session_init(&session, &info, &core_log);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		json_object_object_add(reply, "ok", json_object_new_boolean(0));
		json_object_object_add(reply, "error", json_object_new_string(chiaki_error_string(err)));
		emit(reply);
		goto done;
	}

	chiaki_session_set_ps_chord(&session, req->ps_chord, 0);

	chiaki_opus_decoder_init(&opus, &core_log);
	chiaki_opus_decoder_set_cb(&opus, on_audio_settings, on_audio_frame, NULL);
	ChiakiAudioSink sink;
	chiaki_opus_decoder_get_sink(&opus, &sink);
	chiaki_session_set_audio_sink(&session, &sink);
	ChiakiAudioSink haptics_sink = { 0 };
	haptics_sink.frame_cb = on_haptics;
	chiaki_session_set_haptics_sink(&session, &haptics_sink);
	chiaki_session_set_video_sample_cb(&session, on_video, NULL);
	chiaki_session_set_event_cb(&session, on_event, NULL);

	ResetEvent(quit_event);
	err = chiaki_session_start(&session);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		json_object_object_add(reply, "ok", json_object_new_boolean(0));
		json_object_object_add(reply, "error", json_object_new_string(chiaki_error_string(err)));
		emit(reply);
		chiaki_opus_decoder_fini(&opus);
		chiaki_session_fini(&session);
		goto done;
	}

	chiaki_controller_state_set_idle(&renderer_state);
	chiaki_controller_state_set_idle(&dualsense_state);
	haptic_gain = 1.0f;
	haptic_motor_on = false;
	triggers_enabled = true;
	trigger_intensity_bits = rumble_intensity_bits = 0;
	user_haptic_gain = (float)req->haptic_strength / 100.0f;
	user_triggers = req->triggers;
	user_vibration = req->vibration;
	use_native_dualsense = req->native_dualsense;
	InterlockedExchange(&session_live, 1);
	if(use_native_dualsense)
	{
		haptics_start();
		dualsense_start(on_dualsense_state, on_dualsense_link);
	}

	json_object_object_add(reply, "ok", json_object_new_boolean(1));
	json_object_object_add(reply, "codec", json_object_new_string(req->hevc ? "h265" : "h264"));
	json_object_object_add(reply, "width", json_object_new_int((int)info.video_profile.width));
	json_object_object_add(reply, "height", json_object_new_int((int)info.video_profile.height));
	emit(reply);

	WaitForSingleObject(quit_event, INFINITE);

	if(use_native_dualsense)
	{
		dualsense_stop();
		haptics_stop();
	}
	InterlockedExchange(&session_live, 0);
	chiaki_session_stop(&session);
	chiaki_session_join(&session);
	chiaki_opus_decoder_fini(&opus);
	chiaki_session_fini(&session);
	media_server_send(MEDIA_RESET, NULL, 0, NULL, 0);

done:
	chiaki_cloud_provision_result_fini(&res);
	free_request(req);
	InterlockedExchange(&stop_requested, 0);
	InterlockedExchange(&stream_busy, 0);
	return 0;
}

#ifdef HARGAN_DIAG
// Test build only: replays a capture through the same media path a live session
// uses. File format: repeated [u32 little-endian size][sample], first sample being
// the parameter sets alone, exactly as the protocol library delivers them.
typedef struct
{
	char *path;
	bool hevc;
} DiagRequest;

static unsigned __stdcall diag_thread(void *arg)
{
	DiagRequest *req = arg;
	FILE *f = fopen(req->path, "rb");
	stream_codec = req->hevc ? CODEC_FAMILY_H265 : CODEC_FAMILY_H264;
	free(video_header);
	video_header = NULL;

	on_audio_settings(2, 48000, NULL);
	int16_t pcm[960];
	for(int i = 0; i < 960; i += 2)
		pcm[i] = pcm[i + 1] = (int16_t)((i % 96) * 300);

	int sent = 0, dropped = 0;
	uint32_t size;
	while(f && fread(&size, 4, 1, f) == 1)
	{
		uint8_t *buf = malloc(size);
		if(fread(buf, 1, size, f) != size)
			break;
		if(on_video(buf, size, 0, false, NULL))
			sent++;
		else
			dropped++;
		free(buf);
		on_audio_frame(pcm, 480, NULL);
		Sleep(16);
	}
	if(f)
		fclose(f);
	uint8_t rumble_head[2] = { 200, 100 };
	media_server_send(MEDIA_RUMBLE, rumble_head, 2, NULL, 0);
	Sleep(200);
	json_object *o = json_object_new_object();
	json_object_object_add(o, "ev", json_object_new_string("diag"));
	json_object_object_add(o, "sent", json_object_new_int(sent));
	json_object_object_add(o, "dropped", json_object_new_int(dropped));
	emit(o);
	media_server_send(MEDIA_RESET, NULL, 0, NULL, 0);
	free(req->path);
	free(req);
	return 0;
}
#endif

// --- commands --------------------------------------------------------------

static void handle_command(const char *line)
{
	json_object *cmd = json_tokener_parse(line);
	if(!cmd)
		return;
	json_object *jname;
	const char *name = json_object_object_get_ex(cmd, "cmd", &jname) ? json_object_get_string(jname) : "";
	int id = int_field(cmd, "id", 0);

	if(strcmp(name, "httpReply") == 0)
		handle_http_reply(cmd);
	else if(strcmp(name, "catalog") == 0)
	{
		CatalogRequest *r = calloc(1, sizeof(*r));
		r->id = id;
		r->npsso = dup_field(cmd, "npsso");
		r->locale = dup_field(cmd, "locale");
		r->cache_dir = dup_field(cmd, "cacheDir");
		r->force = bool_field(cmd, "force");
		CloseHandle((HANDLE)_beginthreadex(NULL, 0, catalog_thread, r, 0, NULL));
	}
	else if(strcmp(name, "stream") == 0)
	{
		if(InterlockedCompareExchange(&stream_busy, 1, 0) != 0)
			emit_reply_error(id, "Zaten aktif bir oturum var");
		else
		{
			StreamRequest *r = calloc(1, sizeof(*r));
			r->id = id;
			r->service = dup_field(cmd, "service");
			r->game = dup_field(cmd, "game");
			r->npsso = dup_field(cmd, "npsso");
			r->country = dup_field(cmd, "country");
			r->lang = dup_field(cmd, "lang");
			r->game_lang = dup_field(cmd, "gameLang");
			r->owned_ent = dup_field(cmd, "ownedEntitlement");
			r->owned_platform = dup_field(cmd, "ownedPlatform");
			r->datacenter = dup_field(cmd, "datacenter");
			r->prior_datacenters = dup_field(cmd, "priorDatacenters");
			r->foreign = bool_field(cmd, "foreign");
			r->attr_passed = bool_field(cmd, "attrPassed");
			r->hevc = bool_field(cmd, "hevc");
			r->resolution = int_field(cmd, "resolution", 1080);
			r->bitrate = int_field(cmd, "bitrate", 20000);
			r->native_dualsense = bool_field(cmd, "nativeDualSense");
			r->haptic_strength = int_field(cmd, "hapticStrength", 100);
			r->triggers = bool_field(cmd, "triggers");
			r->vibration = bool_field(cmd, "vibration");
			r->ps_chord = bool_field(cmd, "psChord");
			r->packet_loss_max = int_field(cmd, "packetLossMax", 5);
			CloseHandle((HANDLE)_beginthreadex(NULL, 0, stream_thread, r, 0, NULL));
		}
	}
#ifdef HARGAN_DIAG
	else if(strcmp(name, "diag") == 0)
	{
		DiagRequest *r = calloc(1, sizeof(*r));
		r->path = dup_field(cmd, "file");
		r->hevc = bool_field(cmd, "hevc");
		CloseHandle((HANDLE)_beginthreadex(NULL, 0, diag_thread, r, 0, NULL));
	}
#endif
	else if(strcmp(name, "stop") == 0)
	{
		InterlockedExchange(&stop_requested, 1);
		SetEvent(quit_event);
	}

	json_object_put(cmd);
}

int main(void)
{
	_setmode(_fileno(stdin), _O_BINARY);
	_setmode(_fileno(stdout), _O_BINARY);
	InitializeCriticalSection(&out_lock);
	InitializeCriticalSection(&input_lock);
	quit_event = CreateEvent(NULL, TRUE, FALSE, NULL);

	chiaki_log_init(&core_log, CHIAKI_LOG_INFO | CHIAKI_LOG_WARNING | CHIAKI_LOG_ERROR, on_log, NULL);
	if(chiaki_lib_init() != CHIAKI_ERR_SUCCESS)
		return 1;
	curl_global_init(CURL_GLOBAL_DEFAULT);

	InitializeCriticalSection(&http_lock);
	for(int i = 0; i < HTTP_SLOTS; i++)
		http_slots[i].done = CreateEvent(NULL, FALSE, FALSE, NULL);
	cc_http_set_transport(http_via_app);

	uint16_t port = 0;
	char token[33];
	if(!media_server_start(&port, token, sizeof(token)))
		return 2;
	media_server_set_input_cb(on_input, NULL);

	json_object *hello = json_object_new_object();
	json_object_object_add(hello, "ev", json_object_new_string("hello"));
	json_object_object_add(hello, "port", json_object_new_int(port));
	json_object_object_add(hello, "token", json_object_new_string(token));
	emit(hello);

	// Replies can carry whole catalog pages, so the line buffer has to grow.
	size_t capacity = 64 * 1024, used = 0;
	char *line = malloc(capacity);
	int c;
	while((c = getchar()) != EOF)
	{
		if(c != '\n')
		{
			if(used + 1 >= capacity)
			{
				capacity *= 2;
				char *grown = realloc(line, capacity);
				if(!grown)
					return 3;
				line = grown;
			}
			line[used++] = (char)c;
			continue;
		}
		line[used] = 0;
		handle_command(line);
		used = 0;
	}

	// stdin closes when the app exits; end a running session properly, then follow it.
	InterlockedExchange(&stop_requested, 1);
	SetEvent(quit_event);
	for(int waited = 0; waited < 2000 && InterlockedCompareExchange(&stream_busy, 0, 0); waited += 50)
		Sleep(50);
	return 0;
}
