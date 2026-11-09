#!/bin/bash
# Builds ios/HarganPsCoreC.xcframework from native/ps-core/mobile for iPhone and
# iPad (arm64). Needs macOS with Xcode and CMake. Run before building the app.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
build="$root/native/build-ios"
out="$here/HarganPsCoreC.xcframework"

cmake -S "$root/native/ps-core/mobile" -B "$build" -G "Unix Makefiles" \
	-DCMAKE_SYSTEM_NAME=iOS \
	-DCMAKE_OSX_SYSROOT=iphoneos \
	-DCMAKE_OSX_ARCHITECTURES=arm64 \
	-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
	-DCMAKE_BUILD_TYPE=Release
cmake --build "$build" -j "$(sysctl -n hw.ncpu)"

# One archive for the app to link: the core and every library under it.
find "$build" -name '*.a' -not -name 'libhargan_ps_all.a' -print0 | xargs -0 libtool -static -o "$build/libhargan_ps_all.a"

rm -rf "$build/headers" "$out"
mkdir -p "$build/headers"
cp "$root/native/ps-core/mobile/hargan_ps.h" "$build/headers/"
cat > "$build/headers/module.modulemap" <<'EOF'
module HarganPsCoreC {
    header "hargan_ps.h"
    export *
}
EOF
xcodebuild -create-xcframework -library "$build/libhargan_ps_all.a" -headers "$build/headers" -output "$out"
echo "built $out"
