// Matches the monitor's refresh rate to the stream while one runs. A 60 fps stream
// on a 144 Hz screen shows frames for two or three refreshes in turn, which reads
// as judder; at 120 Hz each frame gets exactly two.
//
// The change is made with CDS_FULLSCREEN: a temporary mode that is not written to
// the registry, so the user's own setting comes back when this process ends even
// if display_restore never runs.

#include "display.h"
#include <stdbool.h>
#include <wchar.h>

static WCHAR changed_device[CCHDEVICENAME];
static bool changed;

static bool same_mode(const DEVMODEW *a, const DEVMODEW *b)
{
	return a->dmPelsWidth == b->dmPelsWidth && a->dmPelsHeight == b->dmPelsHeight &&
		a->dmBitsPerPel == b->dmBitsPerPel &&
		(a->dmDisplayFlags & DM_INTERLACED) == (b->dmDisplayFlags & DM_INTERLACED);
}

// Windows reports 59.94 Hz as 59 and 119.88 Hz as 119; those fit a 60 fps stream too.
static bool fits(DWORD hz, int fps)
{
	return hz >= (DWORD)fps - 1 && (hz + 1) % (DWORD)fps <= 2;
}

int display_match(HWND window, int fps, int *from_hz, int *to_hz)
{
	*from_hz = *to_hz = 0;
	if(fps <= 1)
		return 0;
	HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
	MONITORINFOEXW info;
	ZeroMemory(&info, sizeof(info));
	info.cbSize = sizeof(info);
	if(!GetMonitorInfoW(monitor, (MONITORINFO *)&info))
		return -1;

	DEVMODEW current;
	ZeroMemory(&current, sizeof(current));
	current.dmSize = sizeof(current);
	if(!EnumDisplaySettingsW(info.szDevice, ENUM_CURRENT_SETTINGS, &current))
		return -1;
	*from_hz = *to_hz = (int)current.dmDisplayFrequency;
	// 0 and 1 mean "the hardware default"; nothing to reason about.
	if(current.dmDisplayFrequency <= 1 || fits(current.dmDisplayFrequency, fps))
		return 0;

	DEVMODEW best;
	DWORD best_hz = 0;
	DEVMODEW mode;
	ZeroMemory(&mode, sizeof(mode));
	mode.dmSize = sizeof(mode);
	for(DWORD i = 0; EnumDisplaySettingsW(info.szDevice, i, &mode); i++)
	{
		DWORD hz = mode.dmDisplayFrequency;
		if(!same_mode(&mode, &current) || hz > current.dmDisplayFrequency || !fits(hz, fps) || hz <= best_hz)
			continue;
		best = mode;
		best_hz = hz;
	}
	if(!best_hz)
		return 0;

	best.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_BITSPERPEL | DM_DISPLAYFREQUENCY | DM_DISPLAYFLAGS;
	if(ChangeDisplaySettingsExW(info.szDevice, &best, NULL, CDS_FULLSCREEN, NULL) != DISP_CHANGE_SUCCESSFUL)
		return -1;
	// A second match before a restore keeps the first device to put back.
	if(!changed)
		wcsncpy(changed_device, info.szDevice, CCHDEVICENAME - 1);
	changed = true;
	*to_hz = (int)best_hz;
	return 1;
}

void display_restore(void)
{
	if(!changed)
		return;
	changed = false;
	// No mode: back to what the registry holds, the user's own setting.
	ChangeDisplaySettingsExW(changed_device, NULL, NULL, 0, NULL);
}
