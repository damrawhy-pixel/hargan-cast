// SPDX-License-Identifier: AGPL-3.0-only
//
// Writes a small minidump when the core crashes, into the folder the app names
// in HC_DUMP_DIR. Nothing is sent anywhere; the app lists the files in its
// diagnostics report.

#ifndef HARGAN_CRASH_DUMP_H
#define HARGAN_CRASH_DUMP_H

void crash_dump_install(void);

#endif
