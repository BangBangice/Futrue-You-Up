// One process, one port: the API, and the UI (through Vite while developing, from dist/ once built).
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mode } from './ai/llm.ts'
import { api, errors } from './routes.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5183)
const APP_PASSWORD = process.env.APP_PASSWORD
const PUBLIC = process.env.PUBLIC_ACCESS === '1'
const app = express()
app.disable('x-powered-by')

// This server runs the player's code. Locally it only answers to this machine; once hosted
// publicly (APP_PASSWORD set), a shared password stands in for that instead. PUBLIC_ACCESS=1 lets
// anyone in with no login, leaning on the sandbox's guards and the per-shift AI call limits.
if (PUBLIC) {
  console.warn('PUBLIC_ACCESS=1: anyone with the URL can use this server, no login.')
} else if (APP_PASSWORD) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ')
    const creds = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : ''
    const pass = creds.includes(':') ? creds.slice(creds.indexOf(':') + 1) : undefined
    if (pass === APP_PASSWORD) return next()
    res.set('WWW-Authenticate', 'Basic realm="Work Prep"').status(401).end()
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
app.use('/api', jsonOnly, express.json({ limit: '300kb' }), api)
app.use('/api', errors)

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(ROOT, 'dist')))
  app.get('/{*path}', (_req: Request, res: Response) => { res.sendFile(join(ROOT, 'dist', 'index.html')) })
} else {
  const { createServer } = await import('vite')
  // The player's workspaces live under .data. Vite must not treat their files as part of this app.
  const watch = { ignored: ['**/.data/**', '**/workspace-template/**'] }
  app.use((await createServer({ root: ROOT, server: { middlewareMode: true, watch }, appType: 'spa' })).middlewares)
}

app.listen(PORT, '0.0.0.0', () => console.log(`Work Prep is running on port ${PORT}  (colleagues: ${mode() === 'live' ? 'AI' : 'scripted, no network needed'})`))
