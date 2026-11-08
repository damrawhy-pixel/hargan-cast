import { useEffect, useRef, useState } from 'react'
import { imageAt } from '../lib/gameInfo'

interface Props {
  title: string
  shots: string[]
  start: number
  onClose(): void
}

const FULL_WIDTH = 2560
const THUMB_WIDTH = 320

// Full-screen gallery. Moving along the strip changes the picture, B or Esc closes.
export function ShotViewer({ title, shots, start, onClose }: Props) {
  const [index, setIndex] = useState(start)
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    strip.current?.querySelectorAll<HTMLButtonElement>('button')[start]?.focus()
  }, [start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className="viewer" role="dialog" aria-label={`${title} görüntüleri`}>
      <img key={shots[index]} className="viewer-image" src={imageAt(shots[index], FULL_WIDTH)} alt="" draggable={false} />
      <header className="viewer-head">
        <span>{title}</span>
        <span>{index + 1} / {shots.length}</span>
        <button className="ghost detail-back" data-nav onClick={onClose}>Kapat</button>
      </header>
      <div className="viewer-strip" ref={strip}>
        {shots.map((url, i) => (
          <button key={url} className="viewer-thumb" data-nav aria-current={i === index} aria-label={`Görüntü ${i + 1}`} onFocus={() => setIndex(i)} onClick={() => setIndex(i)}>
            <img src={imageAt(url, THUMB_WIDTH)} alt="" loading="lazy" draggable={false} />
          </button>
        ))}
      </div>
    </section>
  )
}
