// SPDX-License-Identifier: AGPL-3.0-only
//
// Loopback WebSocket that carries media to the renderer's stream worker and
// controller input back. Exactly one authenticated client at a time.

#ifndef HARGAN_MEDIA_SERVER_H
#define HARGAN_MEDIA_SERVER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum
{
	MEDIA_VIDEO = 1,       // u8 flags (bit0 = key frame), u32 frames_lost, annex-b payload
	MEDIA_AUDIO_FORMAT = 2,// u32 sample rate, u32 channels
	MEDIA_AUDIO_PCM = 3,   // interleaved s16le
	MEDIA_RUMBLE = 4,      // u8 left, u8 right
	MEDIA_RESET = 6        // stream ended; flush decoders
} MediaType;

typedef void (*MediaInputCallback)(const uint8_t *buf, size_t size, void *user);

bool media_server_start(uint16_t *port_out, char *token_out, size_t token_size);
void media_server_set_input_cb(MediaInputCallback cb, void *user);

// Queues one message. Video returns false when the client lags behind, which
// requests a fresh key frame instead of letting latency pile up.
bool media_server_send(MediaType type, const uint8_t *head, size_t head_size, const uint8_t *body, size_t body_size);

// True once a client completed the handshake.
bool media_server_has_client(void);

#endif
