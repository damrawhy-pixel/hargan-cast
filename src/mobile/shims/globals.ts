// Node globals the shared Xbox layer expects, for the phone and tablet apps.
import { Buffer } from 'buffer'

// The polyfill predates the base64url encoding Node added later.
const toString = Buffer.prototype.toString
Buffer.prototype.toString = function (this: Buffer, encoding?: string, start?: number, end?: number) {
  if (encoding === 'base64url')
    return toString.call(this, 'base64', start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return toString.call(this, encoding as BufferEncoding, start, end)
} as typeof toString

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown }
g.Buffer ??= Buffer
g.global ??= globalThis
