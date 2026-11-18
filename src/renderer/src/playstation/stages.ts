import { t, type Message } from '../../../shared/i18n'

// The streaming core reports its progress as fixed English phrases.
const STAGES: [RegExp, Message][] = [
  [/^Getting Client IDs/, 'İstemci bilgileri alınıyor'],
  [/^Getting Configuration/, 'Yapılandırma alınıyor'],
  [/^Starting Session/, 'Oturum başlatılıyor'],
  [/^Getting (Server )?Tokens/, 'Anahtarlar alınıyor'],
  [/^Authorizing/, 'Oturum yetkilendiriliyor'],
  [/^Locking Session/, 'Oturum kilitleniyor'],
  [/^Closing old session/, 'Eski oturum kapatılıyor'],
  [/^Getting Datacenters/, 'Veri merkezleri alınıyor'],
  [/^Pinging Datacenters/, 'Veri merkezleri ölçülüyor'],
  [/^Selecting Datacenter/, 'Veri merkezi seçiliyor'],
  [/^Allocating streaming slot/i, 'Akış sunucusu ayrılıyor'],
  [/^Cloud Auth/, 'Bulut girişi yapılıyor'],
  [/^Resolving Game/, 'Oyun bulunuyor'],
  [/^Acquiring License/, 'Lisans alınıyor'],
  [/^Checking License/, 'Lisans denetleniyor'],
  [/^Creating Session/, 'Oturum oluşturuluyor'],
  [/^Connecting to console/, 'Konsola bağlanılıyor'],
  [/^Connecting through PSN/, 'PSN üzerinden konsola bağlanılıyor'],
]

export function psStage(stage: string) {
  const position = stage.match(/Queue position: (\d+)/)
  const migrating = stage.match(/^Migrating data \((\d+)%\)/)
  const step = stage.match(/Step (\d+) of (\d+)/)
  const text = migrating
    ? t('Oyun verileri taşınıyor (%{n})', { n: migrating[1] })
    : t(STAGES.find(([pattern]) => pattern.test(stage))?.[1] ?? 'Hazırlanıyor')
  return {
    text: `${text}${stage.includes('reconnecting') ? t(', yeniden bağlanılıyor') : ''}${step ? ` (${step[1]}/${step[2]})` : ''}`,
    position: position ? Number(position[1]) : undefined,
  }
}

export function psQuit(reason: string) {
  if (reason.includes('Server shut down')) return t('Sunucu kapandı, akış sona erdi')
  if (reason.includes('Remote has disconnected')) return t('Sunucu bağlantıyı kapattı')
  if (reason.includes('Connection Refused')) return t('Sunucu bağlantıyı reddetti')
  if (reason.includes('Remote Play on Console is already in use')) return t('Konsolda Uzaktan Oynatma şu an başka bir cihazda açık')
  if (reason.includes('Remote Play on Console has crashed')) return t('Konsolun Uzaktan Oynatma hizmeti durdu. Konsolu yeniden başlatmayı dene.')
  if (reason.includes('RP-Version mismatch')) return t('Konsolun sistem yazılımı bu sürümle uyumsuz. Konsolu güncelle.')
  if (reason.includes('in use')) return t('Bu hesapta başka bir akış açık')
  return t('PlayStation bağlantısı kesildi')
}

/** Quit reasons that mean the network failed, not the server or the account, so a new session can fix them. */
export function reconnectable(reason: string) {
  if (/Server shut down|in use|Refused|mismatch/.test(reason)) return false
  return /Stream Connection|Ctrl failed to connect|Unknown Ctrl Error/.test(reason)
}
