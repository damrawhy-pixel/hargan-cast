# Hargan Cast Gizlilik Politikası

Son güncelleme: 9 Kasım 2026

Hargan Cast; Windows, Android ve iOS için bir bulut oyun istemcisidir. Kendi Xbox ve PlayStation hesaplarınla, o hesaplarda zaten oynayabildiğin oyunları akışla oynamanı sağlar. Bu metin, uygulamanın hangi bilgileri nasıl kullandığını anlatır.

## Kısaca

- Hargan Cast'in kendi sunucusu yoktur. Uygulama yalnızca Microsoft'un ve Sony'nin sunucularıyla doğrudan konuşur.
- Hiçbir kişisel veri toplanmaz, satılmaz ya da paylaşılmaz. Reklam, analiz veya izleme aracı yoktur.
- Hesap bilgilerin yalnızca kendi cihazında saklanır.

## Cihazında saklanan bilgiler

| Bilgi | Neden | Nerede |
| --- | --- | --- |
| Microsoft/Xbox oturum anahtarları | Xbox hesabına her açılışta yeniden giriş yapmamak için | Windows'ta şifreli olarak kullanıcı klasöründe; telefonda uygulamanın kendi korumalı alanında |
| PlayStation oturum anahtarı (NPSSO) | PlayStation kataloğunu yüklemek ve akış başlatmak için | Aynı şekilde, yalnızca cihazında |
| Uygulama ayarları | Seçtiğin görüntü, ses ve kontrol ayarlarını hatırlamak için | Yalnızca cihazında |
| PlayStation katalog önbelleği | Kataloğu her seferinde baştan indirmemek için | Yalnızca cihazında |

Bu bilgiler cihazından Hargan Cast'e ya da başka bir yere gönderilmez. Hesaptan çıkış yaptığında oturum anahtarları silinir; uygulamayı kaldırdığında hepsi silinir.

## Uygulamanın bağlandığı yerler

- **Microsoft (Xbox):** Hesap girişi, oyun listesi, oyun bilgileri ve bulut akışı. Bu bağlantılar Microsoft'un gizlilik bildirimine tabidir: https://privacy.microsoft.com
- **Sony (PlayStation):** Hesap girişi, oyun kataloğu, mağaza bilgileri ve bulut akışı. Bu bağlantılar Sony Interactive Entertainment'ın gizlilik politikasına tabidir: https://www.playstation.com/legal/privacy-policy/
- **GitHub (yalnızca Windows sürümü):** Yeni sürüm olup olmadığını denetlemek ve güncellemeyi indirmek için. Bu sırada GitHub'a kimlik bilgisi gönderilmez.
- **Cloudflare (yalnızca bağlantı testinde, Windows sürümü):** Ayarlar > Ağ > Bağlantı testi'ni başlattığında indirme hızını ölçmek için speed.cloudflare.com'dan birkaç saniye boyunca anlamsız veri indirilir. Hiçbir bilgi gönderilmez; test başlatılmadıkça bu bağlantı kurulmaz.

Hesap girişleri Microsoft'un ve Sony'nin kendi giriş sayfalarında yapılır; şifren Hargan Cast'ten geçmez ve uygulama şifreni hiçbir zaman görmez.

Oyun akışı sırasında görüntü, ses ve kumanda girdileri yalnızca cihazınla Microsoft'un veya Sony'nin sunucuları arasında gider. PlayStation akışında görüntü, cihazın içinde uygulamanın bir bölümünden ötekine yerel bir bağlantıyla (127.0.0.1) aktarılır; bu bağlantı cihazdan dışarı çıkmaz.

## Android izinleri

- **İnternet, ağ ve Wi-Fi durumu:** Hesaplara ve akış sunucularına bağlanmak için.
- **Uyanık tutma:** Akış sırasında ekranın ve Wi-Fi'ın uykuya geçmemesi için.
- **Titreşim:** Ekran kontrollerine dokununca kısa titreşim vermek için.

## Çocuklar

Hargan Cast 13 yaşından küçük çocuklara yönelik değildir ve bilerek hiçbir çocuktan bilgi toplamaz. Xbox ve PlayStation hesaplarının yaş kuralları ve aile ayarları, Microsoft'un ve Sony'nin kendi hizmetlerinde uygulanmaya devam eder.

## Bağlantı

Hargan Cast, Sony Interactive Entertainment veya Microsoft ile ilişkili değildir. PlayStation ve Xbox, ilgili sahiplerinin ticari markalarıdır.

Sorular için: https://github.com/damrawhy-pixel/hargan-cast/issues

Bu politika değişirse güncel hali bu sayfada yayımlanır.

---

# Hargan Cast Privacy Policy

Last updated: November 9, 2026

Hargan Cast is a cloud gaming client for Windows, Android and iOS. It lets you stream games you can already play with your own Xbox and PlayStation accounts. This page explains what information the app uses and how.

## In short

- Hargan Cast has no servers of its own. The app talks directly to Microsoft's and Sony's servers only.
- No personal data is collected, sold or shared. There are no ads, analytics or tracking tools.
- Your account details are stored only on your own device.

## Stored on your device

- **Microsoft/Xbox session tokens**, so you stay signed in. Encrypted in your user folder on Windows; in the app's private storage on phones.
- **PlayStation session token (NPSSO)**, to load the PlayStation catalog and start streams. Stored only on your device.
- **App settings** and a **PlayStation catalog cache**. Stored only on your device.

None of this is sent to Hargan Cast or anywhere else. Signing out deletes the session tokens; uninstalling the app deletes everything.

## Where the app connects

- **Microsoft (Xbox):** sign-in, game list, game details and cloud streaming, governed by https://privacy.microsoft.com
- **Sony (PlayStation):** sign-in, game catalog, store details and cloud streaming, governed by https://www.playstation.com/legal/privacy-policy/
- **GitHub (Windows version only):** checking for and downloading app updates. No account details are sent.
- **Cloudflare (connection test only, Windows version):** when you run Settings > Network > Connection test, a few seconds of filler data are downloaded from speed.cloudflare.com to measure download speed. Nothing is sent, and no connection is made unless you start the test.

Sign-in happens on Microsoft's and Sony's own pages; your password never passes through Hargan Cast. During a stream, video, audio and controller input travel only between your device and Microsoft's or Sony's servers. For PlayStation streams, video is handed between parts of the app over a local connection (127.0.0.1) that never leaves the device.

## Android permissions

Internet, network and Wi-Fi state (to reach the services), wake lock (to keep the screen and Wi-Fi awake while streaming) and vibration (a short tap feedback on the on-screen controls).

## Children

Hargan Cast is not directed to children under 13 and does not knowingly collect information from anyone.

## Contact

Hargan Cast is not affiliated with Sony Interactive Entertainment or Microsoft. PlayStation and Xbox are trademarks of their respective owners.

Questions: https://github.com/damrawhy-pixel/hargan-cast/issues

If this policy changes, the current version is published on this page.
