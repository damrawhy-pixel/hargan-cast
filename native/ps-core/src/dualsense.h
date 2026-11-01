// SPDX-License-Identifier: AGPL-3.0-only
//
// Owns a physical DualSense for the length of a stream: reads it straight from
// HID, so input never passes through the renderer, and drives its rumble,
// adaptive triggers and lights.

#ifndef HARGAN_DUALSENSE_H
#define HARGAN_DUALSENSE_H

#include "dualsense_report.h"

#include <chiaki/controller.h>

#include <stdbool.h>
#include <stdint.h>

typedef void (*DualSenseStateCallback)(const ChiakiControllerState *state);
// transport is "usb", "bluetooth", or NULL once the controller is gone.
typedef void (*DualSenseLinkCallback)(const char *transport);

void dualsense_start(DualSenseStateCallback state_cb, DualSenseLinkCallback link_cb);
void dualsense_stop(void);

void dualsense_set_rumble(uint8_t left, uint8_t right);
void dualsense_set_triggers(uint8_t left_mode, const uint8_t *left, uint8_t right_mode, const uint8_t *right);
void dualsense_set_led(const uint8_t *rgb);
void dualsense_set_player(uint8_t player_index);
void dualsense_set_intensity(uint8_t intensity);
void dualsense_reset_motion(void);

// Translates a parsed report; exposed for tests.
void dualsense_fill_state(const DsInput *in, ChiakiControllerState *state);

#endif
