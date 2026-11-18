import { useState } from 'react'
import { t } from '../../../shared/i18n'
import { readHistory } from '../lib/history'
import { adviseQuality } from '../lib/smartQuality'
import { updateSettings, useSettings } from '../lib/useSettings'

/** On a game's page: a bit rate change its last streams call for, applied only on a tap. */
export function QualityAdvice({ gameKey }: { gameKey: string }) {
  const settings = useSettings()
  const [dismissed, setDismissed] = useState(false)
  const advice = adviseQuality(readHistory(), gameKey, settings)
  if (!advice || dismissed) return null
  const apply = () => {
    const profiles = { ...settings.gameProfiles, [gameKey]: { ...settings.gameProfiles[gameKey], ...advice.patch } }
    void updateSettings({ gameProfiles: profiles })
    setDismissed(true)
  }
  return (
    <div className="quality-advice glass" role="status">
      <span>
        {t(advice.reason)} {advice.direction === 'down' ? t('Bu oyun için bit hızını {n} Mb/sn yapmak takılmayı azaltır.', { n: advice.mbps }) : advice.mbps ? t('Bit hızı yeniden {n} Mb/sn yapılabilir.', { n: advice.mbps }) : t('Bit hızı sınırı kaldırılabilir.')}
      </span>
      <button className="primary" data-nav onClick={apply}>{t('Uygula')}</button>
      <button className="ghost" data-nav onClick={() => setDismissed(true)}>{t('Şimdi değil')}</button>
    </div>
  )
}
