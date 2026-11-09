// SPDX-License-Identifier: AGPL-3.0-only
//
// The Win32 calls the desktop's media_server.c makes, mapped onto POSIX threads and
// BSD sockets, so the phone builds compile that file unchanged. Only the subset that
// file uses; the names in this directory shadow the Windows headers it includes.

#ifndef HC_WIN_COMPAT_H
#define HC_WIN_COMPAT_H

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

typedef int SOCKET;
typedef void *HANDLE;
#define INVALID_SOCKET (-1)
#define closesocket close
#define __stdcall
#define INFINITE 0xffffffffu
#define THREAD_PRIORITY_TIME_CRITICAL 15

typedef pthread_mutex_t CRITICAL_SECTION;
typedef pthread_cond_t CONDITION_VARIABLE;

static inline void InitializeCriticalSection(CRITICAL_SECTION *m) { pthread_mutex_init(m, NULL); }
static inline void EnterCriticalSection(CRITICAL_SECTION *m) { pthread_mutex_lock(m); }
static inline void LeaveCriticalSection(CRITICAL_SECTION *m) { pthread_mutex_unlock(m); }
static inline void InitializeConditionVariable(CONDITION_VARIABLE *c) { pthread_cond_init(c, NULL); }
static inline void WakeConditionVariable(CONDITION_VARIABLE *c) { pthread_cond_signal(c); }

// Only ever called with INFINITE in that file.
static inline int SleepConditionVariableCS(CONDITION_VARIABLE *c, CRITICAL_SECTION *m, unsigned ms)
{
	(void)ms;
	return pthread_cond_wait(c, m) == 0;
}

typedef struct
{
	unsigned (*fn)(void *);
	void *arg;
} HcThreadStart;

static void *hc_thread_trampoline(void *p)
{
	HcThreadStart start = *(HcThreadStart *)p;
	free(p);
	start.fn(start.arg);
	return NULL;
}

// Detached, like a closed Windows thread handle. The returned value only says whether it started.
static inline uintptr_t hc_begin_thread(unsigned (*fn)(void *), void *arg)
{
	HcThreadStart *start = malloc(sizeof(*start));
	if(!start)
		return 0;
	start->fn = fn;
	start->arg = arg;
	pthread_t thread;
	if(pthread_create(&thread, NULL, hc_thread_trampoline, start) != 0)
	{
		free(start);
		return 0;
	}
	pthread_detach(thread);
	return 1;
}

#define _beginthreadex(security, stack, fn, arg, flags, id) hc_begin_thread((fn), (arg))

// The send thread asks for top priority on Windows; the OS scheduler is left alone here.
static inline int SetThreadPriority(HANDLE thread, int priority)
{
	(void)thread;
	(void)priority;
	return 1;
}

#endif
