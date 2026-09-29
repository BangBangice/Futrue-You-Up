import { SESSION_COOKIE } from '../config.ts'
import type { Request } from '../http.ts'
import { decodeJwt, isExpired } from './jwt.ts'

export type Session =
  | { ok: true; userId: string; org: string }
  | { ok: false; reason: 'missing_token' | 'bad_token' | 'expired' }

// Used by every authenticated route
export async function verifySession(req: Request): Promise<Session> {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return { ok: false, reason: 'missing_token' }

  const claims = decodeJwt(token)
  if (!claims) return { ok: false, reason: 'bad_token' }
  if (isExpired(claims, { skewSec: 0 })) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, userId: claims.sub, org: claims.org }
}
