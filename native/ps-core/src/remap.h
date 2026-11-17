#pragma once
#include <chiaki/controller.h>
#include <stdbool.h>
#include <stdint.h>

#define REMAP_BUTTONS 18

/** The app's controller layout, in the W3C standard gamepad order. */
typedef struct
{
	/** For each standard button, the physical button that presses it. */
	uint8_t map[REMAP_BUTTONS];
	bool swap_sticks;
	bool invert_y;
} PadLayout;

/** The default layout. */
void remap_identity(PadLayout *layout);

/** Reads "3,1,2,..." (18 indexes); anything else leaves the default layout. */
void remap_parse(PadLayout *layout, const char *text);

/** Applies the layout to a state read straight from a DualSense. */
void remap_apply(const PadLayout *layout, ChiakiControllerState *state);
