# Bildirimler / Notices

Hargan Cast is licensed under the GNU Affero General Public License v3.0
(see `LICENSE`), with the additional OpenSSL permission inherited from Chiaki
(see `native/third_party/chiaki/LICENSES/AGPL-3.0-only-OpenSSL.txt`).

Hargan Cast is not affiliated with, endorsed by or certified by Sony Interactive
Entertainment or Microsoft. PlayStation and Xbox are trademarks of their
respective owners and are used only to name the services this software connects to.

## Modified works

- `native/third_party/chiaki/`: the protocol library from Pylux
  (https://github.com/ForWard-Technologies-LLC/Pylux), itself based on chiaki-ng
  (https://github.com/streetpea/chiaki-ng) and Chiaki
  (https://git.sr.ht/~thestr4ng3r/chiaki). AGPL-3.0-only with OpenSSL exception.
  Modified 2026-11-01: removed the iOS bridge, Raspberry Pi decoder and FFmpeg decoder
  from the build, checked in the generated Takion protobuf code, and added a pluggable
  HTTP transport to `src/curl_http.c` so requests can run on Chromium's network stack.
- `src/main/xbox/xal`, `src/main/xbox/helpers`, `src/main/xbox/authentication.ts`:
  from XStreaming Desktop (https://github.com/Geocld/XStreamingDesktop).
  Modified 2026-11-01: moved to an encrypted per-account store and an isolated browser
  partition, added request timeouts, and removed token logging, Discord presence, the
  updater and MSAL login.

XStreaming Desktop is distributed under this licence:

> The MIT License (MIT)
> Copyright (c) 2024 Geocld (lijiahao5372@gmail.com)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Third-party components

| Component | Licence | Use |
| --- | --- | --- |
| xstreaming-player | MIT | Xbox WebRTC player (npm) |
| AMD FidelityFX Super Resolution 1.0 | MIT | Upscaling and sharpening algorithm, reimplemented in `src/renderer/src/lib/picture.ts` |
| Electron, React, Vite | MIT | Application shell |
| nanopb | zlib | `native/third_party/nanopb` |
| Jerasure, GF-Complete | BSD-3-Clause | `native/third_party/` |
| Mbed TLS | Apache-2.0 | Fetched at native build time |
| curl | curl licence | Fetched at native build time |
| json-c | MIT | Fetched at native build time |
| miniupnpc | BSD-3-Clause | Fetched at native build time |
| Opus | BSD-3-Clause | Fetched at native build time |
