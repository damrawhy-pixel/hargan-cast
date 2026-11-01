// SPDX-License-Identifier: AGPL-3.0-only
//
// Byte-exact checks of the DualSense formats, runnable without a controller.

#include "dualsense.h"
#include "dualsense_report.h"
#include "haptics.h"

#include <chiaki/controller.h>

#include <math.h>
#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond) do { if(!(cond)) { printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #cond); failures++; } } while(0)

static void put_i16(uint8_t *p, int16_t v)
{
	p[0] = (uint8_t)v;
	p[1] = (uint8_t)((uint16_t)v >> 8);
}

static void fill_payload(uint8_t *p)
{
	p[0] = 128; p[1] = 0; p[2] = 255; p[3] = 128; // sticks
	p[4] = 200; p[5] = 50;                        // triggers
	p[7] = 0x22;                                  // hat east, cross
	p[8] = 0x21;                                  // L1, options
	p[9] = 0x03;                                  // PS, touchpad click
	put_i16(p + 15, 1024); put_i16(p + 17, -2048); put_i16(p + 19, 512);
	put_i16(p + 21, 0); put_i16(p + 23, 8192); put_i16(p + 25, -8192);
	// touch 0: id 5 at (1919, 1079); touch 1: lifted
	p[32] = 0x05; p[33] = 0x7f; p[34] = 0x77; p[35] = 0x43;
	p[36] = 0x80 | 0x06;
}

static void test_input(void)
{
	uint8_t usb[64] = { 0x01 }, bt[78] = { 0x31, 0x00 };
	fill_payload(usb + 1);
	fill_payload(bt + 2);

	DsInput a, b;
	CHECK(ds_parse_input(usb, sizeof(usb), &a));
	CHECK(ds_parse_input(bt, sizeof(bt), &b));
	CHECK(memcmp(&a, &b, sizeof(a)) == 0);

	uint8_t truncated[10] = { 0x01 };
	CHECK(!ds_parse_input(truncated, sizeof(truncated), &a));
	uint8_t other[64] = { 0x09 };
	CHECK(!ds_parse_input(other, sizeof(other), &a));

	ds_parse_input(usb, sizeof(usb), &a);
	CHECK(a.hat == 2);
	CHECK(a.gyro[0] == 1024 && a.gyro[1] == -2048 && a.gyro[2] == 512);
	CHECK(a.accel[1] == 8192 && a.accel[2] == -8192);
	CHECK(a.touch[0].active && a.touch[0].id == 5 && a.touch[0].x == 1919 && a.touch[0].y == 1079);
	CHECK(!a.touch[1].active && a.touch[1].id == 6);

	ChiakiControllerState s;
	dualsense_fill_state(&a, &s);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_CROSS);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_L1);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_OPTIONS);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_PS);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_TOUCHPAD);
	CHECK(s.buttons & CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT);
	CHECK(!(s.buttons & CHIAKI_CONTROLLER_BUTTON_DPAD_UP));
	CHECK(!(s.buttons & CHIAKI_CONTROLLER_BUTTON_MOON));
	CHECK(s.l2_state == 200 && s.r2_state == 50);
	CHECK(s.left_x == 0 && s.left_y == -32768);
	CHECK(s.right_x == 32767 && s.right_y == 0);
	CHECK(s.touches[0].id == 5 && s.touches[0].x == 1919);
	CHECK(s.touches[1].id == -1);

	static const struct { uint8_t hat; uint32_t want; } hats[] = {
		{ 0, CHIAKI_CONTROLLER_BUTTON_DPAD_UP },
		{ 1, CHIAKI_CONTROLLER_BUTTON_DPAD_UP | CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT },
		{ 3, CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN | CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT },
		{ 4, CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN },
		{ 5, CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN | CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT },
		{ 6, CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT },
		{ 7, CHIAKI_CONTROLLER_BUTTON_DPAD_UP | CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT },
		{ 8, 0 },
	};
	const uint32_t dpad = CHIAKI_CONTROLLER_BUTTON_DPAD_UP | CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN |
		CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT | CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT;
	for(size_t i = 0; i < sizeof(hats) / sizeof(hats[0]); i++)
	{
		DsInput in;
		memset(&in, 0, sizeof(in));
		in.hat = hats[i].hat;
		ChiakiControllerState st;
		dualsense_fill_state(&in, &st);
		CHECK((st.buttons & dpad) == hats[i].want);
	}
}

static void test_output(void)
{
	CHECK(ds_crc32(0xffffffffu, (const uint8_t *)"123456789", 9) == ~0xcbf43926u);

	DsOutput o;
	memset(&o, 0, sizeof(o));
	o.fields = DS_OUT_RUMBLE | DS_OUT_TRIGGERS | DS_OUT_LED | DS_OUT_PLAYER | DS_OUT_LIGHTBAR_SETUP;
	o.rumble_left = 0x11; o.rumble_right = 0x22;
	o.trigger_left_mode = 0x26; o.trigger_right_mode = 0x21;
	memset(o.trigger_left, 0xaa, DS_TRIGGER_PARAMS);
	memset(o.trigger_right, 0xbb, DS_TRIGGER_PARAMS);
	o.led[0] = 1; o.led[1] = 2; o.led[2] = 3;
	o.player_bits = ds_player_bits(2);
	o.intensity = 0x62;

	uint8_t usb[DS_USB_OUTPUT_SIZE];
	CHECK(ds_build_output(&o, false, 0, usb) == 48);
	CHECK(usb[0] == 0x02);
	CHECK(usb[1] == 0x0f);        // rumble + both triggers
	CHECK(usb[2] == 0x54);        // lights, player, intensity
	CHECK(usb[3] == 0x22 && usb[4] == 0x11);
	CHECK(usb[11] == 0x21 && usb[12] == 0xbb && usb[21] == 0xbb);
	CHECK(usb[22] == 0x26 && usb[23] == 0xaa && usb[32] == 0xaa);
	CHECK(usb[37] == 0x62);
	CHECK(usb[39] == 0x02 && usb[42] == 0x02);
	CHECK(usb[44] == 0x0a);
	CHECK(usb[45] == 1 && usb[46] == 2 && usb[47] == 3);

	uint8_t bt[DS_BT_OUTPUT_SIZE];
	CHECK(ds_build_output(&o, true, 9, bt) == 78);
	CHECK(bt[0] == 0x31 && bt[1] == 0x90 && bt[2] == 0x10);
	CHECK(memcmp(bt + 3, usb + 1, 47) == 0);
	uint8_t header = 0xa2;
	uint32_t crc = ~ds_crc32(ds_crc32(0xffffffffu, &header, 1), bt, 74), stored;
	memcpy(&stored, bt + 74, 4);
	CHECK(crc == stored);

	// Untouched fields stay zero, which tells the controller to leave them alone.
	DsOutput only;
	memset(&only, 0, sizeof(only));
	only.fields = DS_OUT_LED;
	ds_build_output(&only, false, 0, usb);
	CHECK(usb[1] == 0 && usb[2] == 0x04);

	CHECK(ds_player_bits(0) == 0 && ds_player_bits(1) == 0x04 && ds_player_bits(4) == 0x1b && ds_player_bits(9) == 0x1f);
}

static void test_calibration(void)
{
	DsCalibration c;
	ds_default_calibration(&c);
	CHECK(fabsf(c.gyro_scale[0] * 16.4f - 0.0174533f) < 1e-5f); // 16.4 counts = 1 deg/s
	CHECK(fabsf(c.accel_scale[2] * 8192 - 1.0f) < 1e-5f);

	uint8_t r[DS_CALIBRATION_SIZE] = { DS_CALIBRATION_REPORT };
	uint8_t *p = r + 1;
	for(int i = 0; i < 3; i++)
	{
		put_i16(p + 6 + i * 4, 8000);
		put_i16(p + 8 + i * 4, -8000);
		put_i16(p + 22 + i * 4, 8392);
		put_i16(p + 24 + i * 4, -7992);
	}
	put_i16(p + 18, 500); put_i16(p + 20, 500);
	ds_parse_calibration(r, sizeof(r), &c);

	// +-500 deg/s measured as +-8000 counts: exactly 16 counts per deg/s.
	CHECK(fabsf(16.0f * c.gyro_scale[0] * 57.29578f - 1.0f) < 1e-3f);
	CHECK(fabsf(c.accel_bias[0] - 200.0f) < 0.01f);
	CHECK(fabsf((8392.0f - 200.0f) * c.accel_scale[0] - 1.0f) < 1e-3f);

	uint8_t zero[DS_CALIBRATION_SIZE] = { DS_CALIBRATION_REPORT };
	ds_parse_calibration(zero, sizeof(zero), &c);
	CHECK(c.gyro_scale[1] > 0 && c.accel_scale[1] > 0);
}

static void test_haptics(void)
{
	int16_t in[4] = { 1600, -1600, 3200, 0 }, last[2] = { 0, 0 };
	int16_t quad[2 * HAPTIC_UPSAMPLE * 4];
	haptics_upsample(in, 2, 1.0f, last, quad);
	CHECK(HAPTIC_UPSAMPLE == 16);
	CHECK(quad[0] == 0 && quad[1] == 0);
	CHECK(quad[2] == 100 && quad[3] == -100);
	CHECK(quad[(HAPTIC_UPSAMPLE - 1) * 4 + 2] == 1600);
	CHECK(quad[(2 * HAPTIC_UPSAMPLE - 1) * 4 + 2] == 3200);
	CHECK(quad[(2 * HAPTIC_UPSAMPLE - 1) * 4 + 3] == 0);
	CHECK(last[0] == 3200 && last[1] == 0);

	int16_t loud[4] = { 32767, 32767, -32768, -32768 };
	last[0] = last[1] = 0;
	haptics_upsample(loud, 2, 2.0f, last, quad);
	CHECK(quad[(HAPTIC_UPSAMPLE - 1) * 4 + 2] == 32767);

	int16_t quiet[60] = { 0 };
	CHECK(haptics_to_motor(quiet, 30, 1.0f) == 0);
	CHECK(haptics_to_motor(loud, 2, 1.0f) == 255);
	int16_t mid[4] = { 12800, 0, -12800, 0 };
	CHECK(haptics_to_motor(mid, 2, 0.5f) == 50); // 12800 * 2 * 0.5 / 256
	CHECK(haptics_to_motor(mid, 2, 1.0f) == 100);
	CHECK(haptics_to_motor(mid, 2, 0.0f) == 0);
	CHECK(haptics_to_motor(mid, 0, 1.0f) == 0);
}

int main(void)
{
	test_input();
	test_output();
	test_calibration();
	test_haptics();
	printf(failures ? "%d FAILED\n" : "all passed\n", failures);
	return failures != 0;
}
