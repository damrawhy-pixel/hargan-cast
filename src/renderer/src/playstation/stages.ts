// The streaming core reports its progress as fixed English phrases.
const STAGES: [RegExp, string][] = [
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
]

export function psStage(stage: string) {
  const position = stage.match(/Queue position: (\d+)/)
  const migrating = stage.match(/^Migrating data \((\d+)%\)/)
  const step = stage.match(/Step (\d+) of (\d+)/)
  const text = migrating
    ? `Oyun verileri taşınıyor (%${migrating[1]})`
    : (STAGES.find(([pattern]) => pattern.test(stage))?.[1] ?? 'Hazırlanıyor')
  return {
    text: `${text}${stage.includes('reconnecting') ? ', yeniden bağlanılıyor' : ''}${step ? ` (${step[1]}/${step[2]})` : ''}`,
    position: position ? Number(position[1]) : undefined,
  }
}

export function psQuit(reason: string) {
  if (reason.includes('Server shut down')) return 'Sunucu kapandı, akış sona erdi'
  if (reason.includes('Remote has disconnected')) return 'Sunucu bağlantıyı kapattı'
  if (reason.includes('Connection Refused')) return 'Sunucu bağlantıyı reddetti'
  if (reason.includes('in use')) return 'Bu hesapta başka bir akış açık'
  return 'PlayStation bağlantısı kesildi'
}
