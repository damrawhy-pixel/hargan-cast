#pragma once
#include <stdbool.h>

/**
 * While a stream runs: no background Wi-Fi scans (each one stalls the link for
 * tens of milliseconds every few seconds) and the driver's media streaming
 * mode. Windows ties both to the handle this opens, so they end with
 * wifi_quiet(false) or with the process. Returns how many adapters took it.
 */
int wifi_quiet(bool on);
