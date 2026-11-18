import { useState } from 'react'
import { t } from '../../../shared/i18n'
import { measureMachine, tune } from '../lib/autoTune'
import { MOBILE } from '../lib/platform'
import { updateSettings, useSettings } from '../lib/useSettings'

/** Measures this computer and applies the settings that fit it, saying why. */
export function AutoTune({ card }: { card?: boolean }) {
  const settings = useSettings()
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [reasons, setReasons] = useState<string[]>([])
  if (card && settings.autoTuned && state === 'idle') return null

  const run = async () => {
    setState('running')
    // The connection test only exists on the desktop.
    const machine = await measureMachine(!MOBILE && Boolean(window.hc.platform.networkTest))
    const { changes, reasons: why } = tune(machine)
    await updateSettings({ ...changes, autoTuned: true })
    setReasons(why)
    setState('done')
  }

  return (
    <div className={card ? 'autotune autotune--card glass' : 'autotune'}>
      {card && <strong>{t('Bu bilgisayara göre ayarlayalım mı?')}</strong>}
      <p>{t('Ekranın yenileme hızını, HDR durumunu, ekran kartını ve bağlantını ölçüp görüntü ve akış ayarlarını ona göre seçer. Birkaç saniye sürer.')}</p>
      {state === 'done' ? (
        <ul className="autotune-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      ) : (
        <div className="autotune-actions">
          <button className="primary" data-nav disabled={state === 'running'} onClick={() => void run()}>{state === 'running' ? t('Ölçülüyor') : t('Bu bilgisayara göre ayarla')}</button>
          {card && <button className="ghost" data-nav onClick={() => void updateSettings({ autoTuned: true })}>{t('Şimdi değil')}</button>}
        </div>
      )}
    </div>
  )
}
