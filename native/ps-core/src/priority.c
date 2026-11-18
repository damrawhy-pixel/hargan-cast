// The stream's own threads ahead of whatever else the PC is doing: the receive,
// decode-feed and send paths run in the multimedia class scheduler's "Games"
// task, and the system timer ticks every millisecond while a stream is live.

#include "priority.h"

#ifdef _WIN32
#include <windows.h>
#include <avrt.h>
#include <timeapi.h>

static __thread HANDLE task;
static __thread int tried;
static volatile LONG timer_users;

void priority_boost_thread(void)
{
	if(tried)
		return;
	tried = 1;
	DWORD index = 0;
	task = AvSetMmThreadCharacteristicsW(L"Games", &index);
	if(task)
		AvSetMmThreadPriority(task, AVRT_PRIORITY_HIGH);
}

void priority_stream_begin(void)
{
	if(InterlockedIncrement(&timer_users) == 1)
		timeBeginPeriod(1);
}

void priority_stream_end(void)
{
	if(InterlockedDecrement(&timer_users) == 0)
		timeEndPeriod(1);
}
#else
void priority_boost_thread(void) {}
void priority_stream_begin(void) {}
void priority_stream_end(void) {}
#endif
