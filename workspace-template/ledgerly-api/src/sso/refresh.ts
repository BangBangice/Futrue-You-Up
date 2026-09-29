import { signJwt } from '../auth/jwt.ts'
import { TTL } from '../config.ts'
import type { Request, Response } from '../http.ts'
import { idp } from './idp.ts'

export async function refreshSso(req: Request, res: Response) {
  const session = await idp.refresh(req.body.refreshToken)
  if (!session) return res.status(401).json({ error: 'invalid_refresh_token' })

  const token = signJwt({ sub: session.userId, org: session.orgId }, { ttlSec: TTL.sso })
  // the web app stores this and sends it as `Authorization: Bearer …`
  return res.json({ accessToken: token, expiresIn: TTL.sso })
}
