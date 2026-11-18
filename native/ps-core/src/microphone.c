// The player's microphone in Remote Play, for party and game chat. The page
// captures it and sends 10 ms frames over the media socket; here they become
// Opus packets on the session's audio channel, the way the console's own
// Remote Play app sends them. Shared by the desktop and the phone cores.

#include "microphone.h"
#include <chiaki/audio.h>
#include <chiaki/opusencoder.h>
#include <chiaki/thread.h>
#include <stdbool.h>
#include <string.h>

static ChiakiMutex lock;
static ChiakiLog *mic_log;
static ChiakiOpusEncoder encoder;
static bool open;

void mic_init(ChiakiLog *log)
{
	mic_log = log;
	chiaki_mutex_init(&lock, false);
	memset(&encoder, 0, sizeof(encoder));
	chiaki_opus_encoder_init(&encoder, log);
}

void mic_frame(ChiakiSession *session, const uint8_t *pcm, size_t size)
{
	if(size != MIC_FRAME_BYTES || !mic_log)
		return;
	chiaki_mutex_lock(&lock);
	if(!open)
	{
		if(chiaki_session_connect_microphone(session) != CHIAKI_ERR_SUCCESS)
		{
			chiaki_mutex_unlock(&lock);
			return;
		}
		chiaki_session_toggle_microphone(session, false);
		ChiakiAudioHeader header;
		chiaki_audio_header_set(&header, 1, 16, MIC_FRAME_SAMPLES * 100, MIC_FRAME_SAMPLES);
		chiaki_opus_encoder_header(&header, &encoder, session);
		open = true;
		CHIAKI_LOGI(mic_log, "microphone connected");
	}
	// The socket's bytes need not be aligned for int16 access.
	int16_t samples[MIC_FRAME_SAMPLES];
	memcpy(samples, pcm, sizeof(samples));
	chiaki_opus_encoder_frame(samples, &encoder);
	chiaki_mutex_unlock(&lock);
}

void mic_close(void)
{
	if(!mic_log)
		return;
	chiaki_mutex_lock(&lock);
	if(open)
	{
		chiaki_opus_encoder_fini(&encoder);
		memset(&encoder, 0, sizeof(encoder));
		chiaki_opus_encoder_init(&encoder, mic_log);
		open = false;
	}
	chiaki_mutex_unlock(&lock);
}
