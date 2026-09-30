// The API. Every request body is checked here before it reaches the director.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { APP_IDS, COLS, FOLDERS, PACES, PRIORITIES } from '../shared/types.ts'
import type { Attachment, Level } from '../shared/types.ts'
import { mode, probe } from './ai/llm.ts'
import * as director from './director.ts'
import { Refusal } from './sandbox.ts'
import { create, find, roster, valid } from './world.ts'

class Bad extends Error { status = 400 }
class Missing extends Error { status = 404 }
const LEVELS: Level[] = ['newgrad', 'bootcamp', 'switcher']

const text = (v: unknown, max: number, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Bad(`${name} is required`)
  if (v.length > max) throw new Bad(`${name} is too long (limit ${max} characters)`)
  return v
}
const maybe = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const pick = <T extends string>(v: unknown, allowed: readonly T[], name: string): T => {
  if (!allowed.includes(v as T)) throw new Bad(`${name} must be one of: ${allowed.join(', ')}`)
  return v as T
}
const optional = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined)
function attachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 8).flatMap((a): Attachment[] => {
    if (a?.kind === 'code' && typeof a.path === 'string') return [{ kind: 'code', path: a.path.slice(0, 200) }]
    if (a?.kind === 'doc' && typeof a.doc === 'string') return [{ kind: 'doc', doc: a.doc.slice(0, 40) }]
    if (a?.kind === 'ticket' && typeof a.id === 'string') return [{ kind: 'ticket', id: a.id.slice(0, 20) }]
    if (a?.kind === 'upload' && typeof a.name === 'string') return [{ kind: 'upload', name: a.name.slice(0, 120), size: Number(a.size) || 0, url: maybe(a.url, 300) }]
    if (a?.kind === 'link' && APP_IDS.includes(a.app)) return [{ kind: 'link', label: maybe(a.label, 80), app: a.app }]
    return []
  })
}
async function session(req: Request) {
  const id = req.params.id
  const s = valid(id) ? await find(id) : null
  if (!s) throw new Missing('That shift no longer exists.')
  return s
}

export const api = Router()

// Checked from the start page, so a broken key or model shows up before the first colleague fails to reply.
api.get('/health', async (_req, res) => {
  res.json({ ai: mode(), problem: await probe() })
})

// The start page shows who you will be before a shift exists.
api.get('/scenario', (_req, res) => { res.json(roster()) })

api.post('/sessions', async (req, res) => {
  const level = pick(req.body?.level, LEVELS, 'level')
  const speed = PACES.map(p => p[0]).includes(req.body?.pace) ? req.body.pace : 4
  const s = await create(level, maybe(req.body?.background, 400).trim(), speed, mode())
  await director.start(s)
  res.status(201).json({ id: s.world.id })
})

api.get('/sessions/:id/events', async (req, res) => {
  const s = await session(req)
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.write(`event: snapshot\ndata: ${JSON.stringify({ seq: s.seq, world: s.world })}\n\n`)
  s.clients.add(res)
  director.run(s)
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  req.on('close', () => {
    clearInterval(ping)
    s.clients.delete(res)
    if (!s.clients.size) director.pause(s)
  })
})

api.get('/sessions/:id/file', async (req, res) => {
  const s = await session(req), path = text(req.query.path, 300, 'path')
  res.json({ path, text: await s.ws.read(path, req.query.rev === 'HEAD' ? 'HEAD' : undefined) })
  if (req.query.rev !== 'HEAD') director.seen(s, 'file:' + path)
})
api.put('/sessions/:id/file', async (req, res) => {
  const s = await session(req)
  if (typeof req.body?.text !== 'string') throw new Bad('text is required')
  await director.saveFile(s, text(req.body.path, 300, 'path'), req.body.text)
  res.json({ ok: true })
})

api.post('/sessions/:id/act', async (req, res) => {
  const s = await session(req), a = req.body ?? {}
  if (s.world.stage !== 'sim') throw new Bad('This shift has ended.')
  const files = attachments(a.files)
  switch (a.type) {
    case 'chat':
      if (!files.length) text(a.text, 4000, 'message')
      director.chat(s, pick(a.chan, Object.keys(s.world.channels), 'chan'), maybe(a.text, 4000).trim(), files)
      break
    case 'mail':
      if (!files.length) text(a.text, 20_000, 'message')
      director.mail(s, { mode: pick(a.mode, ['reply', 'new', 'forward'] as const, 'mode'), ref: maybe(a.ref, 40), to: maybe(a.to, 120), subject: maybe(a.subject, 140), text: maybe(a.text, 20_000).trim(), files })
      break
    case 'mailPatch':
      director.patchMail(s, text(a.id, 40, 'id'), { ...(typeof a.read === 'boolean' && { read: a.read }), ...(typeof a.flagged === 'boolean' && { flagged: a.flagged }), ...(optional(a.folder, FOLDERS) && { folder: a.folder }) })
      break
    case 'seen': director.seen(s, text(a.what, 300, 'what')); break
    // Long-running: the answer arrives over the event stream, not in this response.
    case 'exec': void director.command(s, text(a.cmd, 500, 'command')); break
    case 'commit': void director.commit(s, text(a.message, 200, 'message')); break
    case 'kill': s.ws.kill(); break
    case 'ticket':
      res.json({ ok: true, id: director.saveTicket(s, a.id ? text(a.id, 20, 'id') : undefined, {
        ...(typeof a.title === 'string' && { title: text(a.title, 160, 'title') }), ...(typeof a.desc === 'string' && { desc: a.desc.slice(0, 4000) }),
        ...(optional(a.status, COLS.map(c => c[0])) && { status: a.status }), ...(optional(a.pri, PRIORITIES) && { pri: a.pri }),
        ...(a.who === null ? { who: null } : optional(a.who, Object.keys(s.world.cast)) && { who: a.who }),
      }) })
      return
    case 'comment': director.comment(s, text(a.id, 20, 'id'), text(a.text, 2000, 'comment')); break
    case 'doc':
      res.json({ ok: true, id: director.saveDoc(s, a.id ? text(a.id, 40, 'id') : undefined, { title: text(a.title, 120, 'title'), group: maybe(a.group, 40).trim() || 'Notes', body: maybe(a.body, 100_000) }) })
      return
    case 'pace':
      if (!PACES.some(p => p[0] === a.pace)) throw new Bad('pace must be one of: ' + PACES.map(p => p[0]).join(', '))
      director.pace(s, a.pace)
      break
    case 'end': void director.end(s); break
    default: throw new Bad('Unknown action.')
  }
  res.json({ ok: true })
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express recognises error handlers by their four arguments
export function errors(err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof Refusal ? 400 : err.status ?? 500
  if (status >= 500) console.error('[api]', err)
  if (res.headersSent) return res.end()
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message })
}
