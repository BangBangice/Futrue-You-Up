// Shared by the tests. Builds requests and responses without starting a server.
import { signJwt } from '../auth/jwt.ts'
import { SESSION_COOKIE } from '../config.ts'
import type { Request, Response } from '../http.ts'

export function mockReq(parts: Partial<Request> = {}): Request {
  return { headers: {}, cookies: {}, body: {}, ...parts }
}

/** A signed-in request. Sends the token both ways so tests work whichever transport a route reads. */
export function authedReq(token: string, parts: Partial<Request> = {}): Request {
  return mockReq({ ...parts, headers: { authorization: `Bearer ${token}`, ...parts.headers }, cookies: { [SESSION_COOKIE]: token, ...parts.cookies } })
}

export function mockRes() {
  const seen = { status: 200, body: undefined as unknown, cookies: {} as Record<string, string> }
  const res: Response = {
    status(code) { seen.status = code; return res },
    json(body) { seen.body = body; return res },
    cookie(name, value) { seen.cookies[name] = value; return res },
  }
  return { res, seen }
}

const WHO = { sub: 'u_test', org: 'org_test' }
const HOUR = 60 * 60 * 1000
export const validJwt = () => signJwt(WHO, { ttlSec: 3600 })
export const expiredJwt = () => signJwt(WHO, { ttlSec: 3600, now: Date.now() - 2 * HOUR })
/** Expired half a minute ago: inside the clock-skew allowance, if there is one. */
export const justExpiredJwt = () => signJwt(WHO, { ttlSec: 3600, now: Date.now() - HOUR - 30_000 })
