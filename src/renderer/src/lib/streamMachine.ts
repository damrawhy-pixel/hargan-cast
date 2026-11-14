// The life of one cloud stream as a small state machine. Every callback that wants
// to act (a dropped link, a late "connected" from a closed player, a timer after
// the user left) first asks for its transition; only a transition the table
// allows goes through, so the same event can never start two reconnects or bring
// a finished stream back to life.

export type StreamPhase =
  /** Asking the service for a server. */
  | 'provisioning'
  /** Waiting in the service's queue. */
  | 'queued'
  /** Server ready; setting up the media connection. */
  | 'negotiating'
  /** Connected; the first picture has not arrived yet. */
  | 'awaitingPicture'
  | 'live'
  /** The link dropped; waiting to negotiate again. */
  | 'reconnecting'
  | 'ended'

export type StreamEvent = 'queued' | 'ready' | 'connected' | 'picture' | 'dropped' | 'retry' | 'end'

const TRANSITIONS: Record<StreamPhase, Partial<Record<StreamEvent, StreamPhase>>> = {
  provisioning: { queued: 'queued', ready: 'negotiating', end: 'ended' },
  queued: { queued: 'queued', ready: 'negotiating', end: 'ended' },
  negotiating: { connected: 'awaitingPicture', dropped: 'reconnecting', end: 'ended' },
  // A link can report "connected" again; that changes nothing.
  awaitingPicture: { connected: 'awaitingPicture', picture: 'live', dropped: 'reconnecting', end: 'ended' },
  live: { connected: 'live', dropped: 'reconnecting', end: 'ended' },
  reconnecting: { retry: 'negotiating', end: 'ended' },
  ended: {},
}

export interface StreamMachine {
  readonly phase: StreamPhase
  /** Applies the event if the current phase allows it; false means ignore whatever prompted it. */
  send(event: StreamEvent): boolean
  is(...phases: StreamPhase[]): boolean
}

export function createStreamMachine(initial: StreamPhase, onChange?: (phase: StreamPhase, event: StreamEvent) => void): StreamMachine {
  let phase = initial
  return {
    get phase() {
      return phase
    },
    send(event) {
      const next = TRANSITIONS[phase][event]
      if (!next) return false
      phase = next
      onChange?.(phase, event)
      return true
    },
    is: (...phases) => phases.includes(phase),
  }
}
