# Hargan Cast

PlayStation ve Xbox bulut oyun servislerini tek uygulamada, birbirinden tamamen ayrı iki alan olarak sunan Windows istemcisi.

## Mimari

```
Electron ana süreç
├─ Xbox alanı: giriş ve oturum (src/main/xbox)     → WebRTC, Chromium içinde
└─ PlayStation alanı: giriş, sidecar yönetimi      → hargan-ps-core.exe
                                                        │ loopback WebSocket
Renderer: React arayüzü + stream.worker (WebCodecs) ◄───┘
```

- **Hesap ayrımı:** her servis kendi tarayıcı bölümünü (`persist:xbox`, `persist:playstation`) ve kendi DPAPI ile şifreli kasasını kullanır. Birinden çıkmak diğerine dokunmaz.
- **PlayStation yolu:** protokol kütüphanesi ayrı bir süreçte çalışır, çökmesi arayüzü düşürmez. H.264/H.265 kareleri GPU'da WebCodecs ile çözülür, ses AudioWorklet ile çalınır.
- **HTTP:** çekirdeğin tüm istekleri `src/main/playstation/httpBridge.ts` ile Chromium ağ katmanından geçer.
- **Xbox yolu:** WebRTC oynatıcısı üzerinden, yalnızca akış başlarken yüklenir.

## DualSense

PlayStation akışında kol doğrudan HID üzerinden okunur (`native/ps-core/src/dualsense.c`), girdi JavaScript'ten geçmez.

| Özellik | USB | Bluetooth |
| --- | --- | --- |
| Düğmeler, çubuklar, tetikler | Var | Var |
| Jiroskop ve ivmeölçer | Var | Var |
| Dokunmatik yüzey | Var | Var |
| Uyarlanabilir tetikler | Var | Var |
| Işık çubuğu, oyuncu ışıkları | Var | Var |
| Gerçek dokunsal geri bildirim | Var (kolun ses aygıtından) | Motorlarla yaklaşık |

Windows'ta kolun ses aygıtı 4 kanal olmalıdır. Bluetooth üzerinden dokunsal ses Windows'ta sunulmadığı için motorlara çevrilir.

## Geliştirme

Gereken: Node.js 22+, CMake, Ninja, llvm-mingw (`clang` PATH'te).

```bash
npm install
```

```bash
npm run native
```

```bash
npm run dev
```

Dağıtım klasörü: `npm run dist`. Tip denetimi: `npm run typecheck`. Kol biçimi testleri, kol gerekmeden: `hargan-ds-test` CMake hedefi.

## Kısayollar

| Tuş | İşlev |
| --- | --- |
| F11 / Alt+Enter | Tam ekran |
| Esc | Akış menüsü |
| F3 | İstatistikler |
| Kol: LB / RB | Alanlar arasında geçiş |
| Kol: D-pad, sol çubuk, A | Kitaplıkta gezinme ve başlatma |

PlayStation klavye eşlemesi: Z ✕, X ○, A □, S △, Q L1, E R1, C L2, V R2, Enter Options, Backspace Share, T dokunmatik, Home PS.

## Arayüz

Ana sayfa iki servisi tek hub'da toplar: seçili oyuna göre değişen sahne, son oynananlar ve raflar. Veriler `src/renderer/src/lib/store.ts` içinde toplanır, Xbox bulut kataloğu ile hesap kütüphanesi isimle eşleştirilir. Animasyonlar yalnızca `transform` ve `opacity` kullanır, Windows'ta hareket azaltma tercih edilmişse kapanır.

## Ayarlar

Tüm ayarlar **Ayarlar** sekmesindedir ve şifreli olarak `vault/settings.bin` dosyasında tutulur. Tanı günlüğü `logs/hargan.log` dosyasındadır, token içermez.

## Sınırlar

Henüz yok: mikrofon, konsoldan Remote Play ve Xbox ev akışı.

## Sorun giderme

Sony veya Xbox hostlarında `ERR_SSL_PROTOCOL_ERROR`, TLS zaman aşımı ya da boş katalog görülüyorsa TLS paketlerine dokunan araçları kapat (GoodbyeDPI, zapret, antivirüs TLS taraması).

## Lisans

AGPL-3.0. Telif ve üçüncü taraf bildirimleri `NOTICE.md` dosyasındadır; uygulamayı başkasına verirsen bu dosyalar ve kaynak kodu onunla birlikte sunulmalıdır.
