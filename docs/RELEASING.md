# Yayınlama rehberi

Hargan Cast'in yeni sürümü tek bir etiketle (tag) çıkar. GitHub üç platformu da derler ve hepsini içeren bir **taslak sürüm** açar. Taslağı yayımladığında Windows kopyaları kendini günceller; Android ve iOS paketlerini mağazalara yüklersin.

## Bir kerelik hazırlık

### Android (Google Play)

1. **Yükleme anahtarı:** Hazır. `Belgeler\Hargan Cast imza anahtari` klasöründe. Klasörü yedekle; içindeki `OKU.txt` her şeyi anlatıyor.
2. **Anahtarı GitHub'a ekle:** damrawhy-pixel hesabıyla GitHub'a girmişken https://github.com/damrawhy-pixel/hargan-cast/settings/secrets/actions/new adresini aç. *Name* kutusuna adı, *Secret* kutusuna değeri yazıp **Add secret**'e bas; üç değer için tekrarla:

   | Ad | Değer |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `github-ANDROID_KEYSTORE_BASE64.txt` dosyasının içeriği |
   | `ANDROID_KEYSTORE_PASSWORD` | `sifre.txt` dosyasının içeriği |
   | `ANDROID_KEY_ALIAS` | `upload` |

3. **Google Play Console hesabı:** play.google.com/console, bir kerelik 25 $. Kimlik doğrulaması birkaç gün sürebilir.
4. **Uygulamayı oluştur:** Uygulama adı *Hargan Cast*, varsayılan dil Türkçe, tür *Uygulama*, ücretsiz.
5. **Mağaza sayfası ve formlar:** Metinler, veri güvenliği formu ve içerik derecelendirmesi yanıtları [store/google-play.md](store/google-play.md) dosyasında. Gizlilik politikası adresi: `https://github.com/damrawhy-pixel/hargan-cast/blob/main/docs/privacy.md`
6. **Görseller:** 512×512 simge (`mobile/assets/icon-only.png`), 1024×500 tanıtım görseli ve en az iki telefon ekran görüntüsü. Ekran görüntülerini ilk testte telefondan al.
7. **Yeni kişisel hesaplar için kapalı test zorunlu:** Google, 2023'ten sonra açılan kişisel hesaplarda üretime çıkmadan önce en az 12 test kullanıcısıyla 14 günlük kapalı test ister. İlk `.aab` dosyasını *Kapalı test* kanalına yükle.

### iOS (App Store)

1. **Apple Developer Program:** developer.apple.com/programs, yılda 99 $.
2. **Uygulamayı oluştur:** App Store Connect > Uygulamalar > **+** > Yeni Uygulama. Platform iOS, ad *Hargan Cast*, paket kimliği (Bundle ID) **app.hargan.cast**. Paket kimliği listede yoksa önce developer.apple.com > Identifiers'ta aynı kimlikle oluştur.
3. **API anahtarı:** App Store Connect > Kullanıcılar ve Erişim > **Entegrasyonlar > App Store Connect API** > anahtar oluştur, rol *App Manager*. `.p8` dosyasını indir; yalnızca bir kez indirilebilir.
4. **GitHub'a ekle** (aynı adres: https://github.com/damrawhy-pixel/hargan-cast/settings/secrets/actions/new):

   | Ad | Değer |
   | --- | --- |
   | `ASC_KEY_ID` | Anahtarın kimliği (Key ID) |
   | `ASC_ISSUER_ID` | Sayfanın üstündeki Issuer ID |
   | `ASC_KEY_P8` | `.p8` dosyasının tüm içeriği |
   | `APPLE_TEAM_ID` | developer.apple.com > Membership'teki Team ID |

   Bunlar eklenince her sürümde iOS derlemesi Apple'ın imzasıyla doğrudan **TestFlight**'a yüklenir; sertifikayı ve profili Xcode kendisi oluşturur.
5. **Mağaza sayfası:** Metinler ve gizlilik yanıtları [store/app-store.md](store/app-store.md) dosyasında.

### Windows

İmza olmadan kurulum dosyası yine derlenir, ama Windows ilk açılışta "Windows kişisel bilgisayarınızı korudu" uyarısı gösterir (*Ek bilgi > Yine de çalıştır*). Uyarıyı kaldırmak için **Azure Trusted Signing** kullanılır (aylık yaklaşık 10 $):

1. **Azure hesabı:** portal.azure.com, kredi kartıyla açılır.
2. **Trusted Signing hesabı:** Portalda *Trusted Signing Accounts* > **Create**. Bölge seç (ör. West Europe), plan *Basic*. Oluşunca *Overview*'daki **Account URI** (ör. `https://weu.codesigning.azure.net/`) ve hesabın adı lazım olacak.
3. **Kimlik doğrulaması:** Hesabın *Identity validations* sayfasında bireysel (*Individual*) doğrulama başlat. Kimlik belgesiyle yapılır, birkaç gün sürebilir.
4. **Sertifika profili:** Doğrulama onaylanınca *Certificate profiles* > **Create**, tür *Public Trust*. Profilin adı ve sertifikadaki ad (*Subject* içindeki CN, genelde kendi adın) lazım olacak.
5. **GitHub için uygulama kaydı:** *Microsoft Entra ID* > *App registrations* > **New registration** (ad: `hargan-cast-release`). *Certificates & secrets* > **New client secret**; değeri hemen kopyala. Ardından Trusted Signing hesabının *Access control (IAM)* sayfasında bu uygulamaya **Trusted Signing Certificate Profile Signer** rolünü ver.
6. **GitHub'a ekle** (https://github.com/damrawhy-pixel/hargan-cast/settings/secrets/actions/new):

   | Ad | Değer |
   | --- | --- |
   | `AZURE_TENANT_ID` | Uygulama kaydının *Directory (tenant) ID* değeri |
   | `AZURE_CLIENT_ID` | Uygulama kaydının *Application (client) ID* değeri |
   | `AZURE_CLIENT_SECRET` | 5. adımda kopyaladığın gizli değer |
   | `AZURE_SIGN_ENDPOINT` | Account URI |
   | `AZURE_SIGN_ACCOUNT` | Trusted Signing hesabının adı |
   | `AZURE_SIGN_PROFILE` | Sertifika profilinin adı |
   | `AZURE_SIGN_PUBLISHER` | Sertifikadaki ad (CN), harfi harfine |

Bunlar eklenince her sürümde kurulum dosyası imzalanır ve imzası iş içinde denetlenir. Eksikken iş bir uyarı yazar ve imzasız devam eder.

> İmzalı ilk sürümden sonra yayıncı adını değiştirme: kurulu kopyalar güncellemenin aynı yayıncıdan geldiğini denetler.

## Her sürümde

1. `package.json` içindeki `version` alanını artır (ör. `0.3.0`).
2. Değişiklikleri gönder ve etiketi it:

   ```bash
   git tag v0.3.0
   ```

   ```bash
   git push origin v0.3.0
   ```

3. GitHub > Actions > **Release** işinin bitmesini bekle (yaklaşık 25 dakika). Sonunda **Releases** sayfasında taslak bir sürüm oluşur:
   - `HarganCast-Setup-0.3.0.exe`: Windows kurulum dosyası
   - `HarganCast-0.3.0.aab`: Google Play'e yüklenecek paket (anahtar eklendiyse)
   - `HarganCast-0.3.0.apk`: Doğrudan kurulabilen Android paketi
   - `HarganCast-0.3.0-unsigned.ipa`: AltStore veya Sideloadly ile kurulabilen iOS paketi
4. Testlerden sonra taslağı **Publish release** ile yayımla. Windows'ta kurulu kopyalar yeni sürümü arka planda indirir ve uygulama kapanınca kurar.
5. `.aab` dosyasını Play Console'a yükle. iOS derlemesi TestFlight'ta kendiliğinden belirir; oradan incelemeye gönder.

Sürüm numarası paketlere kendiliğinden işlenir: `0.3.0` için Android ve iOS derleme numarası `30099`, ön sürüm `0.3.0-beta.2` için `30002` olur; böylece ön sürümler asıl sürümden önce sıralanır. Ara ve yama numarası en fazla 99, ön sürüm numarası 1-98 olabilir; uymayan bir etiket derlemeyi durdurur.
