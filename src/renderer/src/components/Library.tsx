import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HubItem } from '../lib/items'
import { GameTile } from './GameTile'

export interface LibraryFilter {
  id: string
  label: string
  test(item: HubItem): boolean
}

interface Props {
  items: HubItem[]
  filters: LibraryFilter[]
  onOpen(item: HubItem, art: HTMLElement | null): void
  toolbar?: ReactNode
}

const PAGE = 90
const SKELETON_TILES = 21

export function SkeletonGrid() {
  return (
    <div className="library-scroll" aria-label="Oyunlar yükleniyor">
      <div className="grid">
        {Array.from({ length: SKELETON_TILES }, (_, i) => <span key={i} className="skeleton" />)}
      </div>
    </div>
  )
}

const matches = (name: string, query: string) => name.toLocaleLowerCase('tr').includes(query)

export function Library({ items, filters, onOpen, toolbar }: Props) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string>()
  const [shown, setShown] = useState(PAGE)
  const deferredQuery = useDeferredValue(query)
  const sentinel = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => new Map(filters.map((f) => [f.id, items.filter(f.test).length])), [items, filters])

  // Until a choice is made, open on the first view that has something to show.
  const filterId = picked ?? filters.find((f) => counts.get(f.id))?.id ?? filters[0].id

  const visible = useMemo(() => {
    const filter = filters.find((f) => f.id === filterId) ?? filters[0]
    const q = deferredQuery.trim().toLocaleLowerCase('tr')
    return items.filter((i) => filter.test(i) && (!q || matches(i.name, q)))
  }, [items, filters, filterId, deferredQuery])

  useEffect(() => {
    setShown(PAGE)
    scroller.current?.scrollTo({ top: 0 })
  }, [visible])

  // Thousands of cards stay cheap because only what is near the view exists.
  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShown((n) => Math.min(n + PAGE, visible.length))
      },
      { root: scroller.current, rootMargin: '900px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible.length])

  return (
    <div className="library">
      <div className="library-bar">
        <input
          className="search"
          data-nav
          type="search"
          placeholder={`${items.length.toLocaleString('tr')} oyunda ara`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="tablist">
          {filters.map((f) => (
            <button key={f.id} role="tab" aria-selected={f.id === filterId} className="chip" data-nav onClick={() => setPicked(f.id)}>
              {f.label} <span>{(counts.get(f.id) ?? 0).toLocaleString('tr')}</span>
            </button>
          ))}
        </div>
        <div className="library-tools">{toolbar}</div>
      </div>

      <div className="library-scroll" ref={scroller}>
        {visible.length === 0 ? (
          <p className="empty">Bu görünümde oyun yok.</p>
        ) : (
          <div className="grid" key={filterId}>
            {visible.slice(0, shown).map((item) => <GameTile key={item.key} item={item} onOpen={onOpen} />)}
          </div>
        )}
        <div ref={sentinel} className="sentinel" />
      </div>
    </div>
  )
}
