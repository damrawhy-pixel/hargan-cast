// SPDX-License-Identifier: AGPL-3.0-only

#include "controller_io.h"

#include <string.h>

static int16_t read_i16(const uint8_t *p)
{
	return (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

bool controller_report_decode(const uint8_t *buf, size_t size, ChiakiControllerState *out)
{
	if(size != CONTROLLER_REPORT_SIZE || buf[0] != 1)
		return false;
	chiaki_controller_state_set_idle(out);
	memcpy(&out->buttons, buf + 1, sizeof(out->buttons));
	out->l2_state = buf[5];
	out->r2_state = buf[6];
	out->left_x = read_i16(buf + 7);
	out->left_y = read_i16(buf + 9);
	out->right_x = read_i16(buf + 11);
	out->right_y = read_i16(buf + 13);
	return true;
}
