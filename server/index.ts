// One process, one port: the API, and the UI (through Vite while developing, from dist/ once built).
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mode } from './ai/llm.ts'
import { api, errors } from './routes.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5183)
const app = express()
app.disable('x-powered-by')

// This server runs the player's code, so it answers only to this machine.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['localhost', '127.0.0.1'].includes((req.headers.host ?? '').split(':')[0])) next()
  else res.status(403).end()
})
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

app.listen(PORT, '127.0.0.1', () => console.log(`Onshift is running at http://localhost:${PORT}  (colleagues: ${mode() === 'live' ? 'AI' : 'scripted, no network needed'})`))
