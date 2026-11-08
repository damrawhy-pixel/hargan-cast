import { useEffect } from 'react'
import { sounds } from './sounds'

type Direction = 'up' | 'down' | 'left' | 'right'

const REPEAT_FIRST_MS = 300
const REPEAT_NEXT_MS = 90
const STICK = 0.55
const SEARCH_WINDOW = 48

// Left and right change a value in place; everything else moves focus.
function adjust(control: HTMLElement, direction: Direction) {
  const sign = direction === 'right' ? 1 : -1
  if (control instanceof HTMLSelectElement) {
    const next = control.selectedIndex + sign
    if (next >= 0 && next < control.options.length) {
      control.selectedIndex = next
      control.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return
  }
  const range = control as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setValue.call(range, String(Number(range.value) + sign * Number(range.step || 1)))
  range.dispatchEvent(new Event('input', { bubbles: true }))
  range.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
}

const isAdjustable = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'range')

function move(root: HTMLElement, direction: Direction) {
  document.documentElement.dataset.input = 'pad'
  const targets = [...root.querySelectorAll<HTMLElement>('[data-nav]')]
  const current = document.activeElement as HTMLElement | null
  if ((direction === 'left' || direction === 'right') && isAdjustable(current) && targets.includes(current)) return adjust(current, direction)
  if (!current || !targets.includes(current)) {
    targets[0]?.focus()
    sounds.move()
    return
  }
  // A tile with a caption beside it is aimed from its picture, not from picture and caption together.
  const box = (el: HTMLElement) => (el.querySelector('[data-anchor]') ?? el).getBoundingClientRect()
  const from = box(current)
  const fx = from.left + from.width / 2
  const fy = from.top + from.height / 2
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'right' || direction === 'down' ? 1 : -1

  // Neighbours are always close in document order, even in huge grids.
  const index = targets.indexOf(current)
  const nearby = targets.slice(Math.max(0, index - SEARCH_WINDOW), index + SEARCH_WINDOW + 1)

  let best: HTMLElement | undefined
  let bestScore = Infinity
  for (const target of nearby) {
    if (target === current) continue
    const r = box(target)
    const dx = r.left + r.width / 2 - fx
    const dy = r.top + r.height / 2 - fy
    const along = horizontal ? dx * sign : dy * sign
    if (along <= 1) continue
    const score = along + Math.abs(horizontal ? dy : dx) * 3
    if (score < bestScore) {
      bestScore = score
      best = target
    }
  }
  if (best) {
    best.focus({ preventScroll: true })
    // The launcher keeps the chosen game near its start, as a console's home row does.
    best.scrollIntoView({ block: 'nearest', inline: best.hasAttribute('data-launcher') ? 'start' : 'center', behavior: 'smooth' })
    sounds.move()
  }
}

const activeRoot = () =>
  document.querySelector<HTMLElement>('.viewer') ?? document.querySelector<HTMLElement>('.detail') ?? document.querySelector<HTMLElement>('.space:not([hidden])')

const PAD_GUIDE = 16

// Couch-friendly: arrows or a gamepad move focus, A or Enter activates, LB/RB
// are handled by the caller through `onBumper`, and the PS or Xbox button
// through `onHome`.
export function useSpatialNavigation(enabled: boolean, onBumper: (step: 1 | -1) => void, onHome: () => void) {
  useEffect(() => {
    if (!enabled) return

    // Every activation, by pad, keyboard or mouse, ends up as a click.
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-nav], [role=tab], .round-button')) sounds.select()
    }
    window.addEventListener('click', onClick, true)

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === 'Escape') sounds.back()
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as string]
      const root = activeRoot()
      if (direction && root) {
        e.preventDefault()
        move(root, direction)
      }
    }
    window.addEventListener('keydown', onKey)
    // Chromium sends motionless mouse events when the page moves under the cursor; those are not the user.
    const onMouse = (e: MouseEvent) => {
      if (e.movementX || e.movementY) delete document.documentElement.dataset.input
    }
    window.addEventListener('mousemove', onMouse)

    let frame = 0
    let heldDirection: Direction | undefined
    let nextRepeat = 0
    let confirmHeld = false
    let bumperHeld = false
    let backHeld = false
    let guideHeld = false

    const poll = () => {
      frame = requestAnimationFrame(poll)
      const pad = navigator.getGamepads().find((p) => p?.connected)
      const root = activeRoot()
      if (!pad || !root) return

      const [ax = 0, ay = 0] = pad.axes
      const direction: Direction | undefined =
        pad.buttons[12]?.pressed || ay < -STICK ? 'up'
        : pad.buttons[13]?.pressed || ay > STICK ? 'down'
        : pad.buttons[14]?.pressed || ax < -STICK ? 'left'
        : pad.buttons[15]?.pressed || ax > STICK ? 'right'
        : undefined

      const now = performance.now()
      if (direction !== heldDirection) {
        heldDirection = direction
        if (direction) {
          move(root, direction)
          nextRepeat = now + REPEAT_FIRST_MS
        }
      } else if (direction && now >= nextRepeat) {
        move(root, direction)
        nextRepeat = now + REPEAT_NEXT_MS
      }

      const confirm = pad.buttons[0]?.pressed ?? false
      if (confirm && !confirmHeld && root.contains(document.activeElement)) (document.activeElement as HTMLElement).click()
      confirmHeld = confirm

      const back = pad.buttons[1]?.pressed ?? false
      if (back && !backHeld) {
        const close = document.querySelector<HTMLElement>('.detail-back')
        sounds.back()
        close?.click()
      }
      backHeld = back

      const left = pad.buttons[4]?.pressed ?? false
      const right = pad.buttons[5]?.pressed ?? false
      if ((left || right) && !bumperHeld && !document.querySelector('.detail, .viewer')) {
        sounds.tab()
        onBumper(right ? 1 : -1)
      }
      bumperHeld = left || right

      const guide = pad.buttons[PAD_GUIDE]?.pressed ?? false
      if (guide && !guideHeld) {
        document.querySelector<HTMLElement>('.detail-back')?.click()
        sounds.tab()
        onHome()
      }
      guideHeld = guide
    }
    frame = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', onMouse)
      cancelAnimationFrame(frame)
    }
  }, [enabled, onBumper, onHome])
}
