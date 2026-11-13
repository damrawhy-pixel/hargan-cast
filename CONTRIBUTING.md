# Katkı rehberi

## Kurulum

Node.js 22+, CMake, Ninja ve llvm-mingw (`clang` PATH'te) gerekir.

```bash
npm install
```

```bash
npm run native
```

```bash
npm run dev
```

npm paket kurulum betiklerini çalıştırmıyorsa Electron'un kendisi inmemiş olabilir: `node node_modules/electron/install.js`.

## Göndermeden önce

```bash
npm run check
```

Tip denetimi (tam strict), lint ve birim testleri. CI ayrıca şunları çalıştırır:

| Komut | Ne yapar |
| --- | --- |
| `npm run test:ui` | Gerçek Electron uygulamasını geçici bir profille Playwright ile sürer. Hesabına dokunmaz. |
| `npm run test:native` | PS çekirdeğini derler ve DualSense biçim testlerini çalıştırır. |
| `npm run test:canary` | Microsoft ve Sony uç noktalarının beklenen biçimde yanıt verdiğini denetler (CI'da her sabah). |

## Kurallar

- **Masaüstünü bozma.** Telefon için yapılan bir değişiklik masaüstü davranışını değiştirmemeli. Telefona özel npm paketleri `devDependencies`'te kalır; yoksa masaüstü paketine girer.
- **Arayüz metinleri `t()` ile yazılır.** Kaynak dil Türkçedir: `t('Oyna')`. Aynı metin `src/shared/i18n/en.ts` sözlüğünde anahtar olarak bulunmalıdır; eksikse tip denetimi hata verir. Yer tutucular `{n}` biçimindedir ve çeviride aynen korunmalıdır (birim testi denetler).
- **Ana sürece yeni bir IPC kanalı** `src/main/index.ts` içindeki `listen` / `handle` ile eklenir; bunlar göndereni denetler. Preload'a ve `src/shared/types.ts` içindeki `HarganApi` tipine de eklenmelidir.
- **Loga token, çerez veya sorgu dizesi yazma.** `log()` bilinen biçimleri gizler ama ilk savunma çağıran taraftır; URL'ler için `safeUrl()` kullan.
- **Yeni bağımlılık** en az iki haftalık bir sürümle ve tam sürüm numarasıyla eklenir.
- **Dışarıdan bayt okuyan C kodu** (`native/ps-core`) için `fuzz/fuzz_reports.c` hedefine bir çağrı ekle.

## Commit ve sürüm

Commit mesajları ne değiştiğini ve nedenini anlatır. Sürüm çıkarmak için [docs/RELEASING.md](docs/RELEASING.md).
