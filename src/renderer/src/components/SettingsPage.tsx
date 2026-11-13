import { useEffect, useState, type ReactNode } from 'react'
import { XBOX_REGIONS, type AppSettings } from '../../../shared/settings'
import type { PsDatacenter, PsStatus, XboxStatus } from '../../../shared/types'
import { MOBILE } from '../lib/platform'
import { testDualSenseSpeaker } from '../lib/speaker'
import { resetSettings, updateSettings, useSettings } from '../lib/useSettings'
import { t, type Message } from '../../../shared/i18n'

const LANGUAGES: [string, string][] = [
  ['tr-TR', 'Türkçe'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['de-DE', 'Deutsch'], ['fr-FR', 'Français'],
  ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'],
  ['pt-PT', 'Português (Portugal)'], ['ru-RU', 'Русский'], ['pl-PL', 'Polski'], ['nl-NL', 'Nederlands'], ['sv-SE', 'Svenska'],
  ['nb-NO', 'Norsk'], ['da-DK', 'Dansk'], ['fi-FI', 'Suomi'], ['cs-CZ', 'Čeština'], ['sk-SK', 'Slovenčina'], ['hu-HU', 'Magyar'],
  ['el-GR', 'Ελληνικά'], ['he-IL', 'עברית'], ['ar-SA', 'العربية'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'],
]
const RESOLUTIONS: [number, string][] = [[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']]
// Built per render: the words follow the interface language.
const psBitrates = (): [number, string][] => [[0, t('Otomatik')], ...[5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000].map((b): [number, string] => [b, t('{n} Mb/sn', { n: b / 1000 })])]
const psBitrateHint = () => t('Otomatik, çözünürlüğe göre seçer: 1080p için 20, 4K için 40 Mb/sn.')
const fsrHint = () => t('Görüntüyü ekran boyutuna AMD FSR ile büyütür ve keskinleştirir. Görüntü ekrandan küçükse en çok fark eder.')
const debandHint = () => t('Koyu ve düz renk geçişlerinde sıkıştırmanın bıraktığı basamakları yumuşatır.')
// Microsoft sends at most about 27 Mb/s, so a higher cap would change nothing.
const xboxBitrates = (): [number, string][] => [[0, t('Sınırsız')], ...[5, 10, 15, 20].map((b): [number, string] => [b, t('En fazla {n} Mb/sn', { n: b })])]
const POLL_RATES: [number, string][] = [250, 83.33, 62.5, 50, 41.67, 35.71, 31.25, 27.78, 25, 22.73, 20.83, 19.23, 17.86, 16.67].map((r) => [r, `${r} Hz`])

const SECTIONS = [
  ['general', 'Genel'], ['picture', 'Görüntü'], ['sound', 'Ses'], ['touch', 'Dokunmatik'], ['playstation', 'PlayStation'],
  ['dualsense', 'DualSense'], ['xbox', 'Xbox'], ['xboxInput', 'Xbox kol ve giriş'], ['accounts', 'Hesaplar'],
] as const satisfies readonly (readonly [string, Message])[]
type Section = (typeof SECTIONS)[number][0]

// Phones and tablets hand the controller, the window and the audio device to the OS,
// so the desktop-only settings would do nothing there and are left out; the
// on-screen controls exist only there.
const VISIBLE_SECTIONS = SECTIONS.filter(([id]) => (MOBILE ? id !== 'dualsense' : id !== 'touch'))

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
  const [note, setNote] = useState(() => t('Kol USB ile bağlıyken titreşim sol tutamaktan sağa geçer.'))

  const run = async () => {
    setState('playing')
    try {
      const played = await window.hc.ps.testHaptics()
      setNote(played ? t('Çalındı. Sol ve sağ tutamakta hissetmen gerekiyor.') : t('Kol bulunamadı. Dokunsal geri bildirim yalnızca USB bağlantısında çalışır.'))
    } catch (e) {
      setNote(clean(e as Error))
    }
    setState('idle')
  }

  return (
    <Row label={t('Titreşimi dene')} hint={note}>
      <button className="ghost" data-nav disabled={state === 'playing'} onClick={() => void run()}>{state === 'playing' ? t('Çalıyor') : t('Dene')}</button>
    </Row>
  )
}

function SpeakerTest() {
  const [playing, setPlaying] = useState(false)
  const [note, setNote] = useState(() => t('Windows ses düzeyi kısıksa duyulmaz.'))

  const run = async () => {
    setPlaying(true)
    try {
      setNote((await testDualSenseSpeaker()) ? t('Çalındı. Sesi koldan duyman gerekiyor.') : t('Kol bulunamadı. Hoparlör yalnızca USB bağlantısında çalışır.'))
    } catch (e) {
      setNote(clean(e as Error))
    }
    setPlaying(false)
  }

  return (
    <Row label={t('Hoparlörü dene')} hint={note}>
      <button className="ghost" data-nav disabled={playing} onClick={() => void run()}>{playing ? t('Çalıyor') : t('Dene')}</button>
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
        <button className="ghost" data-nav disabled={value === saved}>{t('Kaydet')}</button>
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
      <Row label={t('Bölge')} hint={t("İsteğin seçilen bölgeden geliyormuş gibi Microsoft'a bildirilir. Kullanım koşullarına aykırı olabilir, hesap riski sana aittir.")}>
        <select
          data-nav
          aria-label={t('Bölge')}
          value={custom ? CUSTOM_REGION : settings.xboxRegionIp}
          onChange={(e) => {
            const isCustom = e.target.value === CUSTOM_REGION
            setCustom(isCustom)
            if (!isCustom) void updateSettings({ xboxRegionIp: e.target.value })
          }}
        >
          {XBOX_REGIONS.map(([ip, name]) => <option key={ip} value={ip}>{t(name)}</option>)}
          <option value={CUSTOM_REGION}>{t('Özel IP')}</option>
        </select>
      </Row>
      {custom && <Text field="xboxRegionIp" label={t('Özel IP')} placeholder="0.0.0.0" />}
    </>
  )
}

// Versions, graphics status, settings and the recent log in one file for a bug report.
function Diagnostics() {
  const [saved, setSaved] = useState<string>()
  const save = async () => {
    const file = await window.hc.platform.exportDiagnostics?.().catch(() => undefined)
    if (file) setSaved(file)
  }
  return (
    <Row label={t('Tanılama dosyası')} hint={saved ? t('Kaydedildi: {file}', { file: saved }) : t('Bir sorun bildirirken ekle. Hesap bilgisi ve şifre içermez.')}>
      <button className="ghost" data-nav onClick={() => void save()}>{t('Kaydet')}</button>
    </Row>
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
      <Row label={t('PlayStation')} hint={ps?.state === 'signedIn' ? t('Bağlı') : t('Bağlı değil')}>
        {ps?.state === 'signedIn' && <button className="ghost" data-nav onClick={() => void window.hc.ps.signOut()}>{t('Çıkış yap')}</button>}
      </Row>
      <Row label={t('Xbox')} hint={xbox?.state === 'signedIn' ? xbox.gamertag ?? t('Bağlı') : t('Bağlı değil')}>
        {xbox?.state === 'signedIn' && <button className="ghost" data-nav onClick={() => void window.hc.xbox.signOut()}>{t('Çıkış yap')}</button>}
      </Row>
      <Row label={t('Hakkında')} hint={t('Sürüm, lisanslar ve yasal bildirimler')}><button className="ghost" data-nav onClick={onAbout}>{t('Aç')}</button></Row>
      <Row label={t('Varsayılanlara dön')} hint={t('Hesaplarına dokunmaz.')}><button className="ghost" data-nav onClick={() => void resetSettings()}>{t('Sıfırla')}</button></Row>
      {window.hc.platform.exportDiagnostics && <Diagnostics />}
    </>
  )
}

function datacenterOptions(list: PsDatacenter[]): [string, string][] {
  return [['Auto', t('Otomatik (en hızlısı)')], ...list.map((d): [string, string] => [d.name, d.rttMs ? `${d.name} · ${d.rttMs} ms` : d.name])]
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
    // Phones route sound themselves, and some of their web views have no mediaDevices.
    if (MOBILE || !navigator.mediaDevices?.enumerateDevices) return
    void navigator.mediaDevices.enumerateDevices().then((devices) =>
      setOutputs(devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => [d.deviceId, d.label || t('Hoparlör {n}', { n: i + 1 })])),
    )
  }, [active])

  const dcHint = (list: PsDatacenter[]) => (list.length ? undefined : t('Sony listeyi ilk akışta verir, o zamana kadar otomatik seçilir.'))

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label={t('Ayar bölümleri')}>
        {VISIBLE_SECTIONS.map(([id, label]) => <button key={id} data-nav aria-current={section === id} onClick={() => setSection(id)}>{t(label)}</button>)}
      </nav>

      <div className="settings-body">
        {section === 'general' && (
          <section>
            <h2>{t('Genel')}</h2>
            <Choice field="language" label={t('Dil')} options={[['', t('Sistem diline göre')], ['tr', 'Türkçe'], ['en', 'English']]} />
            <Slider field="fontSize" label={t('Yazı boyutu')} min={12} max={20} step={1} unit=" px" />
            <Choice field="motion" label={t('Animasyonlar')} hint={t("Windows'ta animasyon efektleri kapalı olsa da uygulamadakiler çalışır; istersen Windows'a uydurabilirsin.")} options={[['on', t('Açık')], ['system', "Windows'a göre"], ['off', t('Kapalı')]]} />
            {!MOBILE && (
              <>
                <Toggle field="startFullscreen" label={t('Tam ekran başlat')} hint={t('Uygulama açılırken tam ekrana geçer.')} />
                <Toggle field="fullscreenOnStream" label={t('Akışta tam ekran')} />
                <Toggle field="doubleClickFullscreen" label={t('Çift tıkla tam ekran')} />
                <Toggle field="hideCursor" label={t('İmleci gizle')} hint={t('Akışta fare hareketsiz kalınca.')} />
              </>
            )}
            <Toggle field="showGameImage" label={t('Yüklenirken oyun görselini göster')} />
            {!MOBILE && (
              <>
                <Toggle field="backgroundKeepalive" label={t('Arka planda canlı tut')} hint={t('Pencere arkadayken de akış yavaşlatılmaz.')} />
                <Toggle field="useVulkan" label={t('Vulkan')} hint={t('Sorun yaşarsan kapat. Uygulama yeniden başlayınca geçerli olur.')} />
                <Toggle field="ignoreGpuBlocklist" label={t('Ekran kartı kara listesini yok say')} hint={t("Chromium'un sorunlu saydığı sürücülerde de donanım hızlandırmayı zorlar. Çökme yaşarsan kapat. Uygulama yeniden başlayınca geçerli olur.")} />
              </>
            )}
            <h3>{t('İstatistikler')}</h3>
            <Toggle field="showStats" label={t('İstatistikleri göster')} hint={t('Akışta F3 ile de açılıp kapanır.')} />
            <Toggle field="statsVertical" label={t('Dikey düzen')} />
          </section>
        )}

        {section === 'picture' && (
          <section>
            <h2>{t('Görüntü')}</h2>
            <Choice field="videoFormat" label={t('Görüntü biçimi')} options={[['', t('En boy oranını koru')], ['Stretch', t('Esnet')], ['Zoom', t('Yakınlaştır')], ['16:10', t('16:10')], ['18:9', t('18:9')], ['21:9', t('21:9')], ['4:3', t('4:3')]]} />
            <Slider field="brightness" label={t('Parlaklık')} min={50} max={150} step={1} unit="%" />
            <Slider field="contrast" label={t('Kontrast')} min={50} max={150} step={1} unit="%" />
            <Slider field="saturation" label={t('Doygunluk')} min={0} max={200} step={1} unit="%" />
            <Choice field="videoDecoder" label={t('PlayStation video çözücü')} options={[['prefer-hardware', t('Donanım')], ['prefer-software', t('Yazılım')], ['no-preference', t('Otomatik')]]} />
          </section>
        )}

        {section === 'sound' && (
          <section>
            <h2>{t('Ses')}</h2>
            <Toggle field="uiSounds" label={t('Arayüz sesleri')} hint={t('Menüde gezinirken ve seçim yaparken kısa sesler çalar.')} />
            {!MOBILE && <Choice field="audioOutputDevice" label={t('Çıkış aygıtı')} options={[['', t('Windows varsayılanı')], ...outputs]} />}
            <Slider field="audioVolume" label={t('Akış sesi')} min={0} max={100} step={1} unit="%" />
            <Slider field="psAudioBufferMs" label={t('PlayStation ses tamponu')} hint={t('Düşük değer daha az gecikme, yüksek değer daha az cızırtı demektir.')} min={10} max={100} step={5} unit=" ms" />
            <Toggle field="xboxAudioRumble" label={t('Xbox sesten titreşim')} hint={t('Oyun sesinin bas kısmını kola titreşim olarak verir.')} />
            <Slider field="xboxAudioRumbleThreshold" label={t('Sesten titreşim eşiği')} min={0.01} max={0.5} step={0.01} unit="" />
          </section>
        )}

        {section === 'touch' && (
          <section>
            <h2>{t('Dokunmatik kontroller')}</h2>
            <Choice field="touchControls" label={t('Ekran kontrolleri')} hint={t('Otomatik: bir kol kullanmaya başlayınca kendiliğinden gizlenir.')} options={[['auto', t('Otomatik')], ['on', t('Her zaman göster')], ['off', t('Kapalı')]]} />
            <Slider field="touchOpacity" label={t('Görünürlük')} min={15} max={100} step={5} unit="%" />
            <Slider field="touchSize" label={t('Boyut')} min={70} max={140} step={5} unit="%" />
            <Toggle field="touchVibrate" label={t('Dokununca titret')} hint={t("Düğmeye basınca telefon kısaca titrer. iPhone'da bu özellik yok.")} />
            <small className="setting-note">{t('Çubuklar parmağın değdiği yerde belirir. Çubuğa hızlıca iki kez dokunup basılı tutmak L3/R3 düğmesine basar.')}</small>
          </section>
        )}

        {section === 'playstation' && (
          <section data-theme="playstation">
            <h2>{t('PlayStation')}</h2>
            <Toggle field="psPremium" label={t('PS Plus Premium aboneliğim var')} hint={t("Açıkken katalogdaki akış oyunları Sahip olduklarım'a dahil olur. Sony aboneliği yalnızca akış başlarken bildirir.")} />
            <h3>{t('PS5 oyunları')}</h3>
            <Choice field="psCloudResolution" label={t('Çözünürlük')} options={RESOLUTIONS} />
            <Choice field="psCloudBitrate" label={t('Bit hızı')} hint={psBitrateHint()} options={psBitrates()} />
            <Choice field="psCloudDatacenter" label={t('Veri merkezi')} hint={dcHint(datacenters.cloud)} options={datacenterOptions(datacenters.cloud)} />
            <h3>{t('PS3 ve PS4 oyunları')}</h3>
            <Choice field="psNowResolution" label={t('Çözünürlük')} options={RESOLUTIONS} />
            <Choice field="psNowBitrate" label={t('Bit hızı')} hint={psBitrateHint()} options={psBitrates()} />
            <Choice field="psNowDatacenter" label={t('Veri merkezi')} hint={dcHint(datacenters.now)} options={datacenterOptions(datacenters.now)} />
            <h3>{t('Akış')}</h3>
            <Choice field="psCodec" label={t('Kodek')} hint={t('Otomatik, ekran kartının desteğine göre seçer.')} options={[['auto', t('Otomatik')], ['h265', t('H.265')], ['h264', t('H.264')]]} />
            <Toggle field="psFsr" label={t('FSR')} hint={fsrHint()} />
            <Slider field="psFsrSharpness" label={t('Keskinlik')} hint={t('0 kapalı, 10 en keskin.')} min={0} max={10} step={1} unit="" />
            <Toggle field="psDeband" label={t('Bant giderme')} hint={debandHint()} />
            <Choice field="psGameLanguage" label={t('Oyun dili')} hint={t('Yalnızca o dili sunan veri merkezlerinde geçerlidir.')} options={[['', t('Hesaba göre')], ...LANGUAGES]} />
            <Slider field="psPacketLossMax" label={t('Paket kaybı sınırı')} hint={t('Aşılınca akış kalitesi düşürülür.')} min={1} max={30} step={1} unit="%" />
            <h3>{t('Giriş')}</h3>
            <Toggle field="psKeyboard" label={t('Klavye girişi')} />
            <Slider field="psDeadZone" label={t('Çubuk ölü bölgesi')} hint={t('DualSense dışındaki kollar için.')} min={0} max={30} step={1} unit="%" />
            <Toggle field="psButtonsByPosition" label={t('Düğmeleri konuma göre eşle')} hint={t("Nintendo düzenli kollarda A/B ve X/Y'yi değiştirir.")} />
            <Toggle field="psOptionsShareForPs" label={t('Options + Share ile PS düğmesi')} hint={t('İkisine 2 saniye basılı tutunca PS düğmesi gönderilir.')} />
            {MOBILE && (
              <>
                <Toggle field="psVibration" label={t('Titreşim')} />
                <Toggle field="psTriggers" label={t('Uyarlanabilir tetikler')} hint={t("iPhone ve iPad'de DualSense ile çalışır; Android uygulamalara tetiklere erişim vermiyor.")} />
              </>
            )}
          </section>
        )}

        {section === 'dualsense' && (
          <section data-theme="playstation">
            <h2>{t('DualSense')}</h2>
            <Toggle field="psNativeDualSense" label={t('Doğrudan bağlantı')} hint={t('Jiroskop, dokunmatik yüzey ve uyarlanabilir tetikler için gerekir. Sonraki akışta geçerli olur.')} />
            <Toggle field="psTriggers" label={t('Uyarlanabilir tetikler')} />
            <Slider field="psHapticStrength" label={t('Dokunsal geri bildirim gücü')} hint={t('0, kapalı demektir.')} min={0} max={100} step={5} unit="%" />
            <HapticTest />
            <Toggle field="dualSenseSpeaker" label={t('Tüm oyun sesini koldan çal')} hint={t('Ses çıkışı DualSense ise akışın bütün sesi kolun hoparlörüne gider. Oyunların kola özel efektlerini ayırmaz.')} />
            <SpeakerTest />
            <Toggle field="psVibration" label={t('Titreşim')} />
          </section>
        )}

        {section === 'xbox' && (
          <section data-theme="xbox">
            <h2>{t('Xbox')}</h2>
            <h3>{t('Görüntü')}</h3>
            <Choice field="xboxResolution" label={t('Çözünürlük')} hint={t("Üst sınırı Microsoft belirler: Ultimate hesapta 720p dışındaki seçenekler 1440p'ye çıkabilir.")} options={[[720, t('720p')], [1080, t('Yüksek')], [1081, t('En yüksek')]]} />
            <Choice field="xboxBitrate" label={t('Bit hızı sınırı')} hint={t("Yalnızca düşürür: yavaş bağlantıda takılmayı azaltır. Kaliteyi Microsoft'un verdiğinin üstüne çıkarmaz.")} options={xboxBitrates()} />
            <Choice field="xboxCodec" label={t('Kodek')} hint={t('Microsoft yalnızca H.264 gönderiyor; en iyi görüntüyü Main profili verir.')} options={[['high', t('En iyi (H.264 Main)')], ['main', t('Orta (H.264 Constrained Baseline)')], ['baseline', t('Düşük (H.264 Baseline)')]]} />
            <Toggle field="xboxFsr" label={t('FSR')} hint={`${fsrHint()} ${t('Kapalıyken görüntü, ekran kartının kendi video yolundan geçer.')}`} />
            <Slider field="xboxFsrSharpness" label={t('Keskinlik')} hint={t('0 kapalı, 10 en keskin.')} min={0} max={10} step={1} unit="" />
            <Toggle field="xboxDeband" label={t('Bant giderme')} hint={`${debandHint()} ${t('FSR gibi görüntüyü ayrı bir katmandan geçirir; tepkiye bir kare kadar gecikme ekleyebilir.')}`} />
            <Choice field="xboxGameLanguage" label={t('Oyun dili')} options={[['', t('Varsayılan')], ...LANGUAGES]} />
            <h3>{t('Bağlantı')}</h3>
            <XboxRegion />
            <Choice field="xboxSignalServer" label={t('Sinyal sunucusu')} hint={servers.length ? t('Bağlanamıyorsan farklı bir sunucu dene.') : t('Microsoft listeyi bulut erişimi verince gönderir, şu an boş.')} options={[['', t('Otomatik')], ...servers.map((s): [string, string] => [s, s])]} />
            <Toggle field="xboxIpv6" label={t("IPv6'yı tercih et")} />
            <h3>{t('TURN sunucusu')}</h3>
            <Text field="xboxTurnUrl" label={t('Adres')} hint={t('Doğrudan bağlantı kurulamıyorsa kendi TURN sunucunu kullan.')} placeholder={t('turn:adres:3478')} />
            <Text field="xboxTurnUsername" label={t('Kullanıcı adı')} />
            <Text field="xboxTurnCredential" label={t('Parola')} secret />
          </section>
        )}

        {section === 'xboxInput' && (
          <section data-theme="xbox">
            <h2>{t('Xbox kol ve giriş')}</h2>
            <Choice field="xboxGamepadIndex" label={t('Kol seçimi')} options={[[-1, t('Otomatik')], [0, t('1. kol')], [1, t('2. kol')], [2, t('3. kol')], [3, t('4. kol')]]} />
            <Toggle field="xboxGamepadMix" label={t('Kolları birleştir')} hint={t('Tüm bağlı kollar tek kol gibi davranır.')} />
            <Toggle field="xboxCoop" label={t('Co-op')} hint={t('Bağlı kolları ayrı oyuncular olarak gönderir.')} />
            <Choice field="xboxPollingRate" label={t('Yoklama hızı')} hint={t('Kol girdisinin sunucuya gönderilme sıklığı.')} options={POLL_RATES} />
            <Slider field="xboxDeadZone" label={t('Çubuk ölü bölgesi')} min={0} max={90} step={1} unit="%" />
            <Toggle field="xboxVibration" label={t('Titreşim')} />
            <Choice field="xboxTriggerRumble" label={t('Tetik titreşimi')} options={[['', t('Kapalı')], ['all', t('İki tetik')], ['left', t('Sol tetik')], ['right', t('Sağ tetik')]]} />
            <Toggle field="xboxSwapTriggerRumble" label={t('Tetik titreşimini değiştir')} />
            <h3>{t('Fare ve klavye')}</h3>
            <Toggle field="xboxMouseKeyboard" label={t('Yerel fare ve klavye')} hint={t('Yalnızca destekleyen oyunlarda çalışır.')} />
            <Slider field="xboxMouseSensitivity" label={t('Fare hassasiyeti')} min={0.1} max={5} step={0.1} unit="" />
          </section>
        )}

        {section === 'accounts' && (
          <section>
            <h2>{t('Hesaplar ve uygulama')}</h2>
            <Accounts onAbout={onAbout} />
          </section>
        )}
      </div>
    </div>
  )
}
