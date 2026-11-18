#pragma once

/**
 * Puts the calling thread in Windows' "Games" multimedia class, so the
 * scheduler favours it over background work; once per thread, later calls are
 * free. No-op elsewhere.
 */
void priority_boost_thread(void);

/** 1 ms timer resolution while a stream runs, so waits and sleeps wake on time. */
void priority_stream_begin(void);
void priority_stream_end(void);
