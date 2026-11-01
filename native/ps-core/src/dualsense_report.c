// SPDX-License-Identifier: AGPL-3.0-only

#include "dualsense_report.h"

#include <math.h>
#include <string.h>

#define INPUT_USB_ID 0x01
#define INPUT_BT_ID 0x31
#define INPUT_MIN_PAYLOAD 40

#define OUTPUT_USB_ID 0x02
#define OUTPUT_BT_ID 0x31
#define OUTPUT_BT_TAG 0x10
#define OUTPUT_BT_CRC_SEED 0xa2

#define SPEAKER_VOLUME 0x64
#define SPEAKER_PATH 0x30
#define SPEAKER_PREAMP 0x02

// Nominal sensor sensitivity, used when the controller reports no calibration.
#define GYRO_COUNTS_PER_DEG_S 16.4f
#define ACCEL_COUNTS_PER_G 8192.0f
#define DEG_TO_RAD 0.017453292f

static int16_t read_i16(const uint8_t *p)
{
	return (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static void parse_touch(const uint8_t *p, DsTouch *t)
{
	t->active = (p[0] & 0x80) == 0;
	t->id = p[0] & 0x7f;
	t->x = (uint16_t)(p[1] | ((p[2] & 0x0f) << 8));
	t->y = (uint16_t)((p[2] >> 4) | (p[3] << 4));
}

bool ds_parse_input(const uint8_t *report, size_t size, DsInput *out)
{
	size_t offset;
	if(size == 0)
		return false;
	if(report[0] == INPUT_USB_ID)
		offset = 1;
	else if(report[0] == INPUT_BT_ID)
		offset = 2;
	else
		return false;
	if(size < offset + INPUT_MIN_PAYLOAD)
		return false;

	const uint8_t *p = report + offset;
	out->left_x = p[0];
	out->left_y = p[1];
	out->right_x = p[2];
	out->right_y = p[3];
	out->l2 = p[4];
	out->r2 = p[5];
	out->hat = p[7] & 0x0f;
	out->buttons[0] = p[7] & 0xf0;
	out->buttons[1] = p[8];
	out->buttons[2] = p[9];
	for(int i = 0; i < 3; i++)
	{
		out->gyro[i] = read_i16(p + 15 + i * 2);
		out->accel[i] = read_i16(p + 21 + i * 2);
	}
	parse_touch(p + 32, &out->touch[0]);
	parse_touch(p + 36, &out->touch[1]);
	return true;
}

void ds_default_calibration(DsCalibration *out)
{
	for(int i = 0; i < 3; i++)
	{
		out->gyro_scale[i] = DEG_TO_RAD / GYRO_COUNTS_PER_DEG_S;
		out->accel_scale[i] = 1.0f / ACCEL_COUNTS_PER_G;
		out->accel_bias[i] = 0.0f;
	}
}

void ds_parse_calibration(const uint8_t *report, size_t size, DsCalibration *out)
{
	ds_default_calibration(out);
	if(size < DS_CALIBRATION_SIZE || report[0] != DS_CALIBRATION_REPORT)
		return;

	const uint8_t *p = report + 1;
	float speed_2x = (float)read_i16(p + 18) + (float)read_i16(p + 20);
	for(int i = 0; i < 3; i++)
	{
		// Factory values: the counts measured at +speed and -speed on each axis.
		float range = (float)read_i16(p + 6 + i * 4) - (float)read_i16(p + 8 + i * 4);
		if(range != 0.0f && speed_2x != 0.0f)
			out->gyro_scale[i] = (speed_2x / range) * DEG_TO_RAD;

		float plus = (float)read_i16(p + 22 + i * 4);
		float minus = (float)read_i16(p + 24 + i * 4);
		float span = plus - minus;
		if(span != 0.0f)
		{
			out->accel_bias[i] = plus - span / 2.0f;
			out->accel_scale[i] = 2.0f / span;
		}
	}
}

uint8_t ds_player_bits(uint8_t player_index)
{
	static const uint8_t patterns[] = { 0x04, 0x0a, 0x15, 0x1b, 0x1f };
	if(player_index == 0)
		return 0;
	if(player_index > sizeof(patterns))
		return patterns[sizeof(patterns) - 1];
	return patterns[player_index - 1];
}

uint32_t ds_crc32(uint32_t seed, const uint8_t *data, size_t size)
{
	uint32_t crc = seed;
	for(size_t i = 0; i < size; i++)
	{
		crc ^= data[i];
		for(int bit = 0; bit < 8; bit++)
			crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)-(int32_t)(crc & 1));
	}
	return crc;
}

int16_t ds_stick_axis(uint8_t raw)
{
	int value = ((int)raw - 128) * 32767 / 127;
	if(value > 32767)
		value = 32767;
	if(value < -32768)
		value = -32768;
	return (int16_t)value;
}

static void write_common(const DsOutput *o, uint8_t *c)
{
	if(o->fields & DS_OUT_RUMBLE)
	{
		c[0] |= 0x03;
		c[2] = o->rumble_right;
		c[3] = o->rumble_left;
	}
	if(o->fields & DS_OUT_TRIGGERS)
	{
		c[0] |= 0x0c;
		c[10] = o->trigger_right_mode;
		memcpy(c + 11, o->trigger_right, DS_TRIGGER_PARAMS);
		c[21] = o->trigger_left_mode;
		memcpy(c + 22, o->trigger_left, DS_TRIGGER_PARAMS);
	}
	if(o->fields & (DS_OUT_INTENSITY | DS_OUT_TRIGGERS))
	{
		c[1] |= 0x40;
		c[36] = o->intensity;
	}
	if(o->fields & DS_OUT_LED)
	{
		c[1] |= 0x04;
		memcpy(c + 44, o->led, 3);
	}
	if(o->fields & DS_OUT_PLAYER)
	{
		c[1] |= 0x10;
		c[43] = o->player_bits;
	}
	if(o->fields & DS_OUT_LIGHTBAR_SETUP)
	{
		// Releases the bar from the pairing animation so colours take effect.
		c[38] |= 0x02;
		c[41] = 0x02;
	}
	if(o->fields & DS_OUT_SPEAKER)
	{
		// Without this the USB audio goes to the headset jack and the speaker stays silent.
		c[0] |= 0xa0;
		c[1] |= 0x80;
		c[5] = SPEAKER_VOLUME;
		c[7] = SPEAKER_PATH;
		c[37] = SPEAKER_PREAMP;
	}
}

size_t ds_build_output(const DsOutput *output, bool bluetooth, uint8_t sequence, uint8_t *report)
{
	if(!bluetooth)
	{
		memset(report, 0, DS_USB_OUTPUT_SIZE);
		report[0] = OUTPUT_USB_ID;
		write_common(output, report + 1);
		return DS_USB_OUTPUT_SIZE;
	}

	memset(report, 0, DS_BT_OUTPUT_SIZE);
	report[0] = OUTPUT_BT_ID;
	report[1] = (uint8_t)(sequence << 4);
	report[2] = OUTPUT_BT_TAG;
	write_common(output, report + 3);

	// The controller drops Bluetooth reports whose checksum, seeded with the
	// HID transaction header, does not match.
	uint8_t header = OUTPUT_BT_CRC_SEED;
	uint32_t crc = ds_crc32(0xffffffffu, &header, 1);
	crc = ~ds_crc32(crc, report, DS_BT_OUTPUT_SIZE - 4);
	memcpy(report + DS_BT_OUTPUT_SIZE - 4, &crc, 4);
	return DS_BT_OUTPUT_SIZE;
}
