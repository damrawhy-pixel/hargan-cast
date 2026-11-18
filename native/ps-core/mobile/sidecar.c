// SPDX-License-Identifier: AGPL-3.0-only
//
// hargan-ps-core on macOS: the phone apps' core (core.c) behind the desktop's
// sidecar contract (src/main/playstation/service.ts). Commands arrive one JSON
// object per line on stdin; replies and events leave the same way on stdout, the
// first being {"ev":"hello","port":..,"token":".."} for the media socket. The
// core's log goes to stderr, which the app keeps with its own.
//
// HC_CACHE_DIR names the folder for the core's cache; the app sets it.

#include "hargan_ps.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>

static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;

static void emit(const char *line, size_t size, void *user)
{
	(void)user;
	pthread_mutex_lock(&out_lock);
	fwrite(line, 1, size, stdout);
	fputc('\n', stdout);
	fflush(stdout);
	pthread_mutex_unlock(&out_lock);
}

int main(void)
{
	const char *cache = getenv("HC_CACHE_DIR");
	char fallback[1024];
	if(!cache || !*cache)
	{
		const char *tmp = getenv("TMPDIR");
		snprintf(fallback, sizeof(fallback), "%s/hargan-ps-core", tmp && *tmp ? tmp : "/tmp");
		cache = fallback;
	}
	mkdir(cache, 0700);

	int port = 0;
	char token[64] = { 0 };
	// The OS verifies TLS (Secure Transport), so there is no certificate bundle.
	if(!hc_core_start(emit, NULL, cache, NULL, &port, token, sizeof(token)))
	{
		fprintf(stderr, "hargan-ps-core: the core did not start\n");
		return 1;
	}
	pthread_mutex_lock(&out_lock);
	printf("{\"ev\":\"hello\",\"port\":%d,\"token\":\"%s\"}\n", port, token);
	fflush(stdout);
	pthread_mutex_unlock(&out_lock);

	// The app closing stdin is the signal to stop.
	char *line = NULL;
	size_t capacity = 0;
	ssize_t length;
	while((length = getline(&line, &capacity, stdin)) > 0)
	{
		while(length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r'))
			line[--length] = 0;
		if(length > 0)
			hc_core_command(line);
		// Commands carry the account's session token.
		volatile char *p = line;
		for(ssize_t i = 0; i < length; i++)
			p[i] = 0;
	}
	free(line);
	hc_core_command("{\"cmd\":\"stop\"}");
	return 0;
}
