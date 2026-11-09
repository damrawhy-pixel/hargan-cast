// SPDX-License-Identifier: AGPL-3.0-only
//
// hargan-ps core for the phone apps. Same commands, replies and media as the
// desktop sidecar (../src/main.c), which stays as it is. Left out here is what only
// the desktop has: its own DualSense driver and haptics output (a phone hands its
// controllers to the app) and HTTP through Chromium (curl reaches Sony directly).

#include "hargan_ps.h"

#include "controller_io.h"
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

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifdef __ANDROID__
#include <android/log.h>
#else
#include <os/log.h>
#endif

#define THREAD_STACK (2 * 1024 * 1024)

typedef enum { CODEC_FAMILY_H264, CODEC_FAMILY_H265 } CodecFamily;

typedef struct
{
	int id;
	char *service, *game, *npsso, *country, *lang, *game_lang, *owned_ent, *owned_platform;
	char *datacenter, *prior_datacenters;
	bool foreign, attr_passed, hevc, ps_chord;
	int resolution, bitrate, packet_loss_max;
} StreamRequest;

typedef struct
{
	int id;
	char *npsso, *locale, *cache_dir;
	bool force;
} CatalogRequest;

static pthread_mutex_t start_lock = PTHREAD_MUTEX_INITIALIZER;
static bool started;
static int media_port;
static char media_token[33];
static char default_cache_dir[1024];

static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;
static HcEmitFn emit_fn;
static void *emit_user;
static ChiakiLog core_log;

static ChiakiSession session;
static ChiakiOpusDecoder opus;
static atomic_int stream_busy;
static atomic_int session_live;
static atomic_int stop_requested;
static atomic_int key_frame_needed;

static pthread_mutex_t input_lock = PTHREAD_MUTEX_INITIALIZER;
static ChiakiControllerState renderer_state;

static pthread_mutex_t quit_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t quit_cond = PTHREAD_COND_INITIALIZER;
static bool quit_flag;

static uint32_t audio_channels = 2;
static uint32_t audio_rate = 48000;
static bool audio_format_sent;
static CodecFamily stream_codec;
static uint8_t *video_header;
static size_t video_header_size;

// --- plumbing ----------------------------------------------------------------

static void on_log(ChiakiLogLevel level, const char *msg, void *user)
{
#ifdef __ANDROID__
	int priority = level == CHIAKI_LOG_ERROR ? ANDROID_LOG_ERROR : level == CHIAKI_LOG_WARNING ? ANDROID_LOG_WARN : ANDROID_LOG_INFO;
	__android_log_print(priority, "HarganPS", "%s", msg);
#else
	os_log(OS_LOG_DEFAULT, "HarganPS [%c] %s", chiaki_log_level_char(level), msg);
#endif
}

static void emit_line(const char *line, size_t size)
{
	pthread_mutex_lock(&out_lock);
	if(emit_fn)
		emit_fn(line, size, emit_user);
	pthread_mutex_unlock(&out_lock);
}

static void emit(json_object *o)
{
	const char *s = json_object_to_json_string_ext(o, JSON_C_TO_STRING_PLAIN);
	emit_line(s, strlen(s));
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

// The NPSSO is a session secret; it does not outlive the request that used it.
static void wipe(char *s)
{
	if(!s)
		return;
	volatile char *p = s;
	while(*p)
		*p++ = 0;
}

static bool spawn(void *(*fn)(void *), void *arg)
{
	pthread_attr_t attr;
	pthread_attr_init(&attr);
	pthread_attr_setstacksize(&attr, THREAD_STACK);
	pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
	pthread_t thread;
	bool ok = pthread_create(&thread, &attr, fn, arg) == 0;
	pthread_attr_destroy(&attr);
	return ok;
}

static void quit_signal(void)
{
	pthread_mutex_lock(&quit_lock);
	quit_flag = true;
	pthread_cond_broadcast(&quit_cond);
	pthread_mutex_unlock(&quit_lock);
}

static void quit_reset(void)
{
	pthread_mutex_lock(&quit_lock);
	quit_flag = false;
	pthread_mutex_unlock(&quit_lock);
}

static void quit_wait(void)
{
	pthread_mutex_lock(&quit_lock);
	while(!quit_flag)
		pthread_cond_wait(&quit_cond, &quit_lock);
	pthread_mutex_unlock(&quit_lock);
}

// --- catalog -------------------------------------------------------------------

static void *catalog_thread(void *arg)
{
	CatalogRequest *req = arg;
	ChiakiCloudCatalogConfig cfg = { 0 };
	cfg.npsso = req->npsso;
	cfg.locale = req->locale;
	cfg.cache_dir = req->cache_dir[0] ? req->cache_dir : default_cache_dir;
	cfg.force_refresh = req->force;

	ChiakiCloudCatalogResult res;
	memset(&res, 0, sizeof(res));
	chiaki_cloudcatalog_fetch_unified(&cfg, &res, &core_log);
	if(res.json)
	{
		// The payload is already JSON; splice it in rather than reparsing megabytes.
		size_t capacity = strlen(res.json) + 64;
		char *line = malloc(capacity);
		if(line)
		{
			int size = snprintf(line, capacity, "{\"id\":%d,\"ok\":true,\"catalog\":%s}", req->id, res.json);
			emit_line(line, (size_t)size);
			free(line);
		}
		else
			emit_reply_error(req->id, "Katalog için bellek yetmedi");
	}
	else
		emit_reply_error(req->id, res.error_message ? res.error_message : chiaki_error_string(res.err));

	chiaki_cloudcatalog_result_fini(&res);
	wipe(req->npsso);
	free(req->npsso);
	free(req->locale);
	free(req->cache_dir);
	free(req);
	return NULL;
}

// --- media callbacks -------------------------------------------------------------

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

	// Parameter sets arrive as a standalone sample; WebCodecs needs them in-band on
	// every key chunk of an annex-b stream, so keep them around.
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
	if(!nal.has_key && atomic_exchange(&key_frame_needed, 0))
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
	// Audio can start before the app's socket connects, so the format is announced
	// from here until it actually got queued for a client.
	if(!audio_format_sent)
	{
		uint32_t head[2] = { audio_rate, audio_channels };
		audio_format_sent = media_server_send(MEDIA_AUDIO_FORMAT, (const uint8_t *)head, sizeof(head), NULL, 0);
	}
	media_server_send(MEDIA_AUDIO_PCM, NULL, 0, (const uint8_t *)buf, samples * audio_channels * sizeof(int16_t));
}

static void on_input(const uint8_t *buf, size_t size, void *user)
{
	// Report 2: the decoder lost sync and needs a clean key frame.
	if(size == 1 && buf[0] == 2)
	{
		atomic_store(&key_frame_needed, 1);
		return;
	}
	ChiakiControllerState state;
	if(!controller_report_decode(buf, size, &state))
		return;
	pthread_mutex_lock(&input_lock);
	renderer_state = state;
	if(atomic_load(&session_live))
		chiaki_session_set_controller_state(&session, &renderer_state);
	pthread_mutex_unlock(&input_lock);
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
			// The app rumbles the controller it reads; there is no driver of our own here.
			uint8_t head[2] = { event->rumble.left, event->rumble.right };
			media_server_send(MEDIA_RUMBLE, head, sizeof(head), NULL, 0);
			break;
		}
		case CHIAKI_EVENT_QUIT:
		{
			json_object *o = json_object_new_object();
			json_object_object_add(o, "ev", json_object_new_string("quit"));
			json_object_object_add(o, "reason", json_object_new_string(chiaki_quit_reason_string(event->quit.reason)));
			json_object_object_add(o, "detail", json_object_new_string(event->quit.reason_str ? event->quit.reason_str : ""));
			json_object_object_add(o, "error", json_object_new_boolean(chiaki_quit_reason_is_error(event->quit.reason)));
			emit(o);
			quit_signal();
			break;
		}
		default:
			break;
	}
}

// --- streaming -----------------------------------------------------------------

static void on_progress(const char *stage, void *user)
{
	emit_event("progress", "stage", stage);
}

static bool is_cancelled(void *user)
{
	return atomic_load(&stop_requested) != 0;
}

static void free_request(StreamRequest *r)
{
	wipe(r->npsso);
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

static void reply_failure(json_object *reply, const char *message)
{
	json_object_object_add(reply, "ok", json_object_new_boolean(0));
	json_object_object_add(reply, "error", json_object_new_string(message));
	emit(reply);
}

static void *stream_thread(void *arg)
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
		reply_failure(reply, res.error_message ? res.error_message : chiaki_error_string(err));
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
		reply_failure(reply, chiaki_error_string(err));
		goto done;
	}

	chiaki_session_set_ps_chord(&session, req->ps_chord, 0);

	chiaki_opus_decoder_init(&opus, &core_log);
	chiaki_opus_decoder_set_cb(&opus, on_audio_settings, on_audio_frame, NULL);
	ChiakiAudioSink sink;
	chiaki_opus_decoder_get_sink(&opus, &sink);
	chiaki_session_set_audio_sink(&session, &sink);
	chiaki_session_set_video_sample_cb(&session, on_video, NULL);
	chiaki_session_set_event_cb(&session, on_event, NULL);

	quit_reset();
	err = chiaki_session_start(&session);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		reply_failure(reply, chiaki_error_string(err));
		chiaki_opus_decoder_fini(&opus);
		chiaki_session_fini(&session);
		goto done;
	}

	pthread_mutex_lock(&input_lock);
	chiaki_controller_state_set_idle(&renderer_state);
	atomic_store(&session_live, 1);
	pthread_mutex_unlock(&input_lock);

	json_object_object_add(reply, "ok", json_object_new_boolean(1));
	json_object_object_add(reply, "codec", json_object_new_string(req->hevc ? "h265" : "h264"));
	json_object_object_add(reply, "width", json_object_new_int((int)info.video_profile.width));
	json_object_object_add(reply, "height", json_object_new_int((int)info.video_profile.height));
	emit(reply);

	// A stop that came in while the session was being set up still counts.
	if(atomic_load(&stop_requested))
		quit_signal();
	quit_wait();

	pthread_mutex_lock(&input_lock);
	atomic_store(&session_live, 0);
	pthread_mutex_unlock(&input_lock);
	chiaki_session_stop(&session);
	chiaki_session_join(&session);
	chiaki_opus_decoder_fini(&opus);
	chiaki_session_fini(&session);
	media_server_send(MEDIA_RESET, NULL, 0, NULL, 0);

done:
	chiaki_cloud_provision_result_fini(&res);
	free_request(req);
	atomic_store(&stop_requested, 0);
	atomic_store(&stream_busy, 0);
	return NULL;
}

// --- commands ------------------------------------------------------------------

static void reply_flag(int id, const char *key, bool value)
{
	json_object *reply = json_object_new_object();
	json_object_object_add(reply, "id", json_object_new_int(id));
	json_object_object_add(reply, "ok", json_object_new_boolean(1));
	json_object_object_add(reply, key, json_object_new_boolean(value));
	emit(reply);
}

void hc_core_command(const char *line)
{
	json_object *cmd = json_tokener_parse(line);
	if(!cmd)
		return;
	json_object *jname;
	const char *name = json_object_object_get_ex(cmd, "cmd", &jname) ? json_object_get_string(jname) : "";
	int id = int_field(cmd, "id", 0);

	if(strcmp(name, "catalog") == 0)
	{
		CatalogRequest *r = calloc(1, sizeof(*r));
		r->id = id;
		r->npsso = dup_field(cmd, "npsso");
		r->locale = dup_field(cmd, "locale");
		r->cache_dir = dup_field(cmd, "cacheDir");
		r->force = bool_field(cmd, "force");
		if(!spawn(catalog_thread, r))
		{
			emit_reply_error(id, "Katalog başlatılamadı");
			wipe(r->npsso);
			free(r->npsso); free(r->locale); free(r->cache_dir); free(r);
		}
	}
	else if(strcmp(name, "stream") == 0)
	{
		int idle = 0;
		if(!atomic_compare_exchange_strong(&stream_busy, &idle, 1))
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
			r->ps_chord = bool_field(cmd, "psChord");
			r->packet_loss_max = int_field(cmd, "packetLossMax", 5);
			atomic_store(&stop_requested, 0);
			if(!spawn(stream_thread, r))
			{
				emit_reply_error(id, "Oturum başlatılamadı");
				free_request(r);
				atomic_store(&stream_busy, 0);
			}
		}
	}
	// The desktop's DualSense commands: a phone has no controller driver of its own.
	else if(strcmp(name, "hapticTest") == 0)
		reply_flag(id, "played", false);
	else if(strcmp(name, "speakerRoute") == 0)
		reply_flag(id, "routed", false);
	else if(strcmp(name, "stop") == 0)
	{
		atomic_store(&stop_requested, 1);
		quit_signal();
	}

	json_object_put(cmd);
}

// --- start -----------------------------------------------------------------------

bool hc_core_start(HcEmitFn emit, void *user, const char *cache_dir, const char *ca_bundle, int *port_out, char *token_out, size_t token_size)
{
	pthread_mutex_lock(&out_lock);
	emit_fn = emit;
	emit_user = user;
	pthread_mutex_unlock(&out_lock);

	pthread_mutex_lock(&start_lock);
	if(!started)
	{
		// A socket whose reader went away must not take the app down with it.
		signal(SIGPIPE, SIG_IGN);
		// curl on mbedTLS reads its trusted roots from here (see curl_http.c).
		if(ca_bundle && *ca_bundle)
			setenv("CHIAKI_CA_BUNDLE", ca_bundle, 1);
		snprintf(default_cache_dir, sizeof(default_cache_dir), "%s/ps-catalog", cache_dir ? cache_dir : ".");
		if(mkdir(default_cache_dir, 0700) != 0 && errno != EEXIST)
			on_log(CHIAKI_LOG_WARNING, "catalog cache folder could not be created", NULL);

		chiaki_log_init(&core_log, CHIAKI_LOG_INFO | CHIAKI_LOG_WARNING | CHIAKI_LOG_ERROR, on_log, NULL);
		uint16_t port = 0;
		if(chiaki_lib_init() == CHIAKI_ERR_SUCCESS
			&& curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK
			&& media_server_start(&port, media_token, sizeof(media_token)))
		{
			media_server_set_input_cb(on_input, NULL);
			media_port = port;
			started = true;
		}
	}
	bool ok = started;
	if(ok)
	{
		*port_out = media_port;
		snprintf(token_out, token_size, "%s", media_token);
	}
	pthread_mutex_unlock(&start_lock);
	return ok;
}
