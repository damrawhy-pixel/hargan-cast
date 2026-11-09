// SPDX-License-Identifier: AGPL-3.0-only
//
// The PlayStation core as a library, for the phone apps. It speaks the same JSON
// messages as the desktop sidecar (native/ps-core/src/main.c): commands in through
// hc_core_command, replies and events out through the callback. Media and controller
// input use the same loopback WebSocket, so the app's stream worker is unchanged.

#ifndef HARGAN_PS_H
#define HARGAN_PS_H

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** One reply or event, a complete JSON object. Called from the core's own threads. */
typedef void (*HcEmitFn)(const char *line, size_t size, void *user);

/**
 * Starts the core once per process; later calls only replace the callback and
 * report the same socket again.
 * cache_dir: where the catalog keeps its cache.
 * ca_bundle: PEM file of trusted roots for curl, or NULL where the OS verifies TLS.
 * token_out receives the socket's path secret, at least 33 bytes.
 */
bool hc_core_start(HcEmitFn emit, void *user, const char *cache_dir, const char *ca_bundle, int *port_out, char *token_out, size_t token_size);

/** One command: catalog, stream or stop, with the desktop's fields. */
void hc_core_command(const char *line);

/**
 * What the game asks of the controller, for the app to play on the one the
 * phone has paired. Called from the session's threads.
 *   HC_FEEDBACK_RESET     no data: the stream ended, stop everything
 *   HC_FEEDBACK_RUMBLE    [left (low frequency), right (high frequency)], 0-255
 *   HC_FEEDBACK_TRIGGERS  [type_left, left[10], type_right, right[10]], DualSense effect bytes
 *   HC_FEEDBACK_LIGHT     [red, green, blue]
 */
enum
{
	HC_FEEDBACK_RESET = 0,
	HC_FEEDBACK_RUMBLE = 1,
	HC_FEEDBACK_TRIGGERS = 2,
	HC_FEEDBACK_LIGHT = 3
};
typedef void (*HcFeedbackFn)(int kind, const unsigned char *data, size_t size, void *user);
void hc_core_set_feedback(HcFeedbackFn feedback, void *user);

/**
 * One motion sample from the controller, already in the console's axes
 * (x right, y up, z toward the player): gyro in rad/s, acceleration in g as
 * the reaction to gravity (about +1 on y at rest). Feed at about 60 Hz.
 */
void hc_core_motion(float gyro_x, float gyro_y, float gyro_z, float accel_x, float accel_y, float accel_z, unsigned long long timestamp_us);

/** The motion source changed or went away; the next sample starts a fresh estimate. */
void hc_core_motion_reset(void);

#ifdef __cplusplus
}
#endif

#endif
