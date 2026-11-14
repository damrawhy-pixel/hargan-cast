import { PROFILE_FIELDS, settingsFor, type AppSettings, type GameProfile as Profile } from '../../../shared/settings'
import { t } from '../../../shared/i18n'
import type { HubItem } from '../lib/items'
import { updateSettings, useSettings } from '../lib/useSettings'
import { videoSurfaceSupported } from '../lib/videoSurface'
import { RESOLUTIONS, psBitrates, videoFormats, xboxBitrates, xboxResolutions } from './SettingsPage'

type Field = (typeof PROFILE_FIELDS)[number]

// One select per setting; the first choice leaves it to the general setting.
function ProfileChoice<K extends Field>({ field, label, options, profile, onChange }: {
  field: K
  label: string
  options: [AppSettings[K], string][]
  profile: Profile
  onChange(field: K, value: AppSettings[K] | undefined): void
}) {
  const value = profile[field]
  return (
    <label className="profile-row">
      <span>{label}</span>
      <select
        data-nav
        aria-label={label}
        value={value === undefined ? '' : `v:${String(value)}`}
        onChange={(e) => {
          const picked = options.find(([v]) => `v:${String(v)}` === e.target.value)
          onChange(field, picked?.[0])
        }}
      >
        <option value="">{t('Genel ayar')}</option>
        {options.map(([v, text]) => <option key={String(v)} value={`v:${String(v)}`}>{text}</option>)}
      </select>
    </label>
  )
}

const ON_OFF = (): [boolean, string][] => [[true, t('Açık')], [false, t('Kapalı')]]

/** Picture settings for this one game, on top of the general ones. */
export function GameProfile({ item }: { item: HubItem }) {
  const settings = useSettings()
  const profile: Profile = settings.gameProfiles[item.key] ?? {}
  const custom = Object.keys(profile).length

  const change = <K extends Field>(field: K, value: AppSettings[K] | undefined) => {
    const next: Profile = { ...profile }
    if (value === undefined) delete next[field]
    else next[field] = value
    const all = { ...settings.gameProfiles }
    if (Object.keys(next).length) all[item.key] = next
    else delete all[item.key]
    void updateSettings({ gameProfiles: all })
  }
  const row = { profile, onChange: change }

  const ps = item.ps
  // The app's shaders only run when it does the scaling itself.
  // (PlayStation falls back to them where the browser cannot feed a <video>.)
  const shaders = settingsFor(settings, item.key).upscaler === 'shader' || (Boolean(item.ps) && !videoSurfaceSupported)
  const cloud = ps?.streamServiceType === 'pscloud'
  return (
    <details className="profile">
      <summary data-nav>
        {t('Bu oyuna özel ayarlar')}
        {custom > 0 && <small>{t('{n} ayar değiştirildi', { n: custom })}</small>}
      </summary>
      <div className="profile-body">
        {ps ? (
          <>
            <ProfileChoice field={cloud ? 'psCloudResolution' : 'psNowResolution'} label={t('Çözünürlük')} options={RESOLUTIONS} {...row} />
            <ProfileChoice field={cloud ? 'psCloudBitrate' : 'psNowBitrate'} label={t('Bit hızı')} options={psBitrates()} {...row} />
            {shaders && <ProfileChoice field="psFsr" label="FSR" options={ON_OFF()} {...row} />}
            {shaders && <ProfileChoice field="psDeband" label={t('Bant giderme')} options={ON_OFF()} {...row} />}
          </>
        ) : (
          <>
            <ProfileChoice field="xboxResolution" label={t('Çözünürlük')} options={xboxResolutions()} {...row} />
            <ProfileChoice field="xboxBitrate" label={t('Bit hızı sınırı')} options={xboxBitrates()} {...row} />
            {shaders && <ProfileChoice field="xboxFsr" label="FSR" options={ON_OFF()} {...row} />}
            {shaders && <ProfileChoice field="xboxDeband" label={t('Bant giderme')} options={ON_OFF()} {...row} />}
          </>
        )}
        <ProfileChoice field="upscaler" label={t('Büyütme')} options={[['shader', t('Uygulama (FSR)')], ['system', t('Ekran kartı (RTX Video / VSR)')]]} {...row} />
        <ProfileChoice field="framePacing" label={t('Kare zamanlaması')} options={[['latency', t('En düşük gecikme')], ['smooth', t('En akıcı görüntü')]]} {...row} />
        <ProfileChoice field="videoFormat" label={t('Görüntü biçimi')} options={videoFormats()} {...row} />
        {custom > 0 && (
          <button className="ghost" data-nav onClick={() => void updateSettings({ gameProfiles: Object.fromEntries(Object.entries(settings.gameProfiles).filter(([k]) => k !== item.key)) })}>
            {t('Genel ayarlara dön')}
          </button>
        )}
      </div>
    </details>
  )
}
