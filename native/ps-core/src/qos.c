// Priority for the stream's packets on the way out: the socket joins a qWAVE
// flow of the "audio/video" kind, which Windows marks (DSCP and, on Wi-Fi, the
// WMM video access category) for equipment that queues by those marks.

#include "qos.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <qos2.h>

static HANDLE handle;
static QOS_FLOWID flow;
static SOCKET flow_socket = INVALID_SOCKET;

int qos_attach(uintptr_t socket)
{
	qos_detach();
	QOS_VERSION version = { 1, 0 };
	if(!QOSCreateHandle(&version, &handle))
	{
		handle = NULL;
		return 0;
	}
	SOCKADDR_STORAGE peer;
	int peer_size = sizeof(peer);
	PSOCKADDR dest = getpeername((SOCKET)socket, (PSOCKADDR)&peer, &peer_size) == 0 ? (PSOCKADDR)&peer : NULL;
	flow = 0;
	if(!QOSAddSocketToFlow(handle, (SOCKET)socket, dest, QOSTrafficTypeAudioVideo, QOS_NON_ADAPTIVE_FLOW, &flow))
	{
		QOSCloseHandle(handle);
		handle = NULL;
		return 0;
	}
	flow_socket = (SOCKET)socket;
	return 1;
}

void qos_detach(void)
{
	if(!handle)
		return;
	if(flow)
		QOSRemoveSocketFromFlow(handle, flow_socket, flow, 0);
	QOSCloseHandle(handle);
	handle = NULL;
	flow = 0;
	flow_socket = INVALID_SOCKET;
}
