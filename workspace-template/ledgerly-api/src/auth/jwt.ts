// Signed session tokens (HS256). Nothing here knows how a token reaches the server.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { JWT_SECRET } from '../config.ts'

export interface Claims {
  /** User id. */
  sub: string
  /** Organisation id. */
  org: string
  /** Issued at, seconds since the epoch. */
  iat: number
  /** Expires at, seconds since the epoch. */
  exp: number
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const sign = (data: string) => createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
const HEADER = encode({ alg: 'HS256', typ: 'JWT' })

export function signJwt(who: { sub: string; org: string }, options: { ttlSec: number; now?: number }): string {
  const iat = Math.floor((options.now ?? Date.now()) / 1000)
  const payload = encode({ ...who, iat, exp: iat + options.ttlSec })
  return `${HEADER}.${payload}.${sign(`${HEADER}.${payload}`)}`
}

/** Returns the claims if the signature is genuine, otherwise null. Does not look at expiry. */
export function decodeJwt(token: string): Claims | null {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null
  const expected = Buffer.from(sign(`${header}.${payload}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims
  } catch {
    return null
  }
}

/** Clocks drift between us and identity providers, so allow a little skew. */
export function isExpired(claims: Claims, options: { skewSec: number; now?: number }): boolean {
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  return now > claims.exp + options.skewSec
}
