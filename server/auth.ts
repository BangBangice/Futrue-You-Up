// Accounts, through Better Auth. On only with a database: without one the server keeps its old gate (see index.ts).
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { fromNodeHeaders } from 'better-auth/node'
import { anonymous, jwt } from 'better-auth/plugins'
import type { IncomingHttpHeaders } from 'node:http'
import { db, dbEnabled } from './db/index.ts'
import { accounts, jwks, sessions, users, verifications } from './db/schema.ts'
import { adopt } from './world.ts'

export const authEnabled = dbEnabled

const build = () => betterAuth({
  appName: 'LARP',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  database: drizzleAdapter(db(), { provider: 'pg', schema: { user: users, session: sessions, account: accounts, verification: verifications, jwks } }),
  user: { additionalFields: { role: { type: 'string', required: false, defaultValue: 'learner', input: false } } },
  plugins: [
    anonymous({ onLinkAccount: ({ anonymousUser, newUser }) => adopt(anonymousUser.user.id, newUser.user.id) }),
    // GET /api/auth/token swaps the session cookie for a JWT; other services check it against /api/auth/jwks.
    jwt(),
  ],
})

let instance: ReturnType<typeof build> | undefined
export const auth = () => (instance ??= build())

export interface Me { id: string; name: string; isAnonymous: boolean; role: string }
export async function me(headers: IncomingHttpHeaders): Promise<Me | null> {
  const found = await auth().api.getSession({ headers: fromNodeHeaders(headers) })
  if (!found) return null
  const { id, name, isAnonymous, role } = found.user
  return { id, name, isAnonymous: !!isAnonymous, role: role ?? 'learner' }
}
