import type { ShimKey } from './crypto'

// Only the public half leaves; the sign-in sends it as its proof key.
export async function exportJWK(key: ShimKey): Promise<JsonWebKey> {
  const { kty, crv, x, y } = key.jwk
  return { kty, crv, x, y }
}
