// Wires the handlers to node:http. Kept thin so handlers can be tested without a socket.
import { createServer } from 'node:http'
import { passwordLogin } from './auth/passwordLogin.ts'
import type { Request, Response } from './http.ts'
import { listInvoices } from './routes/invoices.ts'
import { refreshSso } from './sso/refresh.ts'

type Handler = (req: Request, res: Response) => Promise<unknown>
const ROUTES: Record<string, Handler> = {
  'POST /login': passwordLogin,
  'POST /sso/refresh': refreshSso,
  'GET /invoices': listInvoices,
}

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2))

createServer(async (incoming, outgoing) => {
  const handler = ROUTES[`${incoming.method} ${incoming.url}`]
  if (!handler) return outgoing.writeHead(404).end()

  let raw = ''
  for await (const chunk of incoming) raw += chunk
  const req: Request = {
    headers: incoming.headers as Request['headers'],
    cookies: parseCookies(incoming.headers.cookie),
    body: raw ? JSON.parse(raw) : {},
  }
  const res: Response = {
    status(code) { outgoing.statusCode = code; return res },
    json(body) { outgoing.setHeader('content-type', 'application/json').end(JSON.stringify(body)); return res },
    cookie(name, value, options = {}) {
      outgoing.appendHeader('set-cookie', `${name}=${value}; Path=/${options.httpOnly ? '; HttpOnly' : ''}; SameSite=${options.sameSite ?? 'lax'}`)
      return res
    },
  }
  await handler(req, res)
}).listen(Number(process.env.PORT ?? 8080))
