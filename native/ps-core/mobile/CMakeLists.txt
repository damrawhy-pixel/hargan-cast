# SPDX-License-Identifier: AGPL-3.0-only
#
# hargan-ps for the phone apps: the protocol library and the media socket the
# desktop sidecar uses, built as a library the Android and iOS plugins call.
# The desktop build (../CMakeLists.txt) does not read this file.
#
#   Android: libhargan_ps.so, built by Gradle (see mobile/plugins/ps-core/android).
#   iOS:     static libraries, merged into HarganPsCore.xcframework by
#            mobile/plugins/ps-core/ios/build-core.sh.
cmake_minimum_required(VERSION 3.22)
project(hargan_ps_mobile C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)
set(CMAKE_POLICY_DEFAULT_CMP0077 NEW)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release)
endif()

set(CORE "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(TP "${CORE}/../third_party")
set(CH "${TP}/chiaki")

include(FetchContent)
set(FETCHCONTENT_QUIET ON)

# --- mbedTLS: the protocol's crypto, and curl's TLS on Android.
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
set(USE_STATIC_MBEDTLS_LIBRARY ON CACHE BOOL "" FORCE)
FetchContent_Declare(mbedtls
	GIT_REPOSITORY https://github.com/Mbed-TLS/mbedtls.git
	GIT_TAG 8b3f26a5ac38d4fdccbc5c5366229f3e01dafcc0 # v2.28.0
	GIT_SHALLOW FALSE)
FetchContent_MakeAvailable(mbedtls)

# --- libcurl. Android has no TLS reachable from C, so curl uses mbedTLS with the
# system's CA list, which the plugin writes out as a bundle. iOS uses the OS's own
# TLS and trust store. Same curl revision as the desktop.
set(BUILD_CURL_EXE OFF CACHE BOOL "" FORCE)
set(BUILD_LIBCURL_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_MISC_DOCS OFF CACHE BOOL "" FORCE)
set(ENABLE_CURL_MANUAL OFF CACHE BOOL "" FORCE)
set(CURL_DISABLE_INSTALL ON CACHE BOOL "" FORCE)
# curl is linked here, never installed; exporting it would demand the same of mbedTLS.
set(CURL_ENABLE_EXPORT_TARGET OFF CACHE BOOL "" FORCE)
set(HTTP_ONLY ON CACHE BOOL "" FORCE)
set(ENABLE_WEBSOCKETS ON CACHE BOOL "" FORCE)
set(CURL_USE_LIBPSL OFF CACHE BOOL "" FORCE)
set(CURL_USE_LIBSSH2 OFF CACHE BOOL "" FORCE)
set(CURL_USE_OPENSSL OFF CACHE BOOL "" FORCE)
set(CURL_USE_PKGCONFIG OFF CACHE BOOL "" FORCE)
set(USE_LIBIDN2 OFF CACHE BOOL "" FORCE)
set(USE_NGHTTP2 OFF CACHE BOOL "" FORCE)
set(CURL_ZLIB OFF CACHE STRING "" FORCE)
set(CURL_BROTLI OFF CACHE STRING "" FORCE)
set(CURL_ZSTD OFF CACHE STRING "" FORCE)
if(IOS)
	set(CURL_USE_SECTRANSP ON CACHE BOOL "" FORCE)
else()
	set(CURL_USE_MBEDTLS ON CACHE BOOL "" FORCE)
	# Point curl at the targets above rather than at files that do not exist yet.
	set(MBEDTLS_INCLUDE_DIR "${mbedtls_SOURCE_DIR}/include" CACHE PATH "" FORCE)
	set(MBEDTLS_LIBRARY mbedtls CACHE STRING "" FORCE)
	set(MBEDX509_LIBRARY mbedx509 CACHE STRING "" FORCE)
	set(MBEDCRYPTO_LIBRARY mbedcrypto CACHE STRING "" FORCE)
endif()
FetchContent_Declare(curl
	GIT_REPOSITORY https://github.com/curl/curl.git
	GIT_TAG b1ef0e1a01c0bb6ee5367bd9c186a603bde3615a)

# --- json-c, miniupnpc, opus
set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(BUILD_APPS OFF CACHE BOOL "" FORCE)
set(DISABLE_WERROR ON CACHE BOOL "" FORCE)
FetchContent_Declare(jsonc
	GIT_REPOSITORY https://github.com/json-c/json-c.git
	GIT_TAG json-c-0.17-20230812
	GIT_SHALLOW TRUE
	SOURCE_DIR ${CMAKE_CURRENT_BINARY_DIR}/_deps/json-c)

set(UPNPC_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(UPNPC_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(UPNPC_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(UPNPC_BUILD_SAMPLE OFF CACHE BOOL "" FORCE)
set(UPNPC_NO_INSTALL ON CACHE BOOL "" FORCE)
FetchContent_Declare(miniupnp
	GIT_REPOSITORY https://github.com/miniupnp/miniupnp.git
	GIT_TAG miniupnpc_2_2_8
	GIT_SHALLOW TRUE
	SOURCE_SUBDIR miniupnpc)

set(OPUS_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
FetchContent_Declare(opus
	GIT_REPOSITORY https://github.com/xiph/opus.git
	GIT_TAG v1.5.2
	GIT_SHALLOW TRUE)

FetchContent_MakeAvailable(curl jsonc miniupnp opus)

if(IOS)
	# curl's configure check finds _fseeki64 on Apple toolchains although it is
	# MSVC-only, and formdata.c then fails to compile. Drop the bogus define.
	set(_curl_config "${curl_BINARY_DIR}/lib/curl_config.h")
	if(EXISTS "${_curl_config}")
		file(READ "${_curl_config}" _text)
		string(REPLACE "#define HAVE__FSEEKI64 1" "/* HAVE__FSEEKI64: not on iOS */" _text "${_text}")
		file(WRITE "${_curl_config}" "${_text}")
	endif()
endif()

# Headers are reached as <miniupnpc/x.h> and <opus/x.h>; give them that layout.
set(WRAP "${CMAKE_CURRENT_BINARY_DIR}/include-wrap")
file(GLOB _upnp_h "${miniupnp_SOURCE_DIR}/miniupnpc/include/*.h")
file(COPY ${_upnp_h} DESTINATION "${WRAP}/miniupnpc")
file(GLOB _opus_h "${opus_SOURCE_DIR}/include/*.h")
file(COPY ${_opus_h} DESTINATION "${WRAP}/opus")

# --- erasure coding for video FEC
file(GLOB GF_SRC "${TP}/gf-complete/src/gf*.c")
list(FILTER GF_SRC EXCLUDE REGEX "gf_method|gf_unit|gf_time|gf_example|gf_poly|gf_inline_time")
add_library(gf_complete STATIC ${GF_SRC})
target_include_directories(gf_complete PUBLIC "${TP}/gf-complete/include")
target_compile_options(gf_complete PRIVATE -w)

add_library(jerasure STATIC
	"${TP}/jerasure/src/galois.c"
	"${TP}/jerasure/src/jerasure.c"
	"${TP}/jerasure/src/reed_sol.c"
	"${TP}/jerasure/src/cauchy.c"
	"${TP}/jerasure/src/liberation.c")
target_include_directories(jerasure PUBLIC "${TP}/jerasure/include")
target_link_libraries(jerasure PUBLIC gf_complete)
target_compile_options(jerasure PRIVATE -w)

# --- protobuf runtime
add_library(nanopb STATIC "${TP}/nanopb/pb_common.c" "${TP}/nanopb/pb_decode.c" "${TP}/nanopb/pb_encode.c")
target_include_directories(nanopb PUBLIC "${TP}/nanopb")
target_compile_definitions(nanopb PUBLIC PB_C99_STATIC_ASSERT)

# --- protocol library
set(CHIAKI_LIB_ENABLE_OPUS 1)
set(CHIAKI_LIB_ENABLE_PI_DECODER 0)
configure_file("${CH}/config.h.in" "${CMAKE_CURRENT_BINARY_DIR}/gen/chiaki/config.h")

file(GLOB CHIAKI_SRC "${CH}/src/*.c" "${CH}/src/remote/*.c")
list(FILTER CHIAKI_SRC EXCLUDE REGEX "holepunch-test|ffmpegdecoder|pidecoder")
add_library(chiaki STATIC ${CHIAKI_SRC} "${CH}/generated/takion.pb.c")
target_include_directories(chiaki PUBLIC
	"${CMAKE_CURRENT_BINARY_DIR}/gen" "${CH}/include" "${CH}/generated" "${WRAP}"
	"${CMAKE_CURRENT_BINARY_DIR}/_deps" "${jsonc_BINARY_DIR}" "${miniupnp_BINARY_DIR}"
	"${mbedtls_SOURCE_DIR}/include")
target_compile_definitions(chiaki PUBLIC
	CHIAKI_LIB_ENABLE_MBEDTLS CURL_STATICLIB MINIUPNP_STATICLIB
	CHIAKI_VERSION_MAJOR=2 CHIAKI_VERSION_MINOR=11 CHIAKI_VERSION_PATCH=4 "CHIAKI_VERSION=\"2.11.4\"")
target_compile_options(chiaki PRIVATE -Wno-everything)
target_link_libraries(chiaki PUBLIC
	mbedtls mbedx509 mbedcrypto CURL::libcurl json-c libminiupnpc-static opus nanopb jerasure)
if(ANDROID)
	target_link_libraries(chiaki PUBLIC log)
endif()

# --- the core: commands and media, as on the desktop, without the desktop's own
# controller and HTTP plumbing. media_server.c is the desktop file, compiled
# against a small POSIX stand-in for the Win32 calls it makes.
add_library(hargan_ps_media OBJECT "${CORE}/src/media_server.c" "${CORE}/src/controller_io.c")
target_include_directories(hargan_ps_media BEFORE PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/compat")
target_link_libraries(hargan_ps_media PRIVATE chiaki)
target_compile_options(hargan_ps_media PRIVATE -Wno-pointer-sign -Wno-incompatible-pointer-types -Wno-int-conversion)

set(HARGAN_PS_SRC core.c $<TARGET_OBJECTS:hargan_ps_media>)
if(ANDROID)
	add_library(hargan_ps SHARED ${HARGAN_PS_SRC} jni.c)
	target_link_options(hargan_ps PRIVATE -Wl,--gc-sections -Wl,-z,max-page-size=16384)
else()
	add_library(hargan_ps STATIC ${HARGAN_PS_SRC})
endif()
target_include_directories(hargan_ps PRIVATE "${CORE}/src" "${CH}/src" "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(hargan_ps PRIVATE chiaki)
target_compile_options(hargan_ps PRIVATE -O2 -Wall -Wno-unused-parameter)
