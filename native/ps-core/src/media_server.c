// SPDX-License-Identifier: AGPL-3.0-only

#include "media_server.h"

#include <chiaki/base64.h>
#include <chiaki/random.h>

#include <mbedtls/sha1.h>

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <process.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WS_GUID "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
#define QUEUE_CAPACITY 256
// Beyond this many unsent video frames the client is behind by ~100ms at 60fps.
#define MAX_QUEUED_VIDEO 6
#define MAX_INPUT_FRAME 256

typedef struct
{
	uint8_t *data;
	size_t size;
	bool video;
} Item;

static SOCKET listen_sock = INVALID_SOCKET;
static volatile SOCKET client_sock = INVALID_SOCKET;
static char auth_token[33];

static CRITICAL_SECTION lock;
static CONDITION_VARIABLE not_empty;
static Item queue[QUEUE_CAPACITY];
static size_t q_head, q_count, q_video;

static MediaInputCallback input_cb;
static void *input_user;

static void queue_clear(void)
{
	while(q_count)
	{
		free(queue[q_head].data);
		q_head = (q_head + 1) % QUEUE_CAPACITY;
		q_count--;
	}
	q_video = 0;
}

static bool send_all(SOCKET s, const uint8_t *buf, size_t size)
{
	while(size)
	{
		int n = send(s, (const char *)buf, size > 0x40000000 ? 0x40000000 : (int)size, 0);
		if(n <= 0)
			return false;
		buf += n;
		size -= (size_t)n;
	}
	return true;
}

static bool recv_all(SOCKET s, uint8_t *buf, size_t size)
{
	while(size)
	{
		int n = recv(s, (char *)buf, (int)size, 0);
		if(n <= 0)
			return false;
		buf += n;
		size -= (size_t)n;
	}
	return true;
}

static bool handshake(SOCKET s)
{
	char req[4096];
	size_t got = 0;
	while(got < sizeof(req) - 1)
	{
		int n = recv(s, req + got, (int)(sizeof(req) - 1 - got), 0);
		if(n <= 0)
			return false;
		got += (size_t)n;
		req[got] = 0;
		if(strstr(req, "\r\n\r\n"))
			break;
	}

	char expected[64];
	snprintf(expected, sizeof(expected), "GET /%s ", auth_token);
	if(strncmp(req, expected, strlen(expected)) != 0)
		return false;

	const char *key = strstr(req, "Sec-WebSocket-Key:");
	if(!key)
		key = strstr(req, "sec-websocket-key:");
	if(!key)
		return false;
	key += strlen("Sec-WebSocket-Key:");
	while(*key == ' ')
		key++;
	const char *end = strstr(key, "\r\n");
	if(!end || end - key > 64)
		return false;

	char material[128];
	int mlen = snprintf(material, sizeof(material), "%.*s%s", (int)(end - key), key, WS_GUID);
	uint8_t digest[20];
	if(mbedtls_sha1_ret((const uint8_t *)material, (size_t)mlen, digest) != 0)
		return false;
	char accept[64];
	if(chiaki_base64_encode(digest, sizeof(digest), accept, sizeof(accept)) != CHIAKI_ERR_SUCCESS)
		return false;

	char resp[256];
	int rlen = snprintf(resp, sizeof(resp),
		"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
		"Sec-WebSocket-Accept: %s\r\n\r\n", accept);
	return send_all(s, (const uint8_t *)resp, (size_t)rlen);
}

// Reads masked client frames until the socket closes.
static void read_loop(SOCKET s)
{
	for(;;)
	{
		uint8_t hdr[2];
		if(!recv_all(s, hdr, 2))
			return;
		uint8_t opcode = hdr[0] & 0x0f;
		bool masked = (hdr[1] & 0x80) != 0;
		uint64_t len = hdr[1] & 0x7f;
		if(len == 126)
		{
			uint8_t e[2];
			if(!recv_all(s, e, 2))
				return;
			len = ((uint64_t)e[0] << 8) | e[1];
		}
		else if(len == 127)
			return; // input frames are tiny; anything this big is not ours
		if(!masked || len > MAX_INPUT_FRAME)
			return;
		uint8_t mask[4], payload[MAX_INPUT_FRAME];
		if(!recv_all(s, mask, 4) || !recv_all(s, payload, (size_t)len))
			return;
		for(size_t i = 0; i < len; i++)
			payload[i] ^= mask[i % 4];

		if(opcode == 0x8)
			return;
		if(opcode == 0x9)
		{
			uint8_t pong[2 + MAX_INPUT_FRAME] = { 0x8a, (uint8_t)len };
			memcpy(pong + 2, payload, (size_t)len);
			if(len < 126)
				send_all(s, pong, (size_t)len + 2);
			continue;
		}
		if(opcode == 0x2 && input_cb)
			input_cb(payload, (size_t)len, input_user);
	}
}

static unsigned __stdcall accept_thread(void *arg)
{
	for(;;)
	{
		SOCKET s = accept(listen_sock, NULL, NULL);
		if(s == INVALID_SOCKET)
			return 0;
		int one = 1;
		setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (const char *)&one, sizeof(one));
		int sndbuf = 4 * 1024 * 1024;
		setsockopt(s, SOL_SOCKET, SO_SNDBUF, (const char *)&sndbuf, sizeof(sndbuf));

		if(!handshake(s))
		{
			closesocket(s);
			continue;
		}

		EnterCriticalSection(&lock);
		queue_clear();
		client_sock = s;
		LeaveCriticalSection(&lock);

		read_loop(s);

		EnterCriticalSection(&lock);
		client_sock = INVALID_SOCKET;
		queue_clear();
		LeaveCriticalSection(&lock);
		closesocket(s);
	}
}

static unsigned __stdcall send_thread(void *arg)
{
	for(;;)
	{
		EnterCriticalSection(&lock);
		while(q_count == 0)
			SleepConditionVariableCS(&not_empty, &lock, INFINITE);
		Item item = queue[q_head];
		q_head = (q_head + 1) % QUEUE_CAPACITY;
		q_count--;
		if(item.video)
			q_video--;
		SOCKET s = client_sock;
		LeaveCriticalSection(&lock);

		if(s != INVALID_SOCKET)
			send_all(s, item.data, item.size);
		free(item.data);
	}
}

bool media_server_start(uint16_t *port_out, char *token_out, size_t token_size)
{
	InitializeCriticalSection(&lock);
	InitializeConditionVariable(&not_empty);

	uint8_t rnd[16];
	if(chiaki_random_bytes_crypt(rnd, sizeof(rnd)) != CHIAKI_ERR_SUCCESS)
		return false;
	for(size_t i = 0; i < sizeof(rnd); i++)
		snprintf(auth_token + i * 2, 3, "%02x", rnd[i]);
	snprintf(token_out, token_size, "%s", auth_token);

	listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if(listen_sock == INVALID_SOCKET)
		return false;
	struct sockaddr_in addr = { 0 };
	addr.sin_family = AF_INET;
	addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	addr.sin_port = 0;
	if(bind(listen_sock, (struct sockaddr *)&addr, sizeof(addr)) != 0 || listen(listen_sock, 2) != 0)
		return false;
	int alen = sizeof(addr);
	if(getsockname(listen_sock, (struct sockaddr *)&addr, &alen) != 0)
		return false;
	*port_out = ntohs(addr.sin_port);

	_beginthreadex(NULL, 0, accept_thread, NULL, 0, NULL);
	HANDLE sender = (HANDLE)_beginthreadex(NULL, 0, send_thread, NULL, 0, NULL);
	if(sender)
		SetThreadPriority(sender, THREAD_PRIORITY_TIME_CRITICAL);
	return true;
}

void media_server_set_input_cb(MediaInputCallback cb, void *user)
{
	input_cb = cb;
	input_user = user;
}

bool media_server_has_client(void)
{
	return client_sock != INVALID_SOCKET;
}

bool media_server_send(MediaType type, const uint8_t *head, size_t head_size, const uint8_t *body, size_t body_size)
{
	size_t payload = 1 + head_size + body_size;
	bool video = type == MEDIA_VIDEO;

	EnterCriticalSection(&lock);
	bool drop = client_sock == INVALID_SOCKET || q_count == QUEUE_CAPACITY || (video && q_video >= MAX_QUEUED_VIDEO);
	LeaveCriticalSection(&lock);
	if(drop)
		return false;

	size_t hdr_len = payload < 126 ? 2 : payload <= 0xffff ? 4 : 10;
	uint8_t *msg = malloc(hdr_len + payload);
	if(!msg)
		return false;
	msg[0] = 0x82; // FIN + binary; server frames are never masked
	if(hdr_len == 2)
		msg[1] = (uint8_t)payload;
	else if(hdr_len == 4)
	{
		msg[1] = 126;
		msg[2] = (uint8_t)(payload >> 8);
		msg[3] = (uint8_t)payload;
	}
	else
	{
		msg[1] = 127;
		for(int i = 0; i < 8; i++)
			msg[2 + i] = (uint8_t)((uint64_t)payload >> (56 - 8 * i));
	}
	uint8_t *p = msg + hdr_len;
	*p++ = (uint8_t)type;
	if(head_size)
		memcpy(p, head, head_size);
	p += head_size;
	if(body_size)
		memcpy(p, body, body_size);

	EnterCriticalSection(&lock);
	if(q_count == QUEUE_CAPACITY)
	{
		LeaveCriticalSection(&lock);
		free(msg);
		return false;
	}
	queue[(q_head + q_count) % QUEUE_CAPACITY] = (Item){ msg, hdr_len + payload, video };
	q_count++;
	if(video)
		q_video++;
	WakeConditionVariable(&not_empty);
	LeaveCriticalSection(&lock);
	return true;
}
