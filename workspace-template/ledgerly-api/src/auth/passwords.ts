// Password checks. The real service talks to the users table; this keeps the same contract.
import { scryptSync, timingSafeEqual } from 'node:crypto'

interface User { id: string; orgId: string; email: string; hash: Buffer }

const SALT = 'ledgerly'
const hash = (password: string) => scryptSync(password, SALT, 32)

const USERS: User[] = [
  { id: 'u_2041', orgId: 'org_northwind', email: 'contractor@northwindfreight.com', hash: hash('invoice-run-2026') },
  { id: 'u_3310', orgId: 'org_osprey', email: 'ops@ospreylogistics.com', hash: hash('osprey-ops-pass') },
]

export async function checkPassword(email: unknown, password: unknown): Promise<{ id: string; orgId: string } | null> {
  if (typeof email !== 'string' || typeof password !== 'string') return null
  const user = USERS.find(u => u.email === email.toLowerCase())
  if (!user) return null
  return timingSafeEqual(user.hash, hash(password)) ? { id: user.id, orgId: user.orgId } : null
}
