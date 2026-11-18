// "Playing ... on Hargan Cast" in Discord, through Discord's local IPC pipe. Needs
// a Discord application id, given at build time (HC_DISCORD_CLIENT_ID); without
// one the setting is not offered at all. Off by default: it tells friends what
// the user plays.
import net from 'node:net'
import path from 'node:path'
import { log } from './log'

declare const __DISCORD_CLIENT_ID__: string
export const DISCORD_CLIENT_ID = typeof __DISCORD_CLIENT_ID__ === 'string' ? __DISCORD_CLIENT_ID__ : ''

const HANDSHAKE = 0
const FRAME = 1
const PIPES = 10

function frame(op: number, payload: unknown) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

// A named pipe on Windows; a socket in the user's temporary folder on macOS and Linux.
function pipePath(index: number) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp'
  return path.join(dir, `discord-ipc-${index}`)
}

function connect(index = 0): Promise<net.Socket | undefined> {
  if (index >= PIPES) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const socket = net.connect(pipePath(index))
    socket.once('connect', () => resolve(socket))
    socket.once('error', () => resolve(connect(index + 1)))
  })
}

let socket: net.Socket | undefined
let connecting: Promise<net.Socket | undefined> | undefined

async function ready() {
  if (socket && !socket.destroyed) return socket
  connecting ??= connect().then((s) => {
    connecting = undefined
    if (!s) return undefined
    s.on('error', () => s.destroy())
    s.on('close', () => {
      if (socket === s) socket = undefined
    })
    s.write(frame(HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID }))
    socket = s
    return s
  })
  return connecting
}

/** Shows what is being played, or clears it with undefined. Silent when Discord is not running. */
export async function setPresence(activity?: { title: string; service: string; since: number }) {
  if (!DISCORD_CLIENT_ID) return
  try {
    const s = await ready()
    s?.write(
      frame(FRAME, {
        cmd: 'SET_ACTIVITY',
        nonce: `${Date.now()}`,
        args: {
          pid: process.pid,
          activity: activity
            ? { details: activity.title.slice(0, 120), state: activity.service, timestamps: { start: Math.floor(activity.since / 1000) }, assets: { large_image: 'logo', large_text: 'Hargan Cast' } }
            : undefined,
        },
      }),
    )
  } catch (e) {
    log(`discord: ${(e as Error).message}`)
  }
}
