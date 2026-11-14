# Steam Deck

Hargan Cast'in Windows sürümü Steam Deck'te Proton ile çalışır. Uygulama Proton altında olduğunu kendisi anlar: Chromium'un Wine'da çalışmayan işletim sistemi sandbox'ını kapatır ve Oyun Modu'nda tam ekran açılır. Ek başlatma seçeneği gerekmez.

> Durum: Deck'te henüz bir kullanıcı tarafından denenmedi. Bir sorun görürsen Ayarlar > Hesaplar > **Tanılama dosyası**'nı kaydet; dosyada "ortam: Proton/Wine, Steam Deck" satırı ve log bulunur.

## Kurulum

1. Deck'i **Masaüstü Modu**'na al.
2. GitHub sürüm sayfasından `HarganCast-Setup-<sürüm>.exe` dosyasını indir.
3. Steam > **Oyun Ekle > Steam Dışı Oyun Ekle** ile indirdiğin `.exe`'yi ekle.
4. Eklenen girişin **Özellikler > Uyumluluk** bölümünde *Belirli bir Steam Play uyumluluk aracını kullanmaya zorla* seçeneğini aç ve **Proton Experimental**'ı seç.
5. Girişi bir kez başlat: kurulum Proton'un sanal Windows'una kurulur ve uygulama açılır. Kapat.
6. Girişin **Özellikler > Kısayol** bölümünde *Hedef*'i kurulan uygulamaya çevir:

   ```
   "C:\users\steamuser\AppData\Local\Programs\Hargan Cast\Hargan Cast.exe"
   ```

   *Başlangıç konumu*: `"C:\users\steamuser\AppData\Local\Programs\Hargan Cast\"`

7. Oyun Modu'na dön; Hargan Cast kitaplıkta *Steam Dışı* altında görünür. Güncellemeler masaüstündeki gibi kendiliğinden gelir.

## Kontroller

Deck'in kendi düğmeleri Steam Input üzerinden bir Xbox kolu olarak görünür; arayüzde gezinme ve iki serviste de oyun bununla çalışır. Steam Input şablonu olarak **Gamepad** seçili olsun.

| Düğme | İşlev |
| --- | --- |
| LB / RB | Alanlar arasında geçiş |
| D-pad, sol çubuk, A | Gezinme ve başlatma |
| View + Menu (basılı tut) | Akış menüsü |

PlayStation akışında jiroskop ve dokunmatik yüzey için bir DualSense bağlanabilir. Proton'un HID desteği kola bağlıdır; çalışmazsa Ayarlar > DualSense > **Doğrudan bağlantı**'yı kapat, kol yine normal bir kol gibi çalışır.

## Önerilen ayarlar

Deck'in ekranı 1280×800'dür ve video çözme işi işlemcide yapılabilir; daha düşük çözünürlük hem pili hem gecikmeyi korur.

- **PlayStation > Çözünürlük:** 720p, **FSR:** açık (görüntüyü 800p'ye büyütür)
- **Xbox > Çözünürlük:** 720p
- **Genel > Vulkan:** kapalı
- Bağlantıyı Ayarlar > **Ağ > Bağlantı testi** ile denetle; Deck'te 5 GHz Wi-Fi şart sayılır.

Oyun başına farklı bir ayar istersen oyunun sayfasındaki **Bu oyuna özel ayarlar** bölümünü kullan.
