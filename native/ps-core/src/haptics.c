// SPDX-License-Identifier: AGPL-3.0-only

#define COBJMACROS
#include "haptics.h"

#include <initguid.h>
#include <windows.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <process.h>

#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define CHANNELS 4
#define QUEUE_FRAMES (HAPTIC_OUTPUT_RATE / 4)
#define BUFFER_HNS 400000 // 40 ms
#define PUMP_MS 4
#define RETRY_MS 2000
#define MOTOR_FLOOR 8 // quieter than this, the motors stay off

#define MOTOR_SCALE 2

static const GUID PCM_SUBTYPE = { 0x00000001, 0x0000, 0x0010, { 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71 } };

static HANDLE thread;
static volatile LONG running, active;
static CRITICAL_SECTION lock;
static bool lock_ready;
static int16_t queue[QUEUE_FRAMES * CHANNELS];
static size_t q_read, q_count;
static int16_t last_frame[2];

static int16_t clamp16(float v)
{
	if(v > 32767.0f)
		return 32767;
	if(v < -32768.0f)
		return -32768;
	return (int16_t)v;
}

void haptics_upsample(const int16_t *stereo, size_t frames, float gain, int16_t last[2], int16_t *quad)
{
	for(size_t i = 0; i < frames; i++)
	{
		for(int step = 0; step < HAPTIC_UPSAMPLE; step++)
		{
			float t = (float)(step + 1) / HAPTIC_UPSAMPLE;
			int16_t *out = quad + (i * HAPTIC_UPSAMPLE + (size_t)step) * CHANNELS;
			out[0] = out[1] = 0;
			out[2] = clamp16(((float)last[0] + ((float)stereo[i * 2] - last[0]) * t) * gain);
			out[3] = clamp16(((float)last[1] + ((float)stereo[i * 2 + 1] - last[1]) * t) * gain);
		}
		last[0] = stereo[i * 2];
		last[1] = stereo[i * 2 + 1];
	}
}

uint8_t haptics_to_motor(const int16_t *stereo, size_t frames, float gain)
{
	if(frames == 0)
		return 0;
	uint64_t sum_left = 0, sum_right = 0;
	for(size_t i = 0; i < frames; i++)
	{
		sum_left += (uint64_t)abs(stereo[i * 2]);
		sum_right += (uint64_t)abs(stereo[i * 2 + 1]);
	}
	uint64_t mean = (sum_left > sum_right ? sum_left : sum_right) / frames;
	float level = (float)mean * MOTOR_SCALE * gain / 256.0f;
	if(level < MOTOR_FLOOR)
		return 0;
	return level > 255.0f ? 255 : (uint8_t)level;
}

void haptics_push(const int16_t *stereo, size_t frames, float gain)
{
	if(!InterlockedCompareExchange(&active, 0, 0) || frames * HAPTIC_UPSAMPLE > QUEUE_FRAMES)
		return;

	size_t produced = frames * HAPTIC_UPSAMPLE;
	int16_t *quad = malloc(produced * CHANNELS * sizeof(int16_t));
	if(!quad)
		return;
	haptics_upsample(stereo, frames, gain, last_frame, quad);

	EnterCriticalSection(&lock);
	// A stale rumble feels worse than a dropped one: keep only the newest audio.
	if(q_count + produced > QUEUE_FRAMES)
	{
		size_t drop = q_count + produced - QUEUE_FRAMES;
		q_read = (q_read + drop) % QUEUE_FRAMES;
		q_count -= drop;
	}
	size_t write = (q_read + q_count) % QUEUE_FRAMES;
	for(size_t i = 0; i < produced; i++)
		memcpy(queue + ((write + i) % QUEUE_FRAMES) * CHANNELS, quad + i * CHANNELS, CHANNELS * sizeof(int16_t));
	q_count += produced;
	LeaveCriticalSection(&lock);
	free(quad);
}

bool haptics_active(void)
{
	return InterlockedCompareExchange(&active, 0, 0) != 0;
}

static bool is_dualsense(IMMDevice *device)
{
	IPropertyStore *props;
	if(FAILED(IMMDevice_OpenPropertyStore(device, STGM_READ, &props)))
		return false;
	PROPVARIANT name;
	PropVariantInit(&name);
	bool match = false;
	if(SUCCEEDED(IPropertyStore_GetValue(props, &PKEY_Device_FriendlyName, &name)) && name.vt == VT_LPWSTR)
		match = wcsstr(name.pwszVal, L"DualSense") != NULL;
	PropVariantClear(&name);
	IPropertyStore_Release(props);
	return match;
}

static IMMDevice *find_endpoint(void)
{
	IMMDeviceEnumerator *enumerator;
	if(FAILED(CoCreateInstance(&CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, &IID_IMMDeviceEnumerator, (void **)&enumerator)))
		return NULL;

	IMMDevice *found = NULL;
	IMMDeviceCollection *devices;
	if(SUCCEEDED(IMMDeviceEnumerator_EnumAudioEndpoints(enumerator, eRender, DEVICE_STATE_ACTIVE, &devices)))
	{
		UINT count = 0;
		IMMDeviceCollection_GetCount(devices, &count);
		for(UINT i = 0; i < count && !found; i++)
		{
			IMMDevice *device;
			if(FAILED(IMMDeviceCollection_Item(devices, i, &device)))
				continue;
			if(is_dualsense(device))
				found = device;
			else
				IMMDevice_Release(device);
		}
		IMMDeviceCollection_Release(devices);
	}
	IMMDeviceEnumerator_Release(enumerator);
	return found;
}

static void pump(IAudioClient *client, IAudioRenderClient *render, UINT32 capacity)
{
	while(InterlockedCompareExchange(&running, 0, 0))
	{
		UINT32 padding = 0;
		if(FAILED(IAudioClient_GetCurrentPadding(client, &padding)))
			return; // unplugged
		UINT32 room = capacity - padding;

		EnterCriticalSection(&lock);
		UINT32 frames = q_count < room ? (UINT32)q_count : room;
		BYTE *data;
		if(frames && SUCCEEDED(IAudioRenderClient_GetBuffer(render, frames, &data)))
		{
			for(UINT32 i = 0; i < frames; i++)
				memcpy(data + i * CHANNELS * sizeof(int16_t), queue + ((q_read + i) % QUEUE_FRAMES) * CHANNELS, CHANNELS * sizeof(int16_t));
			IAudioRenderClient_ReleaseBuffer(render, frames, 0);
			q_read = (q_read + frames) % QUEUE_FRAMES;
			q_count -= frames;
		}
		LeaveCriticalSection(&lock);
		Sleep(PUMP_MS);
	}
}

static void run_endpoint(IMMDevice *device)
{
	IAudioClient *client;
	if(FAILED(IMMDevice_Activate(device, &IID_IAudioClient, CLSCTX_ALL, NULL, (void **)&client)))
		return;

	WAVEFORMATEXTENSIBLE format = { 0 };
	format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
	format.Format.nChannels = CHANNELS;
	format.Format.nSamplesPerSec = HAPTIC_OUTPUT_RATE;
	format.Format.wBitsPerSample = 16;
	format.Format.nBlockAlign = CHANNELS * sizeof(int16_t);
	format.Format.nAvgBytesPerSec = HAPTIC_OUTPUT_RATE * format.Format.nBlockAlign;
	format.Format.cbSize = sizeof(format) - sizeof(format.Format);
	format.Samples.wValidBitsPerSample = 16;
	format.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
	format.SubFormat = PCM_SUBTYPE;

	DWORD flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
	IAudioRenderClient *render = NULL;
	UINT32 capacity = 0;
	if(SUCCEEDED(IAudioClient_Initialize(client, AUDCLNT_SHAREMODE_SHARED, flags, BUFFER_HNS, 0, (WAVEFORMATEX *)&format, NULL)) &&
		SUCCEEDED(IAudioClient_GetBufferSize(client, &capacity)) &&
		SUCCEEDED(IAudioClient_GetService(client, &IID_IAudioRenderClient, (void **)&render)) &&
		SUCCEEDED(IAudioClient_Start(client)))
	{
		InterlockedExchange(&active, 1);
		pump(client, render, capacity);
		InterlockedExchange(&active, 0);
		IAudioClient_Stop(client);
	}
	if(render)
		IAudioRenderClient_Release(render);
	IAudioClient_Release(client);
}

static unsigned __stdcall haptics_main(void *arg)
{
	CoInitializeEx(NULL, COINIT_MULTITHREADED);
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);

	while(InterlockedCompareExchange(&running, 0, 0))
	{
		IMMDevice *device = find_endpoint();
		if(device)
		{
			run_endpoint(device);
			IMMDevice_Release(device);
		}
		for(int waited = 0; waited < RETRY_MS && InterlockedCompareExchange(&running, 0, 0); waited += 100)
			Sleep(100);
	}
	CoUninitialize();
	return 0;
}

void haptics_start(void)
{
	if(InterlockedCompareExchange(&running, 1, 0) != 0)
		return;
	if(!lock_ready)
	{
		InitializeCriticalSection(&lock);
		lock_ready = true;
	}
	q_read = q_count = 0;
	last_frame[0] = last_frame[1] = 0;
	thread = (HANDLE)_beginthreadex(NULL, 0, haptics_main, NULL, 0, NULL);
}

void haptics_stop(void)
{
	if(InterlockedCompareExchange(&running, 0, 1) != 1)
		return;
	WaitForSingleObject(thread, INFINITE);
	CloseHandle(thread);
}
