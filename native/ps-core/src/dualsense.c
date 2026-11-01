// SPDX-License-Identifier: AGPL-3.0-only

#include "dualsense.h"

#include <chiaki/orientation.h>
#include <chiaki/time.h>

#include <windows.h>
#include <hidsdi.h>
#include <process.h>
#include <setupapi.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SONY_VENDOR 0x054c
#define PRODUCT_DUALSENSE 0x0ce6
#define PRODUCT_DUALSENSE_EDGE 0x0df2
#define USB_INPUT_SIZE 64
#define READ_BUFFER_SIZE 128
#define MAX_OUTPUT_REPORT 1024
#define RESCAN_MS 1000
#define READ_TIMEOUT_MS 500

// DualSense L2/R2 clicks are analog here; everything else is a plain bitmask.
static const struct { uint8_t index, mask; uint32_t button; } BUTTON_MAP[] = {
	{ 0, 0x10, CHIAKI_CONTROLLER_BUTTON_BOX },
	{ 0, 0x20, CHIAKI_CONTROLLER_BUTTON_CROSS },
	{ 0, 0x40, CHIAKI_CONTROLLER_BUTTON_MOON },
	{ 0, 0x80, CHIAKI_CONTROLLER_BUTTON_PYRAMID },
	{ 1, 0x01, CHIAKI_CONTROLLER_BUTTON_L1 },
	{ 1, 0x02, CHIAKI_CONTROLLER_BUTTON_R1 },
	{ 1, 0x10, CHIAKI_CONTROLLER_BUTTON_SHARE },
	{ 1, 0x20, CHIAKI_CONTROLLER_BUTTON_OPTIONS },
	{ 1, 0x40, CHIAKI_CONTROLLER_BUTTON_L3 },
	{ 1, 0x80, CHIAKI_CONTROLLER_BUTTON_R3 },
	{ 2, 0x01, CHIAKI_CONTROLLER_BUTTON_PS },
	{ 2, 0x02, CHIAKI_CONTROLLER_BUTTON_TOUCHPAD },
};

static HANDLE read_handle = INVALID_HANDLE_VALUE;
static HANDLE write_handle = INVALID_HANDLE_VALUE;
static size_t output_length;
static bool bluetooth;
static DsCalibration calibration;

static HANDLE reader_thread, writer_thread;
static HANDLE writer_wake, read_done;
static volatile LONG running;

static CRITICAL_SECTION output_lock;
static DsOutput pending;
static uint8_t sequence;
static bool lock_ready;

static CRITICAL_SECTION motion_lock;
static ChiakiOrientationTracker orient;
static ChiakiAccelNewZero accel_zero, accel_now;
static float gyro_now[3];

static DualSenseStateCallback state_callback;
static DualSenseLinkCallback link_callback;

void dualsense_fill_state(const DsInput *in, ChiakiControllerState *state)
{
	chiaki_controller_state_set_idle(state);

	for(size_t i = 0; i < sizeof(BUTTON_MAP) / sizeof(BUTTON_MAP[0]); i++)
		if(in->buttons[BUTTON_MAP[i].index] & BUTTON_MAP[i].mask)
			state->buttons |= BUTTON_MAP[i].button;

	static const uint8_t HAT[8] = { 0x1, 0x9, 0x8, 0xa, 0x2, 0x6, 0x4, 0x5 }; // bit0 up, 1 down, 2 left, 3 right
	if(in->hat < 8)
	{
		uint8_t dirs = HAT[in->hat];
		if(dirs & 1) state->buttons |= CHIAKI_CONTROLLER_BUTTON_DPAD_UP;
		if(dirs & 2) state->buttons |= CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN;
		if(dirs & 4) state->buttons |= CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT;
		if(dirs & 8) state->buttons |= CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT;
	}

	state->l2_state = in->l2;
	state->r2_state = in->r2;
	state->left_x = ds_stick_axis(in->left_x);
	state->left_y = ds_stick_axis(in->left_y);
	state->right_x = ds_stick_axis(in->right_x);
	state->right_y = ds_stick_axis(in->right_y);

	for(int i = 0; i < 2; i++)
	{
		state->touches[i].id = in->touch[i].active ? (int8_t)in->touch[i].id : -1;
		state->touches[i].x = in->touch[i].x;
		state->touches[i].y = in->touch[i].y;
	}
}

static void update_motion(const DsInput *in, ChiakiControllerState *state)
{
	float gx = in->gyro[0] * calibration.gyro_scale[0];
	float gy = in->gyro[1] * calibration.gyro_scale[1];
	float gz = in->gyro[2] * calibration.gyro_scale[2];
	float ax = ((float)in->accel[0] - calibration.accel_bias[0]) * calibration.accel_scale[0];
	float ay = ((float)in->accel[1] - calibration.accel_bias[1]) * calibration.accel_scale[1];
	float az = ((float)in->accel[2] - calibration.accel_bias[2]) * calibration.accel_scale[2];

	EnterCriticalSection(&motion_lock);
	gyro_now[0] = gx;
	gyro_now[1] = gy;
	gyro_now[2] = gz;
	chiaki_accel_new_zero_set_active(&accel_now, ax, ay, az, true);
	chiaki_orientation_tracker_update(&orient, gx, gy, gz, ax, ay, az, &accel_zero, false,
		(uint32_t)chiaki_time_now_monotonic_us());
	chiaki_orientation_tracker_apply_to_controller_state(&orient, state);
	LeaveCriticalSection(&motion_lock);
}

void dualsense_reset_motion(void)
{
	if(!lock_ready)
		return;
	EnterCriticalSection(&motion_lock);
	chiaki_accel_new_zero_set_active(&accel_zero, accel_now.accel_x, accel_now.accel_y, accel_now.accel_z, false);
	chiaki_orientation_tracker_init(&orient);
	chiaki_orientation_tracker_update(&orient, gyro_now[0], gyro_now[1], gyro_now[2],
		accel_now.accel_x, accel_now.accel_y, accel_now.accel_z, &accel_zero, false,
		(uint32_t)chiaki_time_now_monotonic_us());
	LeaveCriticalSection(&motion_lock);
}

// --- device discovery ------------------------------------------------------

static bool open_device(const wchar_t *path)
{
	HANDLE reader = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
		NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, NULL);
	if(reader == INVALID_HANDLE_VALUE)
		return false;

	HIDD_ATTRIBUTES attrs = { .Size = sizeof(attrs) };
	bool ours = HidD_GetAttributes(reader, &attrs) && attrs.VendorID == SONY_VENDOR &&
		(attrs.ProductID == PRODUCT_DUALSENSE || attrs.ProductID == PRODUCT_DUALSENSE_EDGE);
	if(!ours)
	{
		CloseHandle(reader);
		return false;
	}

	PHIDP_PREPARSED_DATA preparsed;
	HIDP_CAPS caps;
	if(!HidD_GetPreparsedData(reader, &preparsed))
	{
		CloseHandle(reader);
		return false;
	}
	NTSTATUS status = HidP_GetCaps(preparsed, &caps);
	HidD_FreePreparsedData(preparsed);
	if(status != HIDP_STATUS_SUCCESS || caps.Usage != 0x05 /* game pad */ || caps.OutputReportByteLength > MAX_OUTPUT_REPORT)
	{
		CloseHandle(reader);
		return false;
	}

	// Writes get their own handle so a pending read never delays them.
	HANDLE writer = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
		NULL, OPEN_EXISTING, 0, NULL);
	if(writer == INVALID_HANDLE_VALUE)
	{
		CloseHandle(reader);
		return false;
	}

	bluetooth = caps.InputReportByteLength != USB_INPUT_SIZE;
	output_length = caps.OutputReportByteLength;

	// Asking for this report also switches a Bluetooth pad to full reports.
	uint8_t feature[128] = { DS_CALIBRATION_REPORT };
	ULONG feature_size = caps.FeatureReportByteLength < sizeof(feature) ? caps.FeatureReportByteLength : sizeof(feature);
	if(HidD_GetFeature(reader, feature, feature_size))
		ds_parse_calibration(feature, feature_size, &calibration);
	else
		ds_default_calibration(&calibration);

	read_handle = reader;
	write_handle = writer;
	return true;
}

static bool route_device(const wchar_t *path)
{
	HANDLE device = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
		NULL, OPEN_EXISTING, 0, NULL);
	if(device == INVALID_HANDLE_VALUE)
		return false;

	HIDD_ATTRIBUTES attrs = { .Size = sizeof(attrs) };
	PHIDP_PREPARSED_DATA preparsed;
	HIDP_CAPS caps;
	bool wired = false;
	if(HidD_GetAttributes(device, &attrs) && attrs.VendorID == SONY_VENDOR &&
		(attrs.ProductID == PRODUCT_DUALSENSE || attrs.ProductID == PRODUCT_DUALSENSE_EDGE) &&
		HidD_GetPreparsedData(device, &preparsed))
	{
		wired = HidP_GetCaps(preparsed, &caps) == HIDP_STATUS_SUCCESS && caps.Usage == 0x05 /* game pad */ &&
			caps.InputReportByteLength == USB_INPUT_SIZE && caps.OutputReportByteLength == DS_USB_OUTPUT_SIZE;
		HidD_FreePreparsedData(preparsed);
	}

	bool routed = false;
	if(wired)
	{
		DsOutput out = { .fields = DS_OUT_SPEAKER };
		uint8_t report[DS_USB_OUTPUT_SIZE];
		ds_build_output(&out, false, 0, report);
		DWORD written;
		routed = WriteFile(device, report, DS_USB_OUTPUT_SIZE, &written, NULL) != 0;
	}
	CloseHandle(device);
	return routed;
}

static bool each_device(bool (*visit)(const wchar_t *path))
{
	GUID hid_guid;
	HidD_GetHidGuid(&hid_guid);
	HDEVINFO set = SetupDiGetClassDevsW(&hid_guid, NULL, NULL, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
	if(set == INVALID_HANDLE_VALUE)
		return false;

	bool found = false;
	SP_DEVICE_INTERFACE_DATA iface = { .cbSize = sizeof(iface) };
	for(DWORD i = 0; !found && SetupDiEnumDeviceInterfaces(set, NULL, &hid_guid, i, &iface); i++)
	{
		DWORD needed = 0;
		SetupDiGetDeviceInterfaceDetailW(set, &iface, NULL, 0, &needed, NULL);
		SP_DEVICE_INTERFACE_DETAIL_DATA_W *detail = malloc(needed);
		if(!detail)
			break;
		detail->cbSize = sizeof(*detail);
		if(SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, needed, NULL, NULL))
			found = visit(detail->DevicePath);
		free(detail);
	}
	SetupDiDestroyDeviceInfoList(set);
	return found;
}

static bool find_device(void)
{
	return each_device(open_device);
}

bool dualsense_route_speaker(void)
{
	return each_device(route_device);
}

static void close_device(void)
{
	if(read_handle != INVALID_HANDLE_VALUE)
		CloseHandle(read_handle);
	if(write_handle != INVALID_HANDLE_VALUE)
		CloseHandle(write_handle);
	read_handle = write_handle = INVALID_HANDLE_VALUE;
}

// --- threads ---------------------------------------------------------------

static void queue_output(const DsOutput *change)
{
	if(!lock_ready)
		return;
	EnterCriticalSection(&output_lock);
	if(change->fields & DS_OUT_RUMBLE)
	{
		pending.rumble_left = change->rumble_left;
		pending.rumble_right = change->rumble_right;
	}
	if(change->fields & DS_OUT_TRIGGERS)
	{
		pending.trigger_left_mode = change->trigger_left_mode;
		pending.trigger_right_mode = change->trigger_right_mode;
		memcpy(pending.trigger_left, change->trigger_left, DS_TRIGGER_PARAMS);
		memcpy(pending.trigger_right, change->trigger_right, DS_TRIGGER_PARAMS);
	}
	if(change->fields & DS_OUT_LED)
		memcpy(pending.led, change->led, 3);
	if(change->fields & DS_OUT_PLAYER)
		pending.player_bits = change->player_bits;
	if(change->fields & DS_OUT_INTENSITY)
		pending.intensity = change->intensity;
	pending.fields |= change->fields;
	LeaveCriticalSection(&output_lock);
	SetEvent(writer_wake);
}

static void flush_output(void)
{
	EnterCriticalSection(&output_lock);
	DsOutput out = pending;
	pending.fields = 0;
	LeaveCriticalSection(&output_lock);
	if(!out.fields || write_handle == INVALID_HANDLE_VALUE)
		return;

	uint8_t report[MAX_OUTPUT_REPORT] = { 0 };
	ds_build_output(&out, bluetooth, sequence, report);
	sequence = (sequence + 1) & 0x0f;
	DWORD written;
	WriteFile(write_handle, report, (DWORD)output_length, &written, NULL);
}

static unsigned __stdcall writer_main(void *arg)
{
	while(InterlockedCompareExchange(&running, 0, 0))
	{
		WaitForSingleObject(writer_wake, INFINITE);
		flush_output();
	}
	return 0;
}

static unsigned __stdcall reader_main(void *arg)
{
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);

	while(InterlockedCompareExchange(&running, 0, 0))
	{
		if(!find_device())
		{
			Sleep(RESCAN_MS);
			continue;
		}

		link_callback(bluetooth ? "bluetooth" : "usb");
		DsOutput hello = { 0 };
		hello.fields = DS_OUT_LIGHTBAR_SETUP;
		queue_output(&hello);

		uint8_t buffer[READ_BUFFER_SIZE];
		OVERLAPPED overlapped = { 0 };
		overlapped.hEvent = read_done;

		while(InterlockedCompareExchange(&running, 0, 0))
		{
			DWORD got = 0;
			ResetEvent(read_done);
			if(!ReadFile(read_handle, buffer, sizeof(buffer), NULL, &overlapped) && GetLastError() != ERROR_IO_PENDING)
				break;
			if(WaitForSingleObject(read_done, READ_TIMEOUT_MS) != WAIT_OBJECT_0)
			{
				CancelIoEx(read_handle, &overlapped);
				GetOverlappedResult(read_handle, &overlapped, &got, TRUE);
				continue;
			}
			if(!GetOverlappedResult(read_handle, &overlapped, &got, FALSE))
				break;

			DsInput input;
			if(!ds_parse_input(buffer, got, &input))
				continue;
			ChiakiControllerState state;
			dualsense_fill_state(&input, &state);
			update_motion(&input, &state);
			state_callback(&state);
		}

		link_callback(NULL);
		close_device();
	}
	return 0;
}

void dualsense_start(DualSenseStateCallback state_cb, DualSenseLinkCallback link_cb)
{
	if(InterlockedCompareExchange(&running, 1, 0) != 0)
		return;
	if(!lock_ready)
	{
		InitializeCriticalSection(&output_lock);
		InitializeCriticalSection(&motion_lock);
		writer_wake = CreateEvent(NULL, FALSE, FALSE, NULL);
		read_done = CreateEvent(NULL, TRUE, FALSE, NULL);
		lock_ready = true;
	}
	state_callback = state_cb;
	link_callback = link_cb;
	memset(&pending, 0, sizeof(pending));
	chiaki_orientation_tracker_init(&orient);
	chiaki_accel_new_zero_set_inactive(&accel_zero, false);
	chiaki_accel_new_zero_set_inactive(&accel_now, true);

	reader_thread = (HANDLE)_beginthreadex(NULL, 0, reader_main, NULL, 0, NULL);
	writer_thread = (HANDLE)_beginthreadex(NULL, 0, writer_main, NULL, 0, NULL);
}

void dualsense_stop(void)
{
	if(InterlockedCompareExchange(&running, 0, 0) == 0)
		return;

	// Hand the controller back with nothing left stuck on it.
	DsOutput off = { 0 };
	off.fields = DS_OUT_RUMBLE | DS_OUT_TRIGGERS | DS_OUT_LED | DS_OUT_PLAYER;
	off.trigger_left_mode = off.trigger_right_mode = 0x05;
	off.led[2] = 0x40;
	queue_output(&off);
	Sleep(30);

	InterlockedExchange(&running, 0);
	SetEvent(writer_wake);
	WaitForSingleObject(writer_thread, INFINITE);
	WaitForSingleObject(reader_thread, INFINITE);
	CloseHandle(writer_thread);
	CloseHandle(reader_thread);
}

void dualsense_set_rumble(uint8_t left, uint8_t right)
{
	DsOutput o = { 0 };
	o.fields = DS_OUT_RUMBLE;
	o.rumble_left = left;
	o.rumble_right = right;
	queue_output(&o);
}

void dualsense_set_triggers(uint8_t left_mode, const uint8_t *left, uint8_t right_mode, const uint8_t *right)
{
	DsOutput o = { 0 };
	o.fields = DS_OUT_TRIGGERS;
	o.trigger_left_mode = left_mode;
	o.trigger_right_mode = right_mode;
	memcpy(o.trigger_left, left, DS_TRIGGER_PARAMS);
	memcpy(o.trigger_right, right, DS_TRIGGER_PARAMS);
	queue_output(&o);
}

void dualsense_set_led(const uint8_t *rgb)
{
	DsOutput o = { 0 };
	o.fields = DS_OUT_LED;
	memcpy(o.led, rgb, 3);
	queue_output(&o);
}

void dualsense_set_player(uint8_t player_index)
{
	DsOutput o = { 0 };
	o.fields = DS_OUT_PLAYER;
	o.player_bits = ds_player_bits(player_index);
	queue_output(&o);
}

void dualsense_set_intensity(uint8_t intensity)
{
	DsOutput o = { 0 };
	o.fields = DS_OUT_INTENSITY;
	o.intensity = intensity;
	queue_output(&o);
}
