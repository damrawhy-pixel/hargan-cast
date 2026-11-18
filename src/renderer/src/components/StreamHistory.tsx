import { useState } from 'react'
import { locale, t } from '../../../shared/i18n'
import { clearHistory, readHistory, type StreamRecord } from '../lib/history'

const WIDTH = 240
const HEIGHT = 56
const PAD = 4

/**
 * One measure over one stream: a single 2px line on its own axis, starting at
 * zero, with the value under the pointer shown above it.
 */
function Spark({ label, unit, values, floor }: { label: string; unit: string; values: (number | null)[]; floor?: number }) {
  const [hover, setHover] = useState<number>()
  const known = values.filter((v): v is number => v !== null)
  if (known.length < 2) return null
  const top = Math.max(floor ?? 0, ...known) || 1
  const x = (i: number) => PAD + (i / (values.length - 1)) * (WIDTH - PAD * 2)
  const y = (v: number) => HEIGHT - PAD - (v / top) * (HEIGHT - PAD * 2)
  let d = ''
  values.forEach((v, i) => {
    if (v === null) return
    d += `${d && values[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
  })
  const at = hover !== undefined ? values[hover] : undefined
  const avg = known.reduce((a, b) => a + b, 0) / known.length
  return (
    <figure className="spark">
      <figcaption>
        <span>{label}</span>
        <b>{at !== undefined && at !== null ? `${at} ${unit}` : `${t('ort.')} ${avg.toFixed(unit === 'ms' ? 0 : 1)} ${unit}`}</b>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label}: ${t('ort.')} ${avg.toFixed(1)} ${unit}, ${t('en yüksek')} ${top} ${unit}`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - box.left) / box.width) * (values.length - 1))
          setHover(Math.max(0, Math.min(values.length - 1, i)))
        }}
        onPointerLeave={() => setHover(undefined)}
      >
        <line className="spark-base" x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} />
        <path className="spark-line" d={d} />
        {hover !== undefined && at !== undefined && at !== null && (
          <>
            <line className="spark-cross" x1={x(hover)} x2={x(hover)} y1={PAD} y2={HEIGHT - PAD} />
            <circle className="spark-dot" cx={x(hover)} cy={y(at)} r={4} />
          </>
        )}
      </svg>
    </figure>
  )
}

const clock = (seconds: number) =>
  seconds >= 3600 ? t('{h} sa {m} dk', { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) }) : t('{m} dk {s} sn', { m: Math.floor(seconds / 60), s: seconds % 60 })

function Session({ record }: { record: StreamRecord }) {
  const when = new Date(record.at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <article className="history-item glass">
      <header>
        <strong>{record.title}</strong>
        <small>
          {record.platform === 'playstation' ? 'PlayStation' : 'Xbox'} · {when} · {clock(record.seconds)}
          {record.size && ` · ${record.size}`}
        </small>
      </header>
      <dl className="history-facts">
        <div><dt>{t('Görüntü geldi')}</dt><dd>{record.toPicture !== undefined ? t('{n} sn', { n: record.toPicture.toFixed(1) }) : t('gelmedi')}</dd></div>
        <div><dt>{t('Kare/sn')}</dt><dd>{record.avgFps.toFixed(1)} ({t('en düşük')} {record.minFps})</dd></div>
        <div><dt>Mb/{t('sn')}</dt><dd>{record.avgMbps.toFixed(1)}</dd></div>
        {record.avgDelay !== undefined && <div><dt>{t('Ölçülen gecikme')}</dt><dd>{Math.round(record.avgDelay)} ms</dd></div>}
        <div><dt>{t('Kayıp')}</dt><dd>{record.lost}</dd></div>
        <div><dt>{t('Atlanan kare')}</dt><dd>{record.skipped}</dd></div>
      </dl>
      <div className="history-charts">
        <Spark label={t('Kare/sn')} unit="fps" values={record.fps} floor={60} />
        <Spark label={t('Bit hızı')} unit="Mb/s" values={record.mbps} />
        <Spark label={t('Ölçülen gecikme')} unit="ms" values={record.delay} />
      </div>
    </article>
  )
}

/** Past streams, newest first; nothing leaves this device. */
export function StreamHistory() {
  const [records, setRecords] = useState(readHistory)
  if (!records.length) return <p className="setting-note">{t('Henüz akış yok. Her akışın ölçümleri burada saklanır; yalnızca bu cihazda kalır.')}</p>
  return (
    <div className="history">
      {records.map((r) => <Session key={r.at} record={r} />)}
      <button
        className="ghost"
        data-nav
        onClick={() => {
          clearHistory()
          setRecords([])
        }}
      >
        {t('Geçmişi temizle')}
      </button>
    </div>
  )
}
