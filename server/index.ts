// One process, one port: the API, and the UI (through Vite while developing, from dist/ once built).
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { toNodeHandler } from 'better-auth/node'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mode } from './ai/llm.ts'
import { closeDb, dbEnabled, migrateDb } from './db/index.ts'
import { auth, authEnabled } from './auth.ts'
import { mailScope } from './mail.ts'
import { api, errors } from './routes.ts'
import { all } from './world.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5183)
const APP_PASSWORD = process.env.APP_PASSWORD
const PUBLIC = process.env.PUBLIC_ACCESS === '1'
const app = express()
app.disable('x-powered-by')

// This server runs the player's code. With a database, accounts decide who gets in (routes.ts).
// Without one it only answers to this machine; once hosted publicly (APP_PASSWORD set), a shared
// password stands in for that instead. PUBLIC_ACCESS=1 lets anyone in with no login, leaning on
// the sandbox's guards and the per-shift AI call limits.
if (authEnabled()) {
  console.log('Accounts are on: every shift belongs to a signed-in user (guests included).')
} else if (PUBLIC) {
  console.warn('PUBLIC_ACCESS=1: anyone with the URL can use this server, no login.')
} else if (APP_PASSWORD) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ')
    const creds = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : ''
    const pass = creds.includes(':') ? creds.slice(creds.indexOf(':') + 1) : undefined
    if (pass === APP_PASSWORD) return next()
    res.set('WWW-Authenticate', 'Basic realm="LARP"').status(401).end()
  })
} else {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['localhost', '127.0.0.1'].includes((req.headers.host ?? '').split(':')[0])) next()
    else res.status(403).end()
  })
}
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT'].includes(req.method) && !req.is('application/json')) res.status(415).json({ error: 'Send JSON.' })
  else next()
}
// Nothing under /api may be cached, even by a CDN told to cache everything: it is all per-shift state.
app.use('/api', (_req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'no-store'); next() })
// Better Auth reads its own request bodies, so it goes before express.json.
if (authEnabled()) {
  const handler = toNodeHandler(auth())
  app.all('/api/auth/{*path}', (req: Request, res: Response) => mailScope.run({}, () => handler(req, res)))
}
app.use('/api', jsonOnly, express.json({ limit: '300kb' }), api)
app.use('/api', errors)

if (process.env.NODE_ENV === 'production') {
  // Built assets carry a content hash in their names, so browsers and the CDN can keep them for good.
  // A missing one is a 404, never index.html, or an old tab would get HTML where it asked for a script.
  app.use('/assets', express.static(join(ROOT, 'dist', 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
  // index.html names the current hashes, so it is checked with the server on every load.
  app.use(express.static(join(ROOT, 'dist'), { setHeaders: res => res.set('Cache-Control', 'no-cache') }))
  app.get('/{*path}', (_req: Request, res: Response) => { res.set('Cache-Control', 'no-cache').sendFile(join(ROOT, 'dist', 'index.html')) })
} else {
  const { createServer } = await import('vite')
  // The player's workspaces live under .data. Vite must not treat their files as part of this app.
  const watch = { ignored: ['**/.data/**', '**/workspace-template/**'] }
  app.use((await createServer({ root: ROOT, server: { middlewareMode: true, watch }, appType: 'spa' })).middlewares)
}

if (dbEnabled()) {
  await migrateDb()
  console.log('Database migrated.')
}
app.listen(PORT, '0.0.0.0', () => console.log(`LARP is running on port ${PORT}  (colleagues: ${mode() === 'live' ? 'AI' : 'scripted, no network needed'})`))
// Hosts stop the server with SIGTERM on every deploy. Saves still waiting on their debounce go out first.
process.once('SIGTERM', async () => {
  await Promise.all(all().map(s => s.stop()))
  await closeDb()
  process.exit(0)
})
