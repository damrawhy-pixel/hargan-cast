// Steadier Wi-Fi for streaming: Windows scans for networks in the background
// every few seconds even while connected, and each scan holds the radio off its
// channel long enough to show as a hitch. Turned off for the stream's length.

#include "wifi.h"

#include <windows.h>
#include <wlanapi.h>

static HANDLE client;

int wifi_quiet(bool on)
{
	if(!on)
	{
		// Closing the handle hands both settings back to Windows.
		if(client)
			WlanCloseHandle(client, NULL);
		client = NULL;
		return 0;
	}
	if(client)
		return 1;
	DWORD version;
	if(WlanOpenHandle(2, NULL, &version, &client) != ERROR_SUCCESS)
	{
		client = NULL;
		return 0;
	}
	PWLAN_INTERFACE_INFO_LIST list = NULL;
	int quieted = 0;
	if(WlanEnumInterfaces(client, NULL, &list) == ERROR_SUCCESS)
	{
		for(DWORD i = 0; i < list->dwNumberOfItems; i++)
		{
			const WLAN_INTERFACE_INFO *wifi = &list->InterfaceInfo[i];
			if(wifi->isState != wlan_interface_state_connected)
				continue;
			BOOL off = FALSE, yes = TRUE;
			DWORD a = WlanSetInterface(client, &wifi->InterfaceGuid, wlan_intf_opcode_background_scan_enabled, sizeof(off), &off, NULL);
			DWORD b = WlanSetInterface(client, &wifi->InterfaceGuid, wlan_intf_opcode_media_streaming_mode, sizeof(yes), &yes, NULL);
			if(a == ERROR_SUCCESS || b == ERROR_SUCCESS)
				quieted++;
		}
		WlanFreeMemory(list);
	}
	if(!quieted)
	{
		WlanCloseHandle(client, NULL);
		client = NULL;
	}
	return quieted;
}
