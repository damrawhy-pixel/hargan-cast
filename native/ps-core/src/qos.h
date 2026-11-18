#pragma once
#include <stdint.h>

/**
 * Marks the stream's socket as audio and video for Windows' QoS (qWAVE), which
 * tags its packets so routers and Wi-Fi access points that honour the marks send
 * them ahead of bulk traffic. Best effort: anything refused is logged and ignored.
 * Returns true when the flow was set up.
 */
int qos_attach(uintptr_t socket);
void qos_detach(void);
