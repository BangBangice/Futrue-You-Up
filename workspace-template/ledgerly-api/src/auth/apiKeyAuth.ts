import type { Request } from '../http.ts'
import { lookupKey } from '../keys.ts'
import { verifySession } from './verifySession.ts'

export async function apiKeyAuth(req: Request) {
  const key = req.headers['x-api-key']
  if (!key) return verifySession(req) // dashboard users fall through
  const record = await lookupKey(key)
  return record ? { ok: true as const, org: record.orgId } : { ok: false as const, reason: 'bad_key' as const }
}
