# Güvenlik

## Açık bildirme

Bir güvenlik açığı bulursan herkese açık bir issue açma. GitHub'da depo sayfasındaki **Security > Report a vulnerability** ile özel olarak bildir. Mümkünse adımları, etkilenen sürümü ve tanılama dosyasını (Ayarlar > Hesaplar > Tanılama dosyası) ekle; bu dosya hesap bilgisi içermez.

Desteklenen sürüm yalnızca en son yayımlanan sürümdür. Masaüstü kopyaları kendini otomatik günceller.

## Tehdit modeli

Uygulama iki hesabın oturumunu taşır: Sony NPSSO çerezi ve Xbox/Microsoft token'ları. Bunlar ele geçirilirse hesaba erişilebilir; korunması gereken asıl değer budur.

| Tehdit | Önlem |
| --- | --- |
| Diskteki token'ların okunması | Masaüstünde her hesap Windows DPAPI ile şifreli ayrı bir kasada (`vault/*.bin`); çerezler Chromium çerez şifrelemesiyle (Electron fuse). Telefonda token'lar yedeklere ve cihazdan cihaza aktarıma girmez. |
| Kurulu exe'nin Node olarak çalıştırılıp kasanın okunması | Electron fuse'ları: `RunAsNode`, `NODE_OPTIONS` ve `--inspect` kapalı; uygulama yalnızca bütünlüğü denetlenen `app.asar`'dan yüklenir. |
| Arayüze kod enjekte edilmesi (XSS) | Renderer sandbox'ta, `contextIsolation` açık, Node yok. Sıkı CSP: yalnızca kendi betikleri, ağ bağlantısı yalnızca loopback PS çekirdeğine, görseller yalnızca Sony ve Microsoft görsel sunucularından; `object`, `frame`, `form` ve `base` kapalı. |
| Yabancı bir sayfanın ana sürece komut göndermesi | IPC yalnızca uygulamanın kendi sayfasından (`hargan://app/`) kabul edilir; diğerleri reddedilir ve loglanır. Giriş pencereleri yeni pencere açamaz, `webview` ekleyemez, https dışına gidemez, tarayıcı izni alamaz. |
| Yerel başka bir programın akışa bağlanması | PS çekirdeğinin medya soketi yalnızca 127.0.0.1'de dinler, tek istemci kabul eder ve her başlatmada üretilen 128 bit bir anahtar ister. Girdi çerçeveleri boyutla sınırlıdır; ayrıştırıcılar CI'da libFuzzer + ASan/UBSan ile denenir. |
| Logların veya tanılama dosyasının sızdırılması | Loga yazılmadan önce bearer/XBL token'ları, NPSSO, URL sorguları ve JWT'ler gizlenir. Tanılama dosyası TURN kimlik bilgilerini gizler; çökme dökümlerini yalnızca adıyla listeler, içeriğini koymaz. |
| Sahte güncelleme veya kurulum dosyası | Güncellemeler yalnızca bu deponun GitHub sürümlerinden gelir. İmzalama secret'ları eklendiğinde kurulum, uygulama ve PS çekirdeği Azure Trusted Signing ile imzalanır. Her sürüm dosyası GitHub build provenance taşır (`gh attestation verify`) ve bir SBOM ile gelir. |
| Bağımlılık zinciri | Yeni paket sürümleri en az iki hafta beklemeden alınmaz (Dependabot `cooldown`); CI her değişiklikte tip, lint ve test denetimi yapar. |

## Kapsam dışı

- Sony veya Microsoft hizmetlerindeki açıklar: ilgili şirkete bildir.
- Kullanıcının kendi bilgisayarında yönetici yetkisi olan bir saldırgan: DPAPI dahil hiçbir yerel önlem buna karşı koruma sağlamaz.
- Ayarlar'daki "Bölge" seçeneği isteği başka bir ülkeden geliyormuş gibi gösterir; bu bir güvenlik özelliği değildir ve hizmet koşullarıyla çatışabilir.
