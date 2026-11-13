// SPDX-License-Identifier: AGPL-3.0-only
//
// Fuzz target for the byte formats the core reads from outside: controller reports
// from the page's WebSocket, DualSense HID input and calibration reports, and the
// output report builder fed with arbitrary settings. Built with
// -fsanitize=fuzzer,address,undefined in CI (.github/workflows/ci.yml); with
// -DFUZZ_STANDALONE it instead runs a fixed number of random inputs, for
// toolchains without libFuzzer.

#include "controller_io.h"
#include "dualsense_report.h"

#include <stdlib.h>
#include <string.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
	ChiakiControllerState state;
	controller_report_decode(data, size, &state);

	DsInput input;
	ds_parse_input(data, size, &input);

	DsCalibration calibration;
	ds_parse_calibration(data, size, &calibration);

	if(size >= sizeof(DsOutput) + 2)
	{
		DsOutput output;
		memcpy(&output, data, sizeof(output));
		uint8_t report[DS_BT_OUTPUT_SIZE];
		ds_build_output(&output, (data[sizeof(output)] & 1) != 0, data[sizeof(output) + 1], report);
		ds_player_bits(data[0]);
	}
	if(size)
		ds_stick_axis(data[0]);
	ds_crc32(0, data, size);
	return 0;
}

#ifdef FUZZ_STANDALONE
#include <stdio.h>

int main(int argc, char **argv)
{
	long runs = argc > 1 ? atol(argv[1]) : 200000;
	uint8_t buf[256];
	srand(1);
	for(long i = 0; i < runs; i++)
	{
		size_t size = (size_t)(rand() % (int)sizeof(buf));
		for(size_t j = 0; j < size; j++)
			buf[j] = (uint8_t)rand();
		// Bias some inputs toward valid headers so the parsers go past their first check.
		if(size && i % 3 == 0)
			buf[0] = (uint8_t)(i % 6);
		LLVMFuzzerTestOneInput(buf, size);
	}
	printf("%ld inputs, no crash\n", runs);
	return 0;
}
#endif
