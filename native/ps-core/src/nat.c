// "Can this network reach my console from outside?": what PSN's connection
// broker will run into. Two STUN servers are asked, from the same local port,
// which address and port the router shows the world. The same port both times is
// a NAT that lets the broker's hole-punching through; different ports
// (symmetric NAT) usually block it, unless the router opens ports on request
// (UPnP), which is checked as well.

#include "nat.h"

#include <miniupnpc/miniupnpc.h>
#include <miniupnpc/upnpcommands.h>

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <string.h>

#define STUN_PORT 19302
#define STUN_WAIT_MS 2000
#define STUN_MAGIC 0x2112A442u

typedef struct
{
	bool ok;
	char address[64];
	uint16_t port;
} Mapped;

// One binding request; the reply's XOR-MAPPED-ADDRESS is how the router shows us.
static Mapped ask(SOCKET sock, const char *host)
{
	Mapped m = { 0 };
	struct addrinfo hints = { 0 }, *found = NULL;
	hints.ai_family = AF_INET;
	hints.ai_socktype = SOCK_DGRAM;
	char port[8];
	snprintf(port, sizeof(port), "%d", STUN_PORT);
	if(getaddrinfo(host, port, &hints, &found) != 0 || !found)
		return m;
	uint8_t request[20] = { 0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xA4, 0x42 };
	for(int i = 8; i < 20; i++)
		request[i] = (uint8_t)(rand() & 0xff);
	sendto(sock, (const char *)request, sizeof(request), 0, found->ai_addr, (int)found->ai_addrlen);
	freeaddrinfo(found);

	uint8_t reply[512];
	int got = recv(sock, (char *)reply, sizeof(reply), 0);
	if(got < 20 || reply[0] != 0x01 || reply[1] != 0x01 || memcmp(reply + 8, request + 8, 12) != 0)
		return m;
	int at = 20;
	while(at + 4 <= got)
	{
		uint16_t type = (uint16_t)(reply[at] << 8 | reply[at + 1]);
		uint16_t length = (uint16_t)(reply[at + 2] << 8 | reply[at + 3]);
		const uint8_t *v = reply + at + 4;
		if(at + 4 + length > got)
			break;
		if(type == 0x0020 && length >= 8 && v[1] == 0x01)
		{
			m.port = (uint16_t)((v[2] << 8 | v[3]) ^ (STUN_MAGIC >> 16));
			uint32_t ip = ((uint32_t)v[4] << 24 | (uint32_t)v[5] << 16 | (uint32_t)v[6] << 8 | v[7]) ^ STUN_MAGIC;
			snprintf(m.address, sizeof(m.address), "%u.%u.%u.%u", ip >> 24, (ip >> 16) & 0xff, (ip >> 8) & 0xff, ip & 0xff);
			m.ok = true;
			return m;
		}
		at += 4 + ((length + 3) & ~3);
	}
	return m;
}

json_object *nat_test(void)
{
	json_object *o = json_object_new_object();
	SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
	Mapped first = { 0 }, second = { 0 };
	if(sock != INVALID_SOCKET)
	{
		DWORD wait = STUN_WAIT_MS;
		setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char *)&wait, sizeof(wait));
		struct sockaddr_in any = { 0 };
		any.sin_family = AF_INET;
		bind(sock, (struct sockaddr *)&any, sizeof(any));
		srand(GetTickCount());
		first = ask(sock, "stun.l.google.com");
		second = ask(sock, "stun1.l.google.com");
		closesocket(sock);
	}
	const char *nat = !first.ok ? "blocked" : !second.ok ? "unknown" : first.port == second.port ? "cone" : "symmetric";
	json_object_object_add(o, "nat", json_object_new_string(nat));
	if(first.ok)
		json_object_object_add(o, "publicAddress", json_object_new_string(first.address));

	// The router may open ports on request; that rescues most symmetric NATs.
	int error = 0;
	struct UPNPDev *devices = upnpDiscover(2000, NULL, NULL, 0, 0, 2, &error);
	bool upnp = false;
	if(devices)
	{
		struct UPNPUrls urls;
		struct IGDdatas data;
		char lan[64], wan[64];
		upnp = UPNP_GetValidIGD(devices, &urls, &data, lan, sizeof(lan), wan, sizeof(wan)) == 1;
		if(upnp)
			FreeUPNPUrls(&urls);
		freeUPNPDevlist(devices);
	}
	json_object_object_add(o, "upnp", json_object_new_boolean(upnp));
	return o;
}
