#!/bin/bash
# Builds ios/HarganPsCoreC.xcframework from native/ps-core/mobile: arm64 for iPhone
# and iPad, plus arm64 for the Simulator on Apple silicon Macs (the CI's tests run
# there). Needs macOS with Xcode and CMake. Run before building the app.
# HC_IOS_SLICES picks the slices, "device simulator" by default.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
out="$here/HarganPsCoreC.xcframework"
headers="$root/native/build-ios-headers"

# One static archive per slice: the core and every library under it.
build_slice() {
	local name="$1" sysroot="$2"
	local build="$root/native/build-ios-$name"
	cmake -S "$root/native/ps-core/mobile" -B "$build" -G "Unix Makefiles" \
		-DCMAKE_SYSTEM_NAME=iOS \
		-DCMAKE_OSX_SYSROOT="$sysroot" \
		-DCMAKE_OSX_ARCHITECTURES=arm64 \
		-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
		-DCMAKE_BUILD_TYPE=Release
	cmake --build "$build" -j "$(sysctl -n hw.ncpu)"
	rm -f "$build/libhargan_ps_all.a"
	find "$build" -name '*.a' -not -name 'libhargan_ps_all.a' -print0 | xargs -0 libtool -static -o "$build/libhargan_ps_all.a"
}

rm -rf "$headers" "$out"
mkdir -p "$headers"
cp "$root/native/ps-core/mobile/hargan_ps.h" "$headers/"
cat > "$headers/module.modulemap" <<'EOF'
module HarganPsCoreC {
    header "hargan_ps.h"
    export *
}
EOF

args=()
for slice in ${HC_IOS_SLICES:-device simulator}; do
	case "$slice" in
		device) build_slice device iphoneos ;;
		simulator) build_slice simulator iphonesimulator ;;
		*) echo "unknown slice: $slice" >&2; exit 1 ;;
	esac
	args+=(-library "$root/native/build-ios-$slice/libhargan_ps_all.a" -headers "$headers")
done
xcodebuild -create-xcframework "${args[@]}" -output "$out"
echo "built $out"
