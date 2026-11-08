import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'

interface Layer {
  id: number
  url: string
  sharp: boolean
  leaving: boolean
}

const FADE_MS = 900

// The stage behind every screen. The new picture settles in over the old one,
// which fades away; only opacity and transform animate, so the compositor does
// the work. A slow drift keeps a still picture alive.
export function Backdrop({ hidden }: { hidden: boolean }) {
  const spotlight = useStore((s) => s.spotlight)
  const [layers, setLayers] = useState<Layer[]>([])
  const nextId = useRef(0)
  const url = spotlight?.hero ?? spotlight?.art
  const sharp = Boolean(spotlight?.hero)

  useEffect(() => {
    if (!url) return
    const image = new Image()
    let cancelled = false
    image.onload = () => {
      if (cancelled) return
      const id = ++nextId.current
      setLayers((current) => [...current.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { id, url, sharp, leaving: false }])
      setTimeout(() => setLayers((current) => current.filter((l) => !l.leaving || l.id > id)), FADE_MS + 100)
    }
    image.src = url
    return () => {
      cancelled = true
    }
  }, [url, sharp])

  return (
    <div className="stage" hidden={hidden} aria-hidden="true">
      <div className="stage-aura stage-aura--home" />
      <div className="stage-aura stage-aura--playstation" />
      <div className="stage-aura stage-aura--xbox" />
      <div className="stage-aura stage-aura--settings" />
      <div className="stage-drift" />
      <div className="stage-arts">
        {layers.map((layer) => (
          <div key={layer.id} className={`stage-art ${layer.sharp ? 'stage-art--sharp' : ''} ${layer.leaving ? 'stage-art--leaving' : ''}`}>
            <div className="stage-art-image" style={{ backgroundImage: `url("${layer.url}")` }} />
          </div>
        ))}
      </div>
      <div className="stage-shade" />
    </div>
  )
}
