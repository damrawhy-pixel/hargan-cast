import { describe, expect, it } from 'vitest'
import { createStreamMachine, type StreamEvent } from '../../src/renderer/src/lib/streamMachine'

const run = (events: StreamEvent[], initial: Parameters<typeof createStreamMachine>[0] = 'provisioning') => {
  const machine = createStreamMachine(initial)
  const accepted = events.map((e) => machine.send(e))
  return { phase: machine.phase, accepted }
}

describe('stream machine', () => {
  it('goes from a server request to a live picture', () => {
    expect(run(['queued', 'queued', 'ready', 'connected', 'picture']).phase).toBe('live')
  })

  it('starts one reconnect per drop, however many callbacks report it', () => {
    const { phase, accepted } = run(['ready', 'connected', 'picture', 'dropped', 'dropped'])
    expect(phase).toBe('reconnecting')
    expect(accepted.slice(-2)).toEqual([true, false])
  })

  it('ignores a late "connected" while waiting to reconnect', () => {
    const { phase, accepted } = run(['ready', 'dropped', 'connected'])
    expect(phase).toBe('reconnecting')
    expect(accepted.at(-1)).toBe(false)
  })

  it('negotiates again after a retry and can come back live', () => {
    expect(run(['ready', 'connected', 'dropped', 'retry', 'connected', 'picture']).phase).toBe('live')
  })

  it('never leaves the end', () => {
    const { phase, accepted } = run(['ready', 'end', 'retry', 'connected', 'picture', 'end'])
    expect(phase).toBe('ended')
    expect(accepted.slice(2)).toEqual([false, false, false, false])
  })

  it('does not take a picture before a connection', () => {
    expect(run(['ready', 'picture']).accepted).toEqual([true, false])
  })

  it('rejoins a running session straight into negotiation', () => {
    expect(run(['connected', 'picture'], 'negotiating').phase).toBe('live')
  })
})
