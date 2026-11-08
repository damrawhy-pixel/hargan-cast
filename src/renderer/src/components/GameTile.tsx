import { memo, type MouseEvent } from 'react'
import type { HubItem } from '../lib/items'
import { setSpotlight } from '../lib/store'

interface Props {
  item: HubItem
  onOpen(item: HubItem, art: HTMLElement | null): void
  showService?: boolean
}

export const GameTile = memo(function GameTile({ item, onOpen, showService }: Props) {
  const open = (e: MouseEvent<HTMLButtonElement>) => onOpen(item, e.currentTarget.querySelector('img'))
  const spotlight = () => setSpotlight(item)
  const art = item.icon ?? item.art
  return (
    <button className="tile" data-nav data-service={item.service} title={item.name} onClick={open} onMouseEnter={spotlight} onFocus={spotlight}>
      <span className="tile-art">
        {art ? <img src={art} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="tile-fallback">{item.name}</span>}
        <span className="tile-shine" />
      </span>
      {showService && <span className="tile-dot" />}
      {item.badge && <span className="tile-badge">{item.badge}</span>}
      <span className="tile-name">{item.name}</span>
    </button>
  )
})
