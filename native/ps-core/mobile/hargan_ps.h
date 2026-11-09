// SPDX-License-Identifier: AGPL-3.0-only
//
// The PlayStation core as a library, for the phone apps. It speaks the same JSON
// messages as the desktop sidecar (native/ps-core/src/main.c): commands in through
// hc_core_command, replies and events out through the callback. Media and controller
// input use the same loopback WebSocket, so the app's stream worker is unchanged.

#ifndef HARGAN_PS_H
#define HARGAN_PS_H

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** One reply or event, a complete JSON object. Called from the core's own threads. */
typedef void (*HcEmitFn)(const char *line, size_t size, void *user);

/**
 * Starts the core once per process; later calls only replace the callback and
 * report the same socket again.
 * cache_dir: where the catalog keeps its cache.
 * ca_bundle: PEM file of trusted roots for curl, or NULL where the OS verifies TLS.
 * token_out receives the socket's path secret, at least 33 bytes.
 */
bool hc_core_start(HcEmitFn emit, void *user, const char *cache_dir, const char *ca_bundle, int *port_out, char *token_out, size_t token_size);

/** One command: catalog, stream or stop, with the desktop's fields. */
void hc_core_command(const char *line);

#ifdef __cplusplus
}
#endif

#endif
