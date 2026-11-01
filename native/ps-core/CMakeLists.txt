# hargan-ps-core: the PlayStation streaming sidecar.
# Links the PlayStation protocol library (AGPL-3.0, see third_party/chiaki/COPYING)
# into one static executable. Built with llvm-mingw so no MSVC runtime ships.
cmake_minimum_required(VERSION 3.24)
project(hargan_ps_core C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)
set(CMAKE_POLICY_DEFAULT_CMP0077 NEW)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE Release)
endif()

set(TP "${CMAKE_CURRENT_SOURCE_DIR}/../third_party")
set(CH "${TP}/chiaki")

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# --- mbedTLS: the crypto the protocol needs (AES, ECDH, HMAC), no OpenSSL or Perl.
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
FetchContent_Declare(mbedtls
	GIT_REPOSITORY https://github.com/Mbed-TLS/mbedtls.git
	GIT_TAG 8b3f26a5ac38d4fdccbc5c5366229f3e01dafcc0 # v2.28.0
	GIT_SHALLOW FALSE)

# --- libcurl over Schannel: TLS and CA store come from Windows itself.
set(BUILD_CURL_EXE OFF CACHE BOOL "" FORCE)
set(BUILD_LIBCURL_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_MISC_DOCS OFF CACHE BOOL "" FORCE)
set(ENABLE_CURL_MANUAL OFF CACHE BOOL "" FORCE)
set(CURL_DISABLE_INSTALL ON CACHE BOOL "" FORCE)
set(HTTP_ONLY ON CACHE BOOL "" FORCE)
set(ENABLE_WEBSOCKETS ON CACHE BOOL "" FORCE)
set(CURL_USE_SCHANNEL ON CACHE BOOL "" FORCE)
set(CURL_USE_LIBPSL OFF CACHE BOOL "" FORCE)
set(CURL_USE_LIBSSH2 OFF CACHE BOOL "" FORCE)
set(USE_LIBIDN2 OFF CACHE BOOL "" FORCE)
set(USE_NGHTTP2 OFF CACHE BOOL "" FORCE)
set(CURL_ZLIB OFF CACHE STRING "" FORCE)
set(CURL_BROTLI OFF CACHE STRING "" FORCE)
set(CURL_ZSTD OFF CACHE STRING "" FORCE)
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

FetchContent_MakeAvailable(mbedtls curl jsonc miniupnp opus)

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
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/gen/chiaki/version.h.tmp"
	"#ifndef CHIAKI_VERSION_H\n#define CHIAKI_VERSION_H\n#define CHIAKI_VERSION_MAJOR 2\n#define CHIAKI_VERSION_MINOR 11\n#define CHIAKI_VERSION_PATCH 4\n#define CHIAKI_VERSION \"2.11.4\"\n#endif\n")
configure_file("${CMAKE_CURRENT_BINARY_DIR}/gen/chiaki/version.h.tmp" "${CMAKE_CURRENT_BINARY_DIR}/gen/chiaki/version.h" COPYONLY)

file(GLOB CHIAKI_SRC "${CH}/src/*.c" "${CH}/src/remote/*.c")
list(FILTER CHIAKI_SRC EXCLUDE REGEX "holepunch-test|ffmpegdecoder")
add_library(chiaki STATIC ${CHIAKI_SRC} "${CH}/generated/takion.pb.c")
target_include_directories(chiaki PUBLIC
	"${CMAKE_CURRENT_BINARY_DIR}/gen" "${CH}/include" "${CH}/generated" "${WRAP}"
	"${CMAKE_CURRENT_BINARY_DIR}/_deps" "${jsonc_BINARY_DIR}" "${miniupnp_BINARY_DIR}"
	"${mbedtls_SOURCE_DIR}/include")
target_compile_definitions(chiaki PUBLIC
	CHIAKI_LIB_ENABLE_MBEDTLS CURL_STATICLIB
	MINIUPNP_STATICLIB WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00
	CHIAKI_VERSION_MAJOR=2 CHIAKI_VERSION_MINOR=11 CHIAKI_VERSION_PATCH=4 "CHIAKI_VERSION=\"2.11.4\"")
target_compile_options(chiaki PRIVATE -Wno-everything)
target_link_libraries(chiaki PUBLIC
	mbedtls mbedx509 mbedcrypto CURL::libcurl json-c libminiupnpc-static opus nanopb jerasure
	ws2_32 wsock32 bcrypt iphlpapi crypt32 secur32 winmm)

# --- the sidecar
set(CORE_SRC src/main.c src/media_server.c src/controller_io.c src/dualsense.c src/dualsense_report.c src/haptics.c)
set(CORE_LIBS chiaki hid setupapi ole32 uuid)
add_executable(hargan-ps-core ${CORE_SRC})
target_link_libraries(hargan-ps-core PRIVATE ${CORE_LIBS})
target_include_directories(hargan-ps-core PRIVATE "${CH}/src")
target_compile_options(hargan-ps-core PRIVATE -O2 -Wall -Wextra -Wno-unused-parameter)
target_link_options(hargan-ps-core PRIVATE -static -s)
set_target_properties(hargan-ps-core PROPERTIES
	RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../bin")

# Same program plus a capture-replay command, for end-to-end media tests. Never shipped.
add_executable(hargan-ps-core-diag EXCLUDE_FROM_ALL ${CORE_SRC})
target_link_libraries(hargan-ps-core-diag PRIVATE ${CORE_LIBS})
target_include_directories(hargan-ps-core-diag PRIVATE "${CH}/src")
target_compile_definitions(hargan-ps-core-diag PRIVATE HARGAN_DIAG)
target_link_options(hargan-ps-core-diag PRIVATE -static)
set_target_properties(hargan-ps-core-diag PROPERTIES
	RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../build/diag")

# Byte-level tests of the DualSense formats; needs no controller.
add_executable(hargan-ds-test EXCLUDE_FROM_ALL test/dualsense_test.c src/dualsense.c src/dualsense_report.c src/haptics.c)
target_link_libraries(hargan-ds-test PRIVATE ${CORE_LIBS})
target_include_directories(hargan-ds-test PRIVATE src)
target_link_options(hargan-ds-test PRIVATE -static)
set_target_properties(hargan-ds-test PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../build/diag")
