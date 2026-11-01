// SPDX-License-Identifier: AGPL-3.0-only
//
// Plays game haptics on a wired DualSense's actuators, which Windows exposes as
// channels 3 and 4 of the controller's USB audio device.

#ifndef HARGAN_HAPTICS_H
#define HARGAN_HAPTICS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define HAPTIC_INPUT_RATE 3000
#define HAPTIC_OUTPUT_RATE 48000
#define HAPTIC_UPSAMPLE (HAPTIC_OUTPUT_RATE / HAPTIC_INPUT_RATE)

void haptics_start(void);
void haptics_stop(void);

// True while the audio endpoint is open; false means fall back to rumble motors.
bool haptics_active(void);

// One stream packet of interleaved stereo s16 at HAPTIC_INPUT_RATE.
void haptics_push(const int16_t *stereo, size_t frames, float gain);

// Linear upsampling into quad frames with only the haptic channels set. `last`
// carries the final input frame between packets. Exposed for tests.
void haptics_upsample(const int16_t *stereo, size_t frames, float gain, int16_t last[2], int16_t *quad);

// Mean level of a packet as a 0-255 motor value, for controllers without the
// audio path. Exposed for tests.
uint8_t haptics_to_motor(const int16_t *stereo, size_t frames, float gain);

#endif
