import { SESSION_COOKIE, TTL } from '../config.ts'
import type { Request, Response } from '../http.ts'
import { signJwt } from './jwt.ts'
import { checkPassword } from './passwords.ts'

export async function passwordLogin(req: Request, res: Response) {
  const user = await checkPassword(req.body.email, req.body.password)
  if (!user) return res.status(401).json({ error: 'invalid_credentials' })

  const token = signJwt({ sub: user.id, org: user.orgId }, { ttlSec: TTL.password })
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: TTL.password * 1000 })
  return res.json({ ok: true })
}
