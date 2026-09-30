// Accounts, through Better Auth. On only with a database: without one the server keeps its old gate (see index.ts).
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { fromNodeHeaders } from 'better-auth/node'
import { anonymous, jwt } from 'better-auth/plugins'
import type { IncomingHttpHeaders } from 'node:http'
import { db, dbEnabled } from './db/index.ts'
import { accounts, jwks, sessions, users, verifications } from './db/schema.ts'
import { letter, mailScope, mask, send } from './mail.ts'
import { guestName } from './names.ts'
import { adopt, discard } from './world.ts'

export const authEnabled = dbEnabled
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

const HOUR = 3600
const QUIET = ['/sign-up/email', '/send-verification-email', '/request-password-reset']
const upgrade = (userId: string) => `guest-upgrade:${userId}`

const build = () => betterAuth({
  appName: 'LARP',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  trustedOrigins: process.env.BETTER_AUTH_URL ? [new URL(process.env.BETTER_AUTH_URL).origin] : [],
  database: drizzleAdapter(db(), { provider: 'pg', schema: { user: users, session: sessions, account: accounts, verification: verifications, jwks } }),
  user: { additionalFields: { role: { type: 'string', required: false, defaultValue: 'learner', input: false } } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: HOUR,
    // Signing up with an address that already has an account (from Google, say) answers "check your inbox" like any other
    // sign-up, so nobody can probe which addresses have accounts. Without this, that inbox stays empty.
    onExistingUserSignUp: ({ user }) => send(letter(user.email, 'You already have a LARP account', [
      `Hi ${user.name},`, 'Someone, probably you, tried to create a LARP account with this address, but it already has one.',
      'Sign in instead. If you signed up with Google, choose "Continue with Google". If you have forgotten your password, choose "Forgot password" on the sign-in page.',
    ], { label: 'Go to sign in', url: process.env.BETTER_AUTH_URL ?? '/' })),
    sendResetPassword: ({ user, url }) => send(letter(user.email, 'Reset your LARP password', [
      `Hi ${user.name},`, 'Someone asked to reset the password for your LARP account. The link works for an hour.',
    ], { label: 'Choose a new password', url })),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * HOUR,
    sendVerificationEmail: ({ user, url }) => send(letter(user.email, 'Confirm your email for LARP', [
      `Hi ${user.name},`, 'Confirm your email address to finish setting up your LARP account. Your shifts are kept with it.',
    ], { label: 'Confirm my email', url })),
  },
  socialProviders: googleEnabled()
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: 'select_account' } }
    : {},
  // Behind Cloudflare, x-forwarded-for carries more than one address and Better Auth won't pick one, so its header comes first.
  advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] } },
  rateLimit: { enabled: process.env.NODE_ENV === 'production' },
  hooks: {
    after: createAuthMiddleware(async ctx => {
      const scope = mailScope.getStore()
      // These answer "sent" even when Better Auth decided not to send (no such account, or already confirmed). Say so in the log.
      if (QUIET.includes(ctx.path) && !scope?.sent && !scope?.failed && !(ctx.context.returned instanceof APIError)) {
        const email = typeof ctx.body?.email === 'string' ? mask(ctx.body.email) : 'an address'
        console.warn(`[mail] ${ctx.path} for ${email}: no email sent. Better Auth sends none when the address has no account or is already confirmed.`)
      }
      if (scope?.failed) throw new APIError('SERVICE_UNAVAILABLE', { message: "We couldn't send the email just now. Try again in a minute." })
    }),
  },
  // A guest's runs move only to an account made while playing as that guest, never into one that already existed. The guest
  // is noted when the account is created (by email or Google) and its runs move with that account's first session. By email
  // that session waits for the address to be confirmed, perhaps in another browser, where the anonymous plugin can't see the guest.
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          if (user.isAnonymous || !ctx?.headers) return
          const guest = await auth().api.getSession({ headers: ctx.headers })
          if (!guest?.user.isAnonymous) return
          await (await auth().$context).internalAdapter.createVerificationValue({
            identifier: upgrade(user.id), value: guest.user.id, expiresAt: new Date(Date.now() + 7 * 24 * HOUR * 1000),
          })
        },
      },
    },
    session: {
      create: {
        after: async session => {
          const found = await (await auth().$context).internalAdapter.consumeVerificationValue(upgrade(session.userId))
          if (found) await adopt(found.value, session.userId)
        },
      },
    },
  },
  plugins: [
    // Runs after the session hooks above, so a new account has its runs by now. Signing in to an existing account leaves the
    // guest's runs behind, and the plugin deletes the guest next (unless the new session is a guest too), so they go with it.
    anonymous({
      generateName: guestName,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        if (!newUser.user.isAnonymous && newUser.user.id !== anonymousUser.user.id) await discard(anonymousUser.user.id)
      },
    }),
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
