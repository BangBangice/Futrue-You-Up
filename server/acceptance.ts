// Hidden production checks. Runs as a child process, under the same limits as the player's own tests,
// and plays the part of real clients hitting the player's code: one check per way of signing in,
// plus the checks that make sure nobody gets in who should not.
// Usage: node [flags] acceptance.ts <workspace>. Prints one line: @@CHECKS@@{json}
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type Session = { ok: boolean }
type Req = { headers: Record<string, string>; cookies: Record<string, string>; body: Record<string, unknown> }
const ws = process.argv[2]
const load = (rel: string) => import(pathToFileURL(join(ws, rel)).href)
const done = (result: unknown) => { console.log('@@CHECKS@@' + JSON.stringify(result)); process.exit(0) }

const req = (parts: Partial<Req> = {}): Req => ({ headers: {}, cookies: {}, body: {}, ...parts })
const res = () => {
  const seen = { status: 200, body: undefined as any, cookies: {} as Record<string, string> }
  const r = { status: (c: number) => (seen.status = c, r), json: (b: unknown) => (seen.body = b, r), cookie: (n: string, v: string) => (seen.cookies[n] = v, r) }
  return { r, seen }
}

let mods: { config: any; verifySession: (r: Req) => Promise<Session>; passwordLogin: Function; apiKeyAuth: (r: Req) => Promise<Session>; refreshSso: Function }
try {
  const [config, vs, pw, key, sso] = await Promise.all(['src/config.ts', 'src/auth/verifySession.ts', 'src/auth/passwordLogin.ts', 'src/auth/apiKeyAuth.ts', 'src/sso/refresh.ts'].map(load))
  mods = { config, verifySession: vs.verifySession, passwordLogin: pw.passwordLogin, apiKeyAuth: key.apiKeyAuth, refreshSso: sso.refreshSso }
  for (const [name, fn] of Object.entries(mods)) if (name !== 'config' && typeof fn !== 'function') throw new Error(`${name} is not exported`)
} catch (e: any) {
  done({ build: 'broken', error: String(e?.message ?? e).split('\n')[0].slice(0, 300), checks: [] })
  throw e
}

const { JWT_SECRET, SESSION_COOKIE } = mods.config
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
/** Tokens minted the way the service mints them, so expiry and tampering can be tested without its help. */
const mint = (ageSec: number, ttlSec: number, secret = JWT_SECRET) => {
  const iat = Math.floor(Date.now() / 1000) - ageSec
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u_probe', org: 'org_probe', iat, exp: iat + ttlSec })}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
const both = (token: string) => req({ headers: { authorization: `Bearer ${token}` }, cookies: { [SESSION_COOKIE]: token } })
const login = async () => {
  const { r, seen } = res()
  await mods.passwordLogin(req({ body: { email: 'contractor@northwindfreight.com', password: 'invoice-run-2026' } }), r)
  if (!seen.cookies[SESSION_COOKIE]) throw new Error('login did not set the session cookie')
  return seen.cookies[SESSION_COOKIE]
}

// Each returns '' when healthy, or the reason it is not.
const CHECKS: Record<string, () => Promise<string>> = {
  async password_login() {
    const s = await mods.verifySession(req({ cookies: { [SESSION_COOKIE]: await login() } }))
    return s.ok ? '' : (s as any).reason ?? 'rejected'
  },
  async dashboard_fallthrough() {
    const s = await mods.apiKeyAuth(req({ cookies: { [SESSION_COOKIE]: await login() } }))
    return s.ok ? '' : (s as any).reason ?? 'rejected'
  },
  async sso_after_refresh() {
    const { r, seen } = res()
    await mods.refreshSso(req({ body: { refreshToken: 'rt_northwind_ana' } }), r)
    if (!seen.body?.accessToken) return 'refresh returned no access token'
    // An hour in: the browser still holds the first cookie, now expired, and sends the refreshed token as a bearer header.
    const s = await mods.verifySession(req({ headers: { authorization: `Bearer ${seen.body.accessToken}` }, cookies: { [SESSION_COOKIE]: mint(3900, 3600) } }))
    return s.ok ? '' : (s as any).reason ?? 'rejected'
  },
  async api_key() {
    const good = await mods.apiKeyAuth(req({ headers: { 'x-api-key': 'ldg_live_osprey_7f3a91' } }))
    const bad = await mods.apiKeyAuth(req({ headers: { 'x-api-key': 'ldg_live_not_a_key' } }))
    return !good.ok ? 'valid key rejected' : bad.ok ? 'unknown key accepted' : ''
  },
  async rejects_expired() {
    return (await mods.verifySession(both(mint(7200, 3600)))).ok ? 'a token that expired an hour ago was accepted' : ''
  },
  async rejects_missing() {
    return (await mods.verifySession(req())).ok ? 'a request with no token was accepted' : ''
  },
  async rejects_tampered() {
    const forged = (await mods.verifySession(both(mint(0, 3600, 'not-the-secret')))).ok
    const edited = (await mods.verifySession(both(mint(0, 3600).slice(0, -4) + 'AAAA'))).ok
    return forged || edited ? 'a token with a bad signature was accepted' : ''
  },
}

const checks = []
for (const [id, run] of Object.entries(CHECKS)) {
  const slow = new Promise<string>(r => setTimeout(() => r('timed out'), 2000))
  const reason = await Promise.race([run().catch(e => 'threw: ' + String(e?.message ?? e).split('\n')[0].slice(0, 160)), slow])
  checks.push({ id, ok: reason === '', reason })
}
done({ build: 'ok', checks })
