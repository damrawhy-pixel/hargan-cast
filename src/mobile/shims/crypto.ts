// The part of Node's crypto module the Xbox sign-in uses, on noble's audited
// P-256 and SHA-256. Synchronous, like the Node calls it stands in for.
import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))

const publicJwk = (jwk: JsonWebKey): JsonWebKey => ({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y })

// Stands in for Node's KeyObject and for a WebCrypto CryptoKey alike: it only carries the JWK.
export class ShimKey {
  constructor(readonly jwk: JsonWebKey) {}
  export() {
    return { ...this.jwk }
  }
}

export function generateKeyPairSync() {
  const utils = p256.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array }
  const secret = (utils.randomSecretKey ?? utils.randomPrivateKey)!()
  const point = p256.getPublicKey(secret, false)
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64u(point.slice(1, 33)), y: b64u(point.slice(33)), d: b64u(secret) }
  return { privateKey: new ShimKey(jwk), publicKey: new ShimKey(publicJwk(jwk)) }
}

export const subtle = {
  importKey: async (_format: string, jwk: JsonWebKey) => new ShimKey(jwk),
}

export const KeyObject = { from: (key: ShimKey) => key }

// ECDSA P-256 over SHA-256, signature as r||s, the 'ieee-p1363' shape the caller asks for.
export function sign(_algorithm: string, data: Uint8Array, options: { key: ShimKey }) {
  const secret = fromB64u(options.key.jwk.d!)
  const signature = p256.sign(new Uint8Array(data), secret) as unknown
  const bytes =
    signature instanceof Uint8Array ? signature : (signature as { toCompactRawBytes(): Uint8Array }).toCompactRawBytes()
  return Buffer.from(bytes)
}

export const randomBytes = (size: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)))
export const pseudoRandomBytes = randomBytes
export const randomUUID = () => globalThis.crypto.randomUUID()

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`)
  const parts: Uint8Array[] = []
  const hash = {
    update(data: string | Uint8Array) {
      parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : data)
      return hash
    },
    digest() {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let offset = 0
      for (const p of parts) {
        all.set(p, offset)
        offset += p.length
      }
      return Buffer.from(sha256(all))
    },
  }
  return hash
}

export default { generateKeyPairSync, subtle, KeyObject, sign, randomBytes, pseudoRandomBytes, randomUUID, createHash }
