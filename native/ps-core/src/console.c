// Remote Play with the user's own console: finding it, linking this app to it
// with the PIN the console shows, and waking it from rest mode. Streaming from it
// is the same session as a cloud stream (main.c, run_session).

#include "console.h"

#include <chiaki/base64.h>
#include <chiaki/discovery.h>
#include <chiaki/discoveryservice.h>
#include <chiaki/regist.h>

#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CONSOLES 16
#define DISCOVERY_PING_MS 400
#define REGIST_TIMEOUT_MS 15000

// --- discovery ---------------------------------------------------------------

typedef struct
{
	CRITICAL_SECTION lock;
	json_object *found;
} Found;

static json_object *host_json(ChiakiDiscoveryHost *h)
{
	json_object *o = json_object_new_object();
#define ADD_STRING(key, value) json_object_object_add(o, key, json_object_new_string((value) ? (value) : ""))
	ADD_STRING("address", h->host_addr);
	ADD_STRING("name", h->host_name);
	ADD_STRING("hostId", h->host_id);
	ADD_STRING("systemVersion", h->system_version);
	ADD_STRING("runningApp", h->running_app_name);
#undef ADD_STRING
	json_object_object_add(o, "ps5", json_object_new_boolean(chiaki_discovery_host_is_ps5(h)));
	json_object_object_add(o, "state", json_object_new_string(
		h->state == CHIAKI_DISCOVERY_HOST_STATE_READY ? "ready" : h->state == CHIAKI_DISCOVERY_HOST_STATE_STANDBY ? "standby" : "unknown"));
	return o;
}

// The service reports its whole current list each time; the last one wins.
static void on_hosts(ChiakiDiscoveryHost *hosts, size_t count, void *user)
{
	Found *found = user;
	json_object *list = json_object_new_array();
	for(size_t i = 0; i < count; i++)
		json_object_array_add(list, host_json(&hosts[i]));
	EnterCriticalSection(&found->lock);
	json_object_put(found->found);
	found->found = list;
	LeaveCriticalSection(&found->lock);
}

json_object *console_discover(ChiakiLog *log, const char *host, int wait_ms)
{
	Found found = { .found = json_object_new_array() };
	InitializeCriticalSection(&found.lock);

	struct sockaddr_in addr;
	memset(&addr, 0, sizeof(addr));
	addr.sin_family = AF_INET;
	addr.sin_addr.s_addr = htonl(INADDR_BROADCAST);
	struct sockaddr_storage send_addr;
	memset(&send_addr, 0, sizeof(send_addr));
	memcpy(&send_addr, &addr, sizeof(addr));

	ChiakiDiscoveryServiceOptions options;
	memset(&options, 0, sizeof(options));
	options.hosts_max = MAX_CONSOLES;
	options.host_drop_pings = 3;
	options.ping_ms = DISCOVERY_PING_MS;
	options.ping_initial_ms = 0;
	options.send_addr = &send_addr;
	options.send_addr_size = sizeof(addr);
	// A typed address is asked directly: it may be across the internet or on another subnet.
	options.send_host = host && *host ? (char *)host : NULL;
	options.cb = on_hosts;
	options.cb_user = &found;

	ChiakiDiscoveryService service;
	if(chiaki_discovery_service_init(&service, &options, log) == CHIAKI_ERR_SUCCESS)
	{
		Sleep((DWORD)wait_ms);
		chiaki_discovery_service_fini(&service);
	}

	EnterCriticalSection(&found.lock);
	json_object *list = found.found;
	found.found = NULL;
	LeaveCriticalSection(&found.lock);
	DeleteCriticalSection(&found.lock);
	return list;
}

// --- registration ----------------------------------------------------------------

typedef struct
{
	HANDLE done;
	bool ok;
	ChiakiRegisteredHost host;
} RegistWait;

static void on_regist(ChiakiRegistEvent *event, void *user)
{
	RegistWait *wait = user;
	wait->ok = event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS && event->registered_host;
	if(wait->ok)
		wait->host = *event->registered_host;
	SetEvent(wait->done);
}

static void hex_encode(const uint8_t *data, size_t size, char *out)
{
	static const char digits[] = "0123456789abcdef";
	for(size_t i = 0; i < size; i++)
	{
		out[i * 2] = digits[data[i] >> 4];
		out[i * 2 + 1] = digits[data[i] & 15];
	}
	out[size * 2] = 0;
}

bool console_hex_decode(const char *hex, uint8_t *out, size_t size)
{
	if(!hex || strlen(hex) != size * 2)
		return false;
	for(size_t i = 0; i < size; i++)
	{
		unsigned v;
		if(sscanf(hex + i * 2, "%2x", &v) != 1)
			return false;
		out[i] = (uint8_t)v;
	}
	return true;
}

json_object *console_register(ChiakiLog *log, const char *host, bool ps5, const char *account_id_b64, uint32_t pin, const char **error)
{
	ChiakiRegistInfo info;
	memset(&info, 0, sizeof(info));
	info.target = ps5 ? CHIAKI_TARGET_PS5_1 : CHIAKI_TARGET_PS4_10;
	info.host = host;
	info.broadcast = false;
	info.psn_online_id = NULL;
	info.pin = pin;
	size_t account_size = CHIAKI_PSN_ACCOUNT_ID_SIZE;
	if(!account_id_b64 || chiaki_base64_decode(account_id_b64, strlen(account_id_b64), info.psn_account_id, &account_size) != CHIAKI_ERR_SUCCESS
		|| account_size != CHIAKI_PSN_ACCOUNT_ID_SIZE)
	{
		*error = "account";
		return NULL;
	}

	RegistWait wait = { .done = CreateEvent(NULL, TRUE, FALSE, NULL) };
	ChiakiRegist regist;
	if(chiaki_regist_start(&regist, log, &info, on_regist, &wait) != CHIAKI_ERR_SUCCESS)
	{
		CloseHandle(wait.done);
		*error = "start";
		return NULL;
	}
	if(WaitForSingleObject(wait.done, REGIST_TIMEOUT_MS) != WAIT_OBJECT_0)
		chiaki_regist_stop(&regist);
	chiaki_regist_fini(&regist);
	CloseHandle(wait.done);
	SecureZeroMemory(info.psn_account_id, sizeof(info.psn_account_id));
	if(!wait.ok)
	{
		*error = "regist";
		return NULL;
	}

	char regist_key[CHIAKI_SESSION_AUTH_SIZE * 2 + 1];
	char rp_key[sizeof(wait.host.rp_key) * 2 + 1];
	char mac[sizeof(wait.host.server_mac) * 2 + 1];
	hex_encode((const uint8_t *)wait.host.rp_regist_key, CHIAKI_SESSION_AUTH_SIZE, regist_key);
	hex_encode(wait.host.rp_key, sizeof(wait.host.rp_key), rp_key);
	hex_encode(wait.host.server_mac, sizeof(wait.host.server_mac), mac);

	json_object *o = json_object_new_object();
	char name[sizeof(wait.host.server_nickname) + 1];
	memcpy(name, wait.host.server_nickname, sizeof(wait.host.server_nickname));
	name[sizeof(wait.host.server_nickname)] = 0;
	json_object_object_add(o, "name", json_object_new_string(name));
	json_object_object_add(o, "mac", json_object_new_string(mac));
	json_object_object_add(o, "registKey", json_object_new_string(regist_key));
	json_object_object_add(o, "rpKey", json_object_new_string(rp_key));
	json_object_object_add(o, "ps5", json_object_new_boolean(chiaki_target_is_ps5(wait.host.target)));
	SecureZeroMemory(&wait.host, sizeof(wait.host));
	SecureZeroMemory(rp_key, sizeof(rp_key));
	return o;
}

// --- wake --------------------------------------------------------------------------

bool console_wake(ChiakiLog *log, const char *host, const char *regist_key_hex, bool ps5)
{
	// The wake credential is the registration key's text read as a hex number.
	uint8_t key[CHIAKI_SESSION_AUTH_SIZE + 1];
	if(!console_hex_decode(regist_key_hex, key, CHIAKI_SESSION_AUTH_SIZE))
		return false;
	key[CHIAKI_SESSION_AUTH_SIZE] = 0;
	uint64_t credential = (uint64_t)_strtoui64((const char *)key, NULL, 16);
	return chiaki_discovery_wakeup(log, NULL, host, credential, ps5) == CHIAKI_ERR_SUCCESS;
}
