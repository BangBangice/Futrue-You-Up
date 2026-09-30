// One running shift: the world the browser sees, the private facts it does not, and the stream that keeps them in step.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import { START, clock } from '../shared/types.ts'
import type { Attachment, ChanId, ChatMsg, Coaching, Email, Level, Patch, PersonId, TermLine, Ticket, Tone, World } from '../shared/types.ts'
import { aiProblem, onAiProblem } from './ai/llm.ts'
import { Workspace } from './sandbox.ts'
import type { Verdict } from './sandbox.ts'
import { loadScenario } from './scenarios.ts'

export const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'sessions')
const MAX_SESSIONS = 8, MAX_TERM = 400
// Loaded once at startup, so a broken scenario file stops the server instead of a shift.
const SCENARIO = loadScenario('ledgerly-day2')

export interface Beat { at: number; kind: string; inc?: string }
export interface Event { t: number; type: string; [k: string]: unknown }
/** What the server knows and the browser must not: hidden verdicts, what the player has and has not done, and what comes next. */
export interface Priv {
  uid: number; beats: Beat[]
  /** Full hidden-check results per commit, with the change that produced them. */
  verdicts: Record<string, Verdict & { diff: string }>
  /** Failed deploys so far. Drives how direct the mentor gets. */
  attempts: number; aiCalls: number; events: Event[]
  f: {
    seen: string[]; warnedAt?: number; readWarningAt?: number; editedAt?: number; testedAt?: number; testsPassed?: boolean
    leoAskedAt?: number; leo?: 'helped' | 'deferred'; ackAt?: number; ackText?: string; askedDanielAt?: number
    clientMailAt?: number; clientAt?: number; clientText?: string; pmAt?: number; pmText?: string; assignAckAt?: number
    rolledBackAt?: number; fixedAt?: number; praised: string[]; reviewed: string[]
  }
}

export class Session {
  world: World
  priv: Priv
  ws!: Workspace
  seq = 0
  clients = new Set<Response>()
  clock: ReturnType<typeof setInterval> | undefined
  timers = new Set<ReturnType<typeof setTimeout>>()
  /** Multiplier on real-time delays. The headless check shrinks it. */
  timeScale = 1
  private saving: ReturnType<typeof setTimeout> | undefined
  readonly dir: string

  constructor(world: World, priv: Priv) {
    this.world = world
    this.priv = priv
    this.dir = join(DATA, world.id)
  }

  // ---------- state ----------
  set(p: Patch | ((w: World) => Patch | null)) {
    const patch = typeof p === 'function' ? p(this.world) : p
    if (!patch) return
    this.world = { ...this.world, ...patch }
    this.send('patch', { patch })
    this.save()
  }
  /** Appends to the event log, the record the mentor and the recap are written from. */
  log(type: string, data: Record<string, unknown> = {}) {
    const e: Event = { t: this.world.simMin, type, ...data }
    this.priv.events.push(e)
    appendFile(join(this.dir, 'events.jsonl'), JSON.stringify(e) + '\n').catch(() => {})
  }
  send(event: string, data: Record<string, unknown>) {
    const frame = `event: ${event}\ndata: ${JSON.stringify({ seq: ++this.seq, ...data })}\n\n`
    this.clients.forEach(c => c.write(frame))
  }
  later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); fn() }, ms * this.timeScale)
    this.timers.add(t)
  }
  at(delta: number, kind: string, inc?: string) { this.priv.beats.push({ at: this.world.simMin + delta, kind, inc }) }
  id() { return ++this.priv.uid }
  get now() { return clock(this.world.simMin) }
  private save() {
    clearTimeout(this.saving)
    this.saving = setTimeout(() => writeFile(join(this.dir, 'session.json'), JSON.stringify({ world: this.world, priv: this.priv })).catch(() => {}), 800)
  }
  stop() { clearInterval(this.clock); this.clock = undefined; this.timers.forEach(clearTimeout); this.timers.clear(); clearTimeout(this.saving) }

  // ---------- things that happen ----------
  term(line: TermLine) {
    this.world.term = [...this.world.term, line].slice(-MAX_TERM)
    this.send('term', { lines: [line] })
  }
  post(chan: ChanId, who: PersonId, text: string, extra: { alert?: ChatMsg['alert']; files?: Attachment[]; coach?: Coaching; fallback?: string } = {}) {
    const msg: ChatMsg = { id: this.id(), who, text, time: this.now, ...extra }
    this.set(w => ({
      chats: { ...w.chats, [chan]: [...w.chats[chan], msg] },
      unread: who === w.player ? w.unread : { ...w.unread, [chan]: w.unread[chan] + 1 },
      typing: w.typing.filter(t => !(t.chan === chan && t.who === who)),
    }))
    if (text || extra.files?.length) this.log('chat', { chan, who, text })
    return msg
  }
  /** Shows "is typing", then posts. Used for scripted lines and for AI replies once they have arrived. */
  say(chan: ChanId, who: PersonId, text: string, extra: Parameters<Session['post']>[3] = {}, ms = 1500 + Math.min(2500, text.length * 12)) {
    this.set(w => ({ typing: [...w.typing.filter(t => !(t.chan === chan && t.who === who)), { chan, who }] }))
    this.later(ms, () => this.post(chan, who, text, extra))
  }
  mail(e: Pick<Email, 'who' | 'subject' | 'body'> & Partial<Email>) {
    const em: Email = { id: 'm' + this.id(), read: false, thread: [], files: [], time: this.now, folder: 'inbox', ...e }
    this.set(w => ({ emails: [em, ...w.emails] }))
    this.log('mail', { who: e.who, subject: e.subject, text: e.body.join('\n') })
    return em
  }
  timeline(text: string, tone: Tone = 'out') { this.set(w => ({ timeline: [...w.timeline, { time: this.now, text, tone }] })) }
  ticket(id: string, p: Partial<Ticket>, by: PersonId, what?: string) {
    const t = this.world.tickets.find(x => x.id === id)
    if (!t) return
    const note = what ?? Object.keys(p).filter(k => k !== 'activity' && k !== 'comments').map(k => `${k} → ${(p as any)[k]}`).join(', ')
    this.set(w => ({ tickets: w.tickets.map(x => (x.id === id ? { ...x, ...p, activity: [...x.activity, { time: this.now, text: `${this.world.cast[by].name}: ${note}` }] } : x)) }))
    // Like the real thing: changes other people make to your tickets land in your inbox.
    const me = this.world.player
    if (by !== me && (t.who === me || p.who === me)) this.mail({ who: 'jira', folder: 'alerts', subject: `[JIRA] (${id}) ${t.title}`, body: [`${this.world.cast[by].name} updated ${id}.`, note], files: [{ kind: 'ticket', id }] })
  }
}

// ---------- the sessions on this machine ----------
const sessions = new Map<string, Session>()
export const valid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
export const roster = (): Pick<World, 'cast' | 'channels' | 'player'> => structuredClone({ cast: SCENARIO.cast, channels: SCENARIO.channels, player: SCENARIO.player })

export async function create(level: Level, background: string, pace: number, ai: World['ai']) {
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
  const id = randomUUID()
  const world: World = {
    id, stage: 'sim', level, background, ai, aiProblem: aiProblem(), pace, simMin: START,
    ...roster(), ...structuredClone(SCENARIO.seed), typing: [],
    files: [], code: { branch: '', head: '', subject: '', changes: [], busy: null }, term: [],
    deploys: [], incident: null, demo: 'pending',
    timeline: [{ time: '12:02 PM', text: 'Deploy billing-api@e0c3a18 (Daniel)', tone: 'dim' }], recap: null,
  }
  const s = new Session(world, { uid: 100, beats: [], verdicts: {}, attempts: 0, aiCalls: 0, events: [], f: { seen: [], praised: [], reviewed: [] } })
  await mkdir(s.dir, { recursive: true })
  s.ws = await Workspace.open(s.dir)
  sessions.set(id, s)
  return s
}

/** Finds a running shift, or brings one back from disk after a restart. */
export async function find(id: string) {
  if (sessions.has(id)) return sessions.get(id)!
  const file = join(DATA, id, 'session.json')
  if (!existsSync(file)) return null
  const saved = JSON.parse(await readFile(file, 'utf8'))
  // Shifts saved before the cast moved into the world have none of their own.
  const s = new Session({ ...roster(), ...saved.world, aiProblem: aiProblem(), typing: [], code: { ...saved.world.code, busy: null } }, saved.priv)
  s.ws = await Workspace.open(s.dir)
  sessions.set(id, s)
  return s
}
export const all = () => [...sessions.values()]
onAiProblem(p => all().forEach(s => s.set({ aiProblem: p })))
