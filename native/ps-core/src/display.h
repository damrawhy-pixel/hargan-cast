#pragma once
#include <windows.h>

/**
 * Switches the monitor showing `window` to a refresh rate that is a whole multiple
 * of `fps` (144 Hz becomes 120 Hz for a 60 fps stream), at the same resolution and
 * never above the current rate, so every stream frame stays on screen equally long.
 * Returns 1 when it switched, 0 when the rate already fits or no mode does, -1 on
 * error. `from_hz` and `to_hz` receive the rates.
 */
int display_match(HWND window, int fps, int *from_hz, int *to_hz);

/** Puts back the rate display_match changed; safe to call any time. */
void display_restore(void);
