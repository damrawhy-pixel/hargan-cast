import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'

interface Layer {
  id: number
  url: string
  sharp: boolean
}

const FADE_MS = 700

// The stage behind every screen. New art fades in over the old one, and only
// opacity animates, so the compositor does all the work.
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
      setLayers((current) => [...current.slice(-1), { id, url, sharp }])
      setTimeout(() => setLayers((current) => current.filter((l) => l.id >= id)), FADE_MS + 100)
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
          <div key={layer.id} className={`stage-art ${layer.sharp ? 'stage-art--sharp' : ''}`} style={{ backgroundImage: `url("${layer.url}")` }} />
        ))}
      </div>
      <div className="stage-shade" />
    </div>
  )
}
