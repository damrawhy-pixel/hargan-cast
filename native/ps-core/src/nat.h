#pragma once
#include <json-c/json_object.h>
#include <stdbool.h>

/**
 * How this network looks from outside, for connecting to a console through PSN:
 * {nat: "cone" | "symmetric" | "blocked" | "unknown", publicAddress?, upnp}.
 * Takes a few seconds; asks Google's public STUN servers.
 */
json_object *nat_test(void);
