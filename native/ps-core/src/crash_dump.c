// SPDX-License-Identifier: AGPL-3.0-only

#include "crash_dump.h"

#include <windows.h>
#include <dbghelp.h>
#include <wchar.h>

static wchar_t dump_dir[MAX_PATH];

// Stacks and registers only (MiniDumpNormal): enough to see where it failed,
// without the heap, which holds the account session.
static LONG WINAPI on_crash(EXCEPTION_POINTERS *info)
{
	SYSTEMTIME t;
	GetLocalTime(&t);
	wchar_t path[MAX_PATH + 64];
	_snwprintf(path, sizeof(path) / sizeof(path[0]), L"%ls/hargan-ps-core-%04u%02u%02u-%02u%02u%02u.dmp",
		dump_dir, t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
	path[sizeof(path) / sizeof(path[0]) - 1] = 0;

	HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if(file != INVALID_HANDLE_VALUE)
	{
		MINIDUMP_EXCEPTION_INFORMATION exception = { GetCurrentThreadId(), info, FALSE };
		MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), file, MiniDumpNormal, &exception, NULL, NULL);
		CloseHandle(file);
	}
	return EXCEPTION_CONTINUE_SEARCH;
}

void crash_dump_install(void)
{
	DWORD n = GetEnvironmentVariableW(L"HC_DUMP_DIR", dump_dir, MAX_PATH);
	if(n == 0 || n >= MAX_PATH)
		return;
	CreateDirectoryW(dump_dir, NULL);
	SetUnhandledExceptionFilter(on_crash);
}
