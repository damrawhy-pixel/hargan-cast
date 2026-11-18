#pragma once
#include <chiaki/log.h>
#include <json-c/json_object.h>
#include <stdbool.h>
#include <stdint.h>

/**
 * Looks for PlayStation consoles for about `wait_ms`: on the local network by
 * broadcast, or at `host` when one is given. Returns a JSON array of
 * {address, name, ps5, state, hostId, systemVersion, runningApp}.
 */
json_object *console_discover(ChiakiLog *log, const char *host, int wait_ms);

/**
 * Registers this app with a console, which shows the PIN under Settings > System >
 * Remote Play > Link Device. `account_id_b64` is the PSN account id (8 bytes,
 * base64). On success returns {name, mac, registKey, rpKey, ps5}, the two keys in
 * hex; on failure NULL with `error` set.
 */
json_object *console_register(ChiakiLog *log, const char *host, bool ps5, const char *account_id_b64, uint32_t pin, const char **error);

/** Wakes a registered console from rest mode. */
bool console_wake(ChiakiLog *log, const char *host, const char *regist_key_hex, bool ps5);

/**
 * The account's consoles as PSN knows them, for connecting from outside the home:
 * a JSON array of {uid (hex), name, ps5, remotePlay}, or NULL when PSN refuses.
 * `token` is a PSN OAuth token made with this app's device id.
 */
json_object *console_psn_devices(ChiakiLog *log, const char *token);

/** Decodes `hex` into exactly `size` bytes; false if it does not fit. */
bool console_hex_decode(const char *hex, uint8_t *out, size_t size);
