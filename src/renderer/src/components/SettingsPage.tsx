import { useEffect, useState, type ReactNode } from 'react'
import { XBOX_REGIONS, type AppSettings } from '../../../shared/settings'
import type { PsDatacenter, PsStatus, XboxStatus } from '../../../shared/types'
import { testDualSenseSpeaker } from '../lib/speaker'
import { resetSettings, updateSettings, useSettings } from '../lib/useSettings'

const LANGUAGES: [string, string][] = [
  ['tr-TR', 'Türkçe'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'],
  ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'],
  ['pt-PT', 'Português (Portugal)'], ['ru-RU', 'Русский'], ['pl-PL', 'Polski'], ['nl-NL', 'Nederlands'], ['sv-SE', 'Svenska'],
  ['nb-NO', 'Norsk'], ['da-DK', 'Dansk'], ['fi-FI', 'Suomi'], ['cs-CZ', 'Čeština'], ['sk-SK', 'Slovenčina'], ['hu-HU', 'Magyar'],
  ['el-GR', 'Ελληνικά'], ['he-IL', 'עברית'], ['ar-SA', 'العربية'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'],
]
const RESOLUTIONS: [number, string][] = [[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']]
const PS_BITRATES: [number, string][] = [[0, 'Otomatik'], ...[5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000].map((b): [number, string] => [b, `${b / 1000} Mb/sn`])]
const PS_BITRATE_HINT = 'Otomatik, çözünürlüğe göre seçer: 1080p için 20, 4K için 40 Mb/sn.'
const FSR_HINT = 'Görüntüyü ekran boyutuna AMD FSR ile büyütür ve keskinleştirir. Görüntü ekrandan küçükse en çok fark eder.'
const DEBAND_HINT = 'Koyu ve düz renk geçişlerinde sıkıştırmanın bıraktığı basamakları yumuşatır.'
// Microsoft sends at most about 27 Mb/s, so a higher cap would change nothing.
const XBOX_BITRATES: [number, string][] = [[0, 'Sınırsız'], ...[5, 10, 15, 20].map((b): [number, string] => [b, `En fazla ${b} Mb/sn`])]
const POLL_RATES: [number, string][] = [250, 83.33, 62.5, 50, 41.67, 35.71, 31.25, 27.78, 25, 22.73, 20.83, 19.23, 17.86, 16.67].map((r) => [r, `${r} Hz`])

const SECTIONS = [
  ['general', 'Genel'], ['picture', 'Görüntü'], ['sound', 'Ses'], ['playstation', 'PlayStation'],
  ['dualsense', 'DualSense'], ['xbox', 'Xbox'], ['xboxInput', 'Xbox kol ve giriş'], ['accounts', 'Hesaplar'],
] as const
type Section = (typeof SECTIONS)[number][0]

const clean = (e: Error) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function HapticTest() {
  const [state, setState] = useState<'idle' | 'playing'>('idle')
  const [note, setNote] = useState('Kol USB ile bağlıyken titreşim sol tutamaktan sağa geçer.')

  const run = async () => {
    setState('playing')
    try {
      const played = await window.hc.ps.testHaptics()
      setNote(played ? 'Çalındı. Sol ve sağ tutamakta hissetmen gerekiyor.' : 'Kol bulunamadı. Dokunsal geri bildirim yalnızca USB bağlantısında çalışır.')
    } catch (e) {
      setNote(clean(e as Error))
    }
    setState('idle')
  }

  return (
    <Row label="Titreşimi dene" hint={note}>
      <button className="ghost" data-nav disabled={state === 'playing'} onClick={() => void run()}>{state === 'playing' ? 'Çalıyor' : 'Dene'}</button>
    </Row>
  )
}

function SpeakerTest() {
  const [playing, setPlaying] = useState(false)
  const [note, setNote] = useState('Windows ses düzeyi kısıksa duyulmaz.')

  const run = async () => {
    setPlaying(true)
    try {
      setNote((await testDualSenseSpeaker()) ? 'Çalındı. Sesi koldan duyman gerekiyor.' : 'Kol bulunamadı. Hoparlör yalnızca USB bağlantısında çalışır.')
    } catch (e) {
      setNote(clean(e as Error))
    }
    setPlaying(false)
  }

  return (
    <Row label="Hoparlörü dene" hint={note}>
      <button className="ghost" data-nav disabled={playing} onClick={() => void run()}>{playing ? 'Çalıyor' : 'Dene'}</button>
    </Row>
  )
}

function Toggle({ field, label, hint }: { field: keyof AppSettings; label: string; hint?: string }) {
  const settings = useSettings()
  const on = settings[field] as boolean
  return (
    <Row label={label} hint={hint}>
      <button role="switch" aria-checked={on} aria-label={label} className="switch" data-nav onClick={() => void updateSettings({ [field]: !on })}>
        <span />
      </button>
    </Row>
  )
}

function Choice<K extends keyof AppSettings>({ field, label, hint, options }: { field: K; label: string; hint?: string; options: [AppSettings[K], string][] }) {
  const settings = useSettings()
  return (
    <Row label={label} hint={hint}>
      <select
        data-nav
        aria-label={label}
        value={String(settings[field])}
        onChange={(e) => {
          const picked = options.find(([v]) => String(v) === e.target.value)
          if (picked) void updateSettings({ [field]: picked[0] } as Partial<AppSettings>)
        }}
      >
        {options.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}
      </select>
    </Row>
  )
}

function Slider({ field, label, hint, min, max, step, unit }: { field: keyof AppSettings; label: string; hint?: string; min: number; max: number; step: number; unit: string }) {
  const settings = useSettings()
  const [value, setValue] = useState(settings[field] as number)
  useEffect(() => setValue(settings[field] as number), [settings, field])
  return (
    <Row label={label} hint={hint}>
      <input
        type="range"
        data-nav
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => void updateSettings({ [field]: value })}
        onKeyUp={() => void updateSettings({ [field]: value })}
      />
      <output>{value}{unit}</output>
    </Row>
  )
}

function Text({ field, label, hint, secret, placeholder }: { field: keyof AppSettings; label: string; hint?: string; secret?: boolean; placeholder?: string }) {
  const settings = useSettings()
  const saved = settings[field] as string
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string>()
  useEffect(() => setValue(saved), [saved])

  return (
    <Row label={label} hint={hint}>
      <form
        className="setting-inline"
        onSubmit={(e) => {
          e.preventDefault()
          setError(undefined)
          updateSettings({ [field]: value }).catch((err: Error) => setError(clean(err)))
        }}
      >
        <input data-nav aria-label={label} type={secret ? 'password' : 'text'} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        <button className="ghost" data-nav disabled={value === saved}>Kaydet</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </Row>
  )
}

const CUSTOM_REGION = 'custom'

function XboxRegion() {
  const settings = useSettings()
  const known = XBOX_REGIONS.some(([ip]) => ip === settings.xboxRegionIp)
  const [custom, setCustom] = useState(!known)
  return (
    <>
      <Row label="Bölge" hint="İsteğin seçilen bölgeden geliyormuş gibi Microsoft'a bildirilir. Kullanım koşullarına aykırı olabilir, hesap riski sana aittir.">
        <select
          data-nav
          aria-label="Bölge"
          value={custom ? CUSTOM_REGION : settings.xboxRegionIp}
          onChange={(e) => {
            const isCustom = e.target.value === CUSTOM_REGION
            setCustom(isCustom)
            if (!isCustom) void updateSettings({ xboxRegionIp: e.target.value })
          }}
        >
          {XBOX_REGIONS.map(([ip, name]) => <option key={ip} value={ip}>{name}</option>)}
          <option value={CUSTOM_REGION}>Özel IP</option>
        </select>
      </Row>
      {custom && <Text field="xboxRegionIp" label="Özel IP" placeholder="0.0.0.0" />}
    </>
  )
}

function Accounts({ onAbout }: { onAbout(): void }) {
  const [xbox, setXbox] = useState<XboxStatus>()
  const [ps, setPs] = useState<PsStatus>()
  useEffect(() => {
    void window.hc.xbox.status().then(setXbox)
    void window.hc.ps.status().then(setPs)
    const offXbox = window.hc.xbox.onStatus(setXbox)
    const offPs = window.hc.ps.onStatus(setPs)
    return () => {
      offXbox()
      offPs()
    }
  }, [])
  return (
    <>
      <Row label="PlayStation" hint={ps?.state === 'signedIn' ? 'Bağlı' : 'Bağlı değil'}>
        {ps?.state === 'signedIn' && <button className="ghost" data-nav onClick={() => void window.hc.ps.signOut()}>Çıkış yap</button>}
      </Row>
      <Row label="Xbox" hint={xbox?.state === 'signedIn' ? xbox.gamertag ?? 'Bağlı' : 'Bağlı değil'}>
        {xbox?.state === 'signedIn' && <button className="ghost" data-nav onClick={() => void window.hc.xbox.signOut()}>Çıkış yap</button>}
      </Row>
      <Row label="Hakkında" hint="Sürüm, lisanslar ve yasal bildirimler"><button className="ghost" data-nav onClick={onAbout}>Aç</button></Row>
      <Row label="Varsayılanlara dön" hint="Hesaplarına dokunmaz."><button className="ghost" data-nav onClick={() => void resetSettings()}>Sıfırla</button></Row>
    </>
  )
}

function datacenterOptions(list: PsDatacenter[]): [string, string][] {
  return [['Auto', 'Otomatik (en hızlısı)'], ...list.map((d): [string, string] => [d.name, d.rttMs ? `${d.name} · ${d.rttMs} ms` : d.name])]
}

export function SettingsPage({ active, onAbout }: { active: boolean; onAbout(): void }) {
  const [section, setSection] = useState<Section>('general')
  const [servers, setServers] = useState<string[]>([])
  const [datacenters, setDatacenters] = useState<{ cloud: PsDatacenter[]; now: PsDatacenter[] }>({ cloud: [], now: [] })
  const [outputs, setOutputs] = useState<[string, string][]>([])

  useEffect(() => {
    void window.hc.xbox.status().then((s) => setServers(s.servers ?? []))
    return window.hc.xbox.onStatus((s) => setServers(s.servers ?? []))
  }, [])

  useEffect(() => {
    if (!active) return
    void Promise.all([window.hc.ps.datacenters('pscloud'), window.hc.ps.datacenters('psnow')]).then(([cloud, now]) => setDatacenters({ cloud, now }))
    void navigator.mediaDevices.enumerateDevices().then((devices) =>
      setOutputs(devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => [d.deviceId, d.label || `Hoparlör ${i + 1}`])),
    )
  }, [active])

  const dcHint = (list: PsDatacenter[]) => (list.length ? undefined : 'Sony listeyi ilk akışta verir, o zamana kadar otomatik seçilir.')

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Ayar bölümleri">
        {SECTIONS.map(([id, label]) => <button key={id} data-nav aria-current={section === id} onClick={() => setSection(id)}>{label}</button>)}
      </nav>

      <div className="settings-body">
        {section === 'general' && (
          <section>
            <h2>Genel</h2>
            <Slider field="fontSize" label="Yazı boyutu" min={12} max={20} step={1} unit=" px" />
            <Choice field="motion" label="Animasyonlar" hint="Windows'ta animasyon efektleri kapalı olsa da uygulamadakiler çalışır; istersen Windows'a uydurabilirsin." options={[['on', 'Açık'], ['system', "Windows'a göre"], ['off', 'Kapalı']]} />
            <Toggle field="startFullscreen" label="Tam ekran başlat" hint="Uygulama açılırken tam ekrana geçer." />
            <Toggle field="fullscreenOnStream" label="Akışta tam ekran" />
            <Toggle field="doubleClickFullscreen" label="Çift tıkla tam ekran" />
            <Toggle field="hideCursor" label="İmleci gizle" hint="Akışta fare hareketsiz kalınca." />
            <Toggle field="showGameImage" label="Yüklenirken oyun görselini göster" />
            <Toggle field="backgroundKeepalive" label="Arka planda canlı tut" hint="Pencere arkadayken de akış yavaşlatılmaz." />
            <Toggle field="useVulkan" label="Vulkan" hint="Sorun yaşarsan kapat. Uygulama yeniden başlayınca geçerli olur." />
            <h3>İstatistikler</h3>
            <Toggle field="showStats" label="İstatistikleri göster" hint="Akışta F3 ile de açılıp kapanır." />
            <Toggle field="statsVertical" label="Dikey düzen" />
          </section>
        )}

        {section === 'picture' && (
          <section>
            <h2>Görüntü</h2>
            <Choice field="videoFormat" label="Görüntü biçimi" options={[['', 'En boy oranını koru'], ['Stretch', 'Esnet'], ['Zoom', 'Yakınlaştır'], ['16:10', '16:10'], ['18:9', '18:9'], ['21:9', '21:9'], ['4:3', '4:3']]} />
            <Slider field="brightness" label="Parlaklık" min={50} max={150} step={1} unit="%" />
            <Slider field="contrast" label="Kontrast" min={50} max={150} step={1} unit="%" />
            <Slider field="saturation" label="Doygunluk" min={0} max={200} step={1} unit="%" />
            <Choice field="videoDecoder" label="PlayStation video çözücü" options={[['prefer-hardware', 'Donanım'], ['prefer-software', 'Yazılım'], ['no-preference', 'Otomatik']]} />
          </section>
        )}

        {section === 'sound' && (
          <section>
            <h2>Ses</h2>
            <Toggle field="uiSounds" label="Arayüz sesleri" hint="Menüde gezinirken ve seçim yaparken kısa sesler çalar." />
            <Choice field="audioOutputDevice" label="Çıkış aygıtı" options={[['', 'Windows varsayılanı'], ...outputs]} />
            <Slider field="audioVolume" label="Akış sesi" min={0} max={100} step={1} unit="%" />
            <Slider field="psAudioBufferMs" label="PlayStation ses tamponu" hint="Düşük değer daha az gecikme, yüksek değer daha az cızırtı demektir." min={10} max={100} step={5} unit=" ms" />
            <Toggle field="xboxAudioRumble" label="Xbox sesten titreşim" hint="Oyun sesinin bas kısmını kola titreşim olarak verir." />
            <Slider field="xboxAudioRumbleThreshold" label="Sesten titreşim eşiği" min={0.01} max={0.5} step={0.01} unit="" />
          </section>
        )}

        {section === 'playstation' && (
          <section data-theme="playstation">
            <h2>PlayStation</h2>
            <Toggle field="psPremium" label="PS Plus Premium aboneliğim var" hint="Açıkken katalogdaki akış oyunları Sahip olduklarım'a dahil olur. Sony aboneliği yalnızca akış başlarken bildirir." />
            <h3>PS5 oyunları</h3>
            <Choice field="psCloudResolution" label="Çözünürlük" options={RESOLUTIONS} />
            <Choice field="psCloudBitrate" label="Bit hızı" hint={PS_BITRATE_HINT} options={PS_BITRATES} />
            <Choice field="psCloudDatacenter" label="Veri merkezi" hint={dcHint(datacenters.cloud)} options={datacenterOptions(datacenters.cloud)} />
            <h3>PS3 ve PS4 oyunları</h3>
            <Choice field="psNowResolution" label="Çözünürlük" options={RESOLUTIONS} />
            <Choice field="psNowBitrate" label="Bit hızı" hint={PS_BITRATE_HINT} options={PS_BITRATES} />
            <Choice field="psNowDatacenter" label="Veri merkezi" hint={dcHint(datacenters.now)} options={datacenterOptions(datacenters.now)} />
            <h3>Akış</h3>
            <Choice field="psCodec" label="Kodek" hint="Otomatik, ekran kartının desteğine göre seçer." options={[['auto', 'Otomatik'], ['h265', 'H.265'], ['h264', 'H.264']]} />
            <Toggle field="psFsr" label="FSR" hint={FSR_HINT} />
            <Slider field="psFsrSharpness" label="Keskinlik" hint="0 kapalı, 10 en keskin." min={0} max={10} step={1} unit="" />
            <Toggle field="psDeband" label="Bant giderme" hint={DEBAND_HINT} />
            <Choice field="psGameLanguage" label="Oyun dili" hint="Yalnızca o dili sunan veri merkezlerinde geçerlidir." options={[['', 'Hesaba göre'], ...LANGUAGES]} />
            <Slider field="psPacketLossMax" label="Paket kaybı sınırı" hint="Aşılınca akış kalitesi düşürülür." min={1} max={30} step={1} unit="%" />
            <h3>Giriş</h3>
            <Toggle field="psKeyboard" label="Klavye girişi" />
            <Slider field="psDeadZone" label="Çubuk ölü bölgesi" hint="DualSense dışındaki kollar için." min={0} max={30} step={1} unit="%" />
            <Toggle field="psButtonsByPosition" label="Düğmeleri konuma göre eşle" hint="Nintendo düzenli kollarda A/B ve X/Y'yi değiştirir." />
            <Toggle field="psOptionsShareForPs" label="Options + Share ile PS düğmesi" hint="İkisine 2 saniye basılı tutunca PS düğmesi gönderilir." />
          </section>
        )}

        {section === 'dualsense' && (
          <section data-theme="playstation">
            <h2>DualSense</h2>
            <Toggle field="psNativeDualSense" label="Doğrudan bağlantı" hint="Jiroskop, dokunmatik yüzey ve uyarlanabilir tetikler için gerekir. Sonraki akışta geçerli olur." />
            <Toggle field="psTriggers" label="Uyarlanabilir tetikler" />
            <Slider field="psHapticStrength" label="Dokunsal geri bildirim gücü" hint="0, kapalı demektir." min={0} max={100} step={5} unit="%" />
            <HapticTest />
            <Toggle field="dualSenseSpeaker" label="Tüm oyun sesini koldan çal" hint="Ses çıkışı DualSense ise akışın bütün sesi kolun hoparlörüne gider. Oyunların kola özel efektlerini ayırmaz." />
            <SpeakerTest />
            <Toggle field="psVibration" label="Titreşim" />
          </section>
        )}

        {section === 'xbox' && (
          <section data-theme="xbox">
            <h2>Xbox</h2>
            <h3>Görüntü</h3>
            <Choice field="xboxResolution" label="Çözünürlük" hint="Üst sınırı Microsoft belirler: Ultimate hesapta 720p dışındaki seçenekler 1440p'ye çıkabilir." options={[[720, '720p'], [1080, 'Yüksek'], [1081, 'En yüksek']]} />
            <Choice field="xboxBitrate" label="Bit hızı sınırı" hint="Yalnızca düşürür: yavaş bağlantıda takılmayı azaltır. Kaliteyi Microsoft'un verdiğinin üstüne çıkarmaz." options={XBOX_BITRATES} />
            <Choice field="xboxCodec" label="Kodek" hint="Microsoft yalnızca H.264 gönderiyor; en iyi görüntüyü Main profili verir." options={[['high', 'En iyi (H.264 Main)'], ['main', 'Orta (H.264 Constrained Baseline)'], ['baseline', 'Düşük (H.264 Baseline)']]} />
            <Toggle field="xboxFsr" label="FSR" hint={`${FSR_HINT} Kapalıyken görüntü, ekran kartının kendi video yolundan geçer.`} />
            <Slider field="xboxFsrSharpness" label="Keskinlik" hint="0 kapalı, 10 en keskin." min={0} max={10} step={1} unit="" />
            <Toggle field="xboxDeband" label="Bant giderme" hint={`${DEBAND_HINT} FSR gibi görüntüyü ayrı bir katmandan geçirir; tepkiye bir kare kadar gecikme ekleyebilir.`} />
            <Choice field="xboxGameLanguage" label="Oyun dili" options={[['', 'Varsayılan'], ...LANGUAGES]} />
            <h3>Bağlantı</h3>
            <XboxRegion />
            <Choice field="xboxSignalServer" label="Sinyal sunucusu" hint={servers.length ? 'Bağlanamıyorsan farklı bir sunucu dene.' : 'Microsoft listeyi bulut erişimi verince gönderir, şu an boş.'} options={[['', 'Otomatik'], ...servers.map((s): [string, string] => [s, s])]} />
            <Toggle field="xboxIpv6" label="IPv6'yı tercih et" />
            <h3>TURN sunucusu</h3>
            <Text field="xboxTurnUrl" label="Adres" hint="Doğrudan bağlantı kurulamıyorsa kendi TURN sunucunu kullan." placeholder="turn:adres:3478" />
            <Text field="xboxTurnUsername" label="Kullanıcı adı" />
            <Text field="xboxTurnCredential" label="Parola" secret />
          </section>
        )}

        {section === 'xboxInput' && (
          <section data-theme="xbox">
            <h2>Xbox kol ve giriş</h2>
            <Choice field="xboxGamepadIndex" label="Kol seçimi" options={[[-1, 'Otomatik'], [0, '1. kol'], [1, '2. kol'], [2, '3. kol'], [3, '4. kol']]} />
            <Toggle field="xboxGamepadMix" label="Kolları birleştir" hint="Tüm bağlı kollar tek kol gibi davranır." />
            <Toggle field="xboxCoop" label="Co-op" hint="Bağlı kolları ayrı oyuncular olarak gönderir." />
            <Choice field="xboxPollingRate" label="Yoklama hızı" hint="Kol girdisinin sunucuya gönderilme sıklığı." options={POLL_RATES} />
            <Slider field="xboxDeadZone" label="Çubuk ölü bölgesi" min={0} max={90} step={1} unit="%" />
            <Toggle field="xboxVibration" label="Titreşim" />
            <Choice field="xboxTriggerRumble" label="Tetik titreşimi" options={[['', 'Kapalı'], ['all', 'İki tetik'], ['left', 'Sol tetik'], ['right', 'Sağ tetik']]} />
            <Toggle field="xboxSwapTriggerRumble" label="Tetik titreşimini değiştir" />
            <h3>Fare ve klavye</h3>
            <Toggle field="xboxMouseKeyboard" label="Yerel fare ve klavye" hint="Yalnızca destekleyen oyunlarda çalışır." />
            <Slider field="xboxMouseSensitivity" label="Fare hassasiyeti" min={0.1} max={5} step={0.1} unit="" />
          </section>
        )}

        {section === 'accounts' && (
          <section>
            <h2>Hesaplar ve uygulama</h2>
            <Accounts onAbout={onAbout} />
          </section>
        )}
      </div>
    </div>
  )
}
