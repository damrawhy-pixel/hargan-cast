// SPDX-License-Identifier: AGPL-3.0-only

#ifndef HARGAN_CONTROLLER_IO_H
#define HARGAN_CONTROLLER_IO_H

#include <chiaki/controller.h>

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Wire layout of one input report (little endian), 15 bytes:
//   u8 version (1), u32 buttons, u8 l2, u8 r2, i16 lx, i16 ly, i16 rx, i16 ry
#define CONTROLLER_REPORT_SIZE 15

bool controller_report_decode(const uint8_t *buf, size_t size, ChiakiControllerState *out);

#endif
