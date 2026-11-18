#pragma once
#include <chiaki/log.h>
#include <chiaki/session.h>
#include <stddef.h>
#include <stdint.h>

/** One microphone frame from the page: 10 ms of 48 kHz mono, 16-bit little-endian. */
#define MIC_FRAME_SAMPLES 480
#define MIC_FRAME_BYTES (MIC_FRAME_SAMPLES * 2)
/** Its type byte on the media socket, ahead of the samples. */
#define MIC_REPORT 3

void mic_init(ChiakiLog *log);

/** Encodes a frame and sends it to the console, opening the microphone channel on the first one. */
void mic_frame(ChiakiSession *session, const uint8_t *pcm, size_t size);

/** The session ended: the next one opens its own channel. */
void mic_close(void);
