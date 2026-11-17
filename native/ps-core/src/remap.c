// The same controller layout the app applies to browser gamepads (src/renderer/
// src/lib/remap.ts), for the DualSense this core reads itself.

#include "remap.h"
#include <stdlib.h>
#include <string.h>

// Standard index to button bit; the triggers (6, 7) are analog and have none.
static const uint32_t STANDARD[REMAP_BUTTONS] = {
	CHIAKI_CONTROLLER_BUTTON_CROSS, CHIAKI_CONTROLLER_BUTTON_MOON, CHIAKI_CONTROLLER_BUTTON_BOX, CHIAKI_CONTROLLER_BUTTON_PYRAMID,
	CHIAKI_CONTROLLER_BUTTON_L1, CHIAKI_CONTROLLER_BUTTON_R1, 0, 0,
	CHIAKI_CONTROLLER_BUTTON_SHARE, CHIAKI_CONTROLLER_BUTTON_OPTIONS, CHIAKI_CONTROLLER_BUTTON_L3, CHIAKI_CONTROLLER_BUTTON_R3,
	CHIAKI_CONTROLLER_BUTTON_DPAD_UP, CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN, CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT, CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT,
	CHIAKI_CONTROLLER_BUTTON_PS, CHIAKI_CONTROLLER_BUTTON_TOUCHPAD,
};

void remap_identity(PadLayout *layout)
{
	for(int i = 0; i < REMAP_BUTTONS; i++)
		layout->map[i] = (uint8_t)i;
	layout->swap_sticks = false;
	layout->invert_y = false;
}

void remap_parse(PadLayout *layout, const char *text)
{
	uint8_t map[REMAP_BUTTONS];
	const char *p = text ? text : "";
	for(int i = 0; i < REMAP_BUTTONS; i++)
	{
		char *end;
		long v = strtol(p, &end, 10);
		if(end == p || v < 0 || v >= REMAP_BUTTONS || (i < REMAP_BUTTONS - 1 ? *end != ',' : *end != '\0'))
			return;
		map[i] = (uint8_t)v;
		p = end + 1;
	}
	memcpy(layout->map, map, sizeof(map));
}

static int16_t flip(int16_t v)
{
	return v == INT16_MIN ? INT16_MAX : (int16_t)-v;
}

void remap_apply(const PadLayout *layout, ChiakiControllerState *state)
{
	uint8_t in[REMAP_BUTTONS];
	uint32_t mapped = 0;
	for(int i = 0; i < REMAP_BUTTONS; i++)
	{
		mapped |= STANDARD[i];
		in[i] = i == 6 ? state->l2_state : i == 7 ? state->r2_state : (state->buttons & STANDARD[i]) ? 255 : 0;
	}
	uint32_t buttons = state->buttons & ~mapped;
	uint8_t l2 = 0, r2 = 0;
	for(int out = 0; out < REMAP_BUTTONS; out++)
	{
		uint8_t v = in[layout->map[out] < REMAP_BUTTONS ? layout->map[out] : out];
		if(out == 6)
			l2 = v;
		else if(out == 7)
			r2 = v;
		else if(v > 127)
			buttons |= STANDARD[out];
	}
	state->buttons = buttons;
	state->l2_state = l2;
	state->r2_state = r2;

	if(layout->swap_sticks)
	{
		int16_t x = state->left_x, y = state->left_y;
		state->left_x = state->right_x;
		state->left_y = state->right_y;
		state->right_x = x;
		state->right_y = y;
	}
	if(layout->invert_y)
		state->right_y = flip(state->right_y);
}
