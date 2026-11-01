// SPDX-License-Identifier: AGPL-3.0-only
//
// DualSense wire formats, free of any OS or device code so they can be tested.

#ifndef HARGAN_DUALSENSE_REPORT_H
#define HARGAN_DUALSENSE_REPORT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define DS_USB_OUTPUT_SIZE 48
#define DS_BT_OUTPUT_SIZE 78
#define DS_TRIGGER_PARAMS 10
#define DS_CALIBRATION_REPORT 0x05
#define DS_CALIBRATION_SIZE 41

typedef struct
{
	bool active;
	uint8_t id;
	uint16_t x, y;
} DsTouch;

typedef struct
{
	uint8_t left_x, left_y, right_x, right_y;
	uint8_t l2, r2;
	uint8_t hat;          // 0 = up, clockwise to 7; 8 = released
	uint8_t buttons[3];
	int16_t gyro[3];      // pitch, yaw, roll
	int16_t accel[3];
	DsTouch touch[2];
} DsInput;

// Scale factors from the controller's factory calibration.
typedef struct
{
	float gyro_scale[3];  // raw -> rad/s
	float accel_scale[3]; // raw -> g
	float accel_bias[3];  // raw
} DsCalibration;

enum
{
	DS_OUT_RUMBLE = 1 << 0,
	DS_OUT_TRIGGERS = 1 << 1,
	DS_OUT_LED = 1 << 2,
	DS_OUT_PLAYER = 1 << 3,
	DS_OUT_INTENSITY = 1 << 4,
	DS_OUT_LIGHTBAR_SETUP = 1 << 5,
	DS_OUT_SPEAKER = 1 << 6
};

typedef struct
{
	uint32_t fields;      // DS_OUT_*: only these are applied by the controller
	uint8_t rumble_left, rumble_right;
	uint8_t trigger_left_mode, trigger_right_mode;
	uint8_t trigger_left[DS_TRIGGER_PARAMS], trigger_right[DS_TRIGGER_PARAMS];
	uint8_t led[3];
	uint8_t player_bits;
	uint8_t intensity;    // high nibble: triggers, low nibble: rumble
} DsOutput;

// Accepts USB report 0x01 and Bluetooth report 0x31.
bool ds_parse_input(const uint8_t *report, size_t size, DsInput *out);

void ds_parse_calibration(const uint8_t *report, size_t size, DsCalibration *out);
void ds_default_calibration(DsCalibration *out);

// Writes a complete output report and returns its length.
size_t ds_build_output(const DsOutput *output, bool bluetooth, uint8_t sequence, uint8_t *report);

uint8_t ds_player_bits(uint8_t player_index);
uint32_t ds_crc32(uint32_t seed, const uint8_t *data, size_t size);
int16_t ds_stick_axis(uint8_t raw);

#endif
