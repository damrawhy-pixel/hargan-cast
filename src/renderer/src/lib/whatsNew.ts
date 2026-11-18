// What each version brought, shown once after an update (WhatsNew.tsx). Newest
// first; the words are interface messages, so they follow the chosen language.
import type { Message } from '../../../shared/i18n'

export const RELEASES: { version: string; items: Message[] }[] = [
  {
    version: '1.2.0',
    items: [
      'Akış sırasında Wi-Fi taraması durur; Wi-Fi takılmaları azalır.',
      'Akış paketleri ses ve görüntü önceliğiyle gönderilir.',
      'Dizüstülerde güçlü ekran kartı kullanılır.',
      'Görüntü süzgeçlerinin ekran kartındaki süresi ölçülür; yetişemezse en ağırı kapanır.',
      'Oyun sayfasında, son akışlara göre bit hızı önerisi.',
      'Ayarlar > Ağ: ev dışından konsola bağlanma testi.',
      "Xbox oyunlarının tetik titreşimi DualSense'in tetiklerinde.",
      'Dokunmatik düğmeler taşınıp boyutlandırılabilir.',
      'Oturma odası görünümü: TV ve Steam Deck için daha büyük arayüz.',
      'Yeni diller: Almanca ve Arapça.',
      "iPhone ve iPad'de doğrudan görüntü (VideoToolbox).",
      'Mac için ilk sürüm (Apple silikon).',
    ],
  },
]

const parts = (v: string) => v.split('-')[0].split('.').map(Number)

export function newer(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** What came after `seen`, up to and including `current`. */
export const changesSince = (seen: string, current: string) => RELEASES.filter((r) => newer(r.version, seen) && !newer(r.version, current))
