// One running shift: the world the browser sees, the private facts it does not, and the stream that keeps them in step.
import { mkdir, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import { STORY, personalize } from '../shared/scenario.ts'
import type { Scenario } from '../shared/scenario.ts'
import { clock, firstName, minutes } from '../shared/types.ts'
import type { Attachment, ChanId, ChatMsg, Coaching, Email, Level, Patch, PersonId, TermLine, Ticket, Tone, World } from '../shared/types.ts'
import { aiProblem, onAiProblem } from './ai/llm.ts'
import { MAX_SNAPSHOT, Workspace } from './sandbox.ts'
import type { Verdict } from './sandbox.ts'
import { deleteRuns, moveRuns, store } from './runs.ts'
import { DEFAULT_SCENARIO, scenarioFile } from './scenarios.ts'

export const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'sessions')
// A cache of live shifts, not the record of them: an evicted shift is saved first and reloads on its next request.
const MAX_SESSIONS = 32, MAX_TERM = 400

export interface Beat { at: number; kind: string; inc?: string }
export interface Event { t: number; type: string; [k: string]: unknown }
/** What the server knows and the browser must not: hidden verdicts, what the player has and has not done, and what comes next. */
export interface Priv {
  uid: number; beats: Beat[]
  /** Full hidden-check results per commit, with the change that produced them. */
  verdicts: Record<string, Verdict & { diff: string }>
  /** Failed deploys so far. Drives how direct the mentor gets. */
  attempts: number; aiCalls: number; events: Event[]
  /** Set when the shift ends: whether the lesson's work was done by then (see director.end). */
  finished?: boolean
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
  /** The run's row version in the store, for optimistic locking. */
  rev = 0
  /** Who owns the run. Kept out of the world, which goes to the browser. Null without accounts. */
  userId: string | null = null
  private saving: ReturnType<typeof setTimeout> | undefined
  private writing = Promise.resolve(true)
  private snapping: ReturnType<typeof setTimeout> | undefined
  private packing = Promise.resolve()
  /** The hash of the last snapshot written, so an unchanged workspace is not written again. */
  private packed = ''
  readonly dir: string
  readonly scenario: Scenario

  constructor(world: World, priv: Priv, scenario: Scenario) {
    this.world = world
    this.priv = priv
    // The shift's own copy, cast with whoever is playing, so {{player}} in later triggers and persona cards reads right.
    this.scenario = personalize(scenario, world.cast[world.player] ?? scenario.cast[scenario.player])
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
    store().appendEvent(this, e)
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
    this.saving = setTimeout(() => void this.flush(), 800)
  }
  /** Saves now. Writes queue behind each other, so each one expects the version the last one left. */
  flush() {
    clearTimeout(this.saving)
    this.saving = undefined
    return (this.writing = this.writing.then(() => store().saveRun(this)))
  }
  /** Snapshots the workspace to the store soon, after anything that may have changed it. Nothing to do with the file store. */
  snap() {
    if (!store().workspaces) return
    clearTimeout(this.snapping)
    this.snapping = setTimeout(() => void this.flushWorkspace(), 2000)
  }
  /** Snapshots now, queued behind any snapshot still being written. Unchanged snapshots are not written again. */
  flushWorkspace() {
    clearTimeout(this.snapping)
    this.snapping = undefined
    const keep = store().workspaces
    if (!keep || !this.ws) return this.packing
    return (this.packing = this.packing.then(async () => {
      try {
        const snapshot = await this.ws.pack()
        if (snapshot.length > MAX_SNAPSHOT) return console.error(`[workspace] ${this.world.id}: snapshot is ${snapshot.length} bytes, over the ${MAX_SNAPSHOT}-byte limit; not saved, so a restore will bring back an older one`)
        const hash = createHash('sha256').update(snapshot).digest('hex')
        if (hash === this.packed) return
        await keep.save(this.world.id, snapshot)
        this.packed = hash
      } catch (err) { console.warn(`[workspace] ${this.world.id}: snapshot not saved`, err) }
    }))
  }
  stop() {
    clearInterval(this.clock); this.clock = undefined; this.timers.forEach(clearTimeout); this.timers.clear()
    // The shift's sandbox goes too, if it has one: nothing is kept there, and the next run makes a new one.
    return Promise.all([this.saving ? this.flush() : this.writing, this.snapping ? this.flushWorkspace() : this.packing, this.ws?.close()]).then(([saved]) => saved)
  }

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
const loading = new Map<string, Promise<Session | null>>()
export const valid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
// Persona cards and mentor guidance are prompts, so they stay on the server. So do security checks: the browser must not learn they exist.
export const roster = (sc: Scenario): Pick<World, 'company' | 'workspace' | 'calendar' | 'cast' | 'channels' | 'player' | 'mentor' | 'levels' | 'deadline' | 'impact' | 'guide'> => structuredClone({
  company: sc.company.name, workspace: sc.workspace,
  calendar: { weekday: sc.story.weekday ?? STORY.weekday, date: sc.story.date ?? STORY.date, day: sc.story.day ?? STORY.day, start: minutes(sc.clock.start) },
  cast: Object.fromEntries(Object.entries(sc.cast).map(([id, { persona: _, ...p }]) => [id, p])), channels: sc.channels, player: sc.player, mentor: sc.mentor,
  levels: Object.fromEntries(Object.entries(sc.levels).map(([k, { mentorGuidance: _, ...l }]) => [k, l])),
  deadline: sc.clock.deadline ? minutes(sc.clock.deadline) : null,
  impact: { alarmPercent: sc.alarmPercent, checks: sc.checks.filter(c => c.share > 0).map(({ security: _, ...c }) => c), customers: sc.customers },
  guide: sc.guide,
})

/** Makes room, preferring a shift nobody is watching. Its open streams reconnect and reload it. */
async function evict() {
  if (sessions.size < MAX_SESSIONS) return
  const s = all().find(x => !x.clients.size) ?? all()[0]
  s.clients.forEach(c => c.end())
  await drop(s.world.id)
}

/** `who` is the person playing. Without accounts the scenario's own player is used. `scenario` is an id from the catalog,
 * or a lesson's spec with the version row it is pinned to (see authoring.ts). */
export async function create(level: Level, background: string, pace: number, ai: World['ai'], userId: string | null = null, who?: { name: string; short?: string },
  scenario: string | { spec: Scenario; version: string } = DEFAULT_SCENARIO) {
  const file = typeof scenario === 'string' ? scenarioFile(scenario) : undefined
  if (typeof scenario === 'string' && !file) throw new Error(`No scenario "${scenario}".`)
  await evict()
  const { spec: picked, version } = file ? await store().pickScenario(file) : scenario as { spec: Scenario; version: string }
  const spec = personalize(picked, who ?? picked.cast[picked.player])
  const id = randomUUID()
  const world: World = {
    id, stage: 'sim', level, background, ai, aiProblem: aiProblem(), pace, simMin: minutes(spec.clock.start),
    ...roster(spec), ...structuredClone(spec.seed), typing: [],
    files: [], code: { branch: '', head: '', subject: '', changes: [], busy: null }, term: [],
    deploys: [], incident: null, demo: 'pending',
    timeline: [{ time: '12:02 PM', text: `Deploy billing-api@e0c3a18 (${firstName(spec.cast[spec.mentor])})`, tone: 'dim' }], recap: null,
  }
  const s = new Session(world, { uid: 100, beats: [], verdicts: {}, attempts: 0, aiCalls: 0, events: [], f: { seen: [], praised: [], reviewed: [] } }, spec)
  s.userId = userId
  await mkdir(s.dir, { recursive: true })
  s.ws = await Workspace.open(s.dir, world.cast[world.player], { repo: spec.workspace.repo, author: spec.cast[spec.mentor] })
  await store().createRun(s, version)
  sessions.set(id, s)
  return s
}

/** Finds a running shift, or brings one back from the store after a restart or an eviction. */
export async function find(id: string): Promise<Session | null> {
  if (sessions.has(id)) return sessions.get(id)!
  if (!loading.has(id)) loading.set(id, load(id).finally(() => loading.delete(id)))
  return loading.get(id)!
}
async function load(id: string) {
  const saved = await store().loadRun(id, join(DATA, id))
  if (!saved) return null
  await evict()
  // Shifts saved before the cast moved into the world have none of their own.
  const s = new Session({ ...roster(saved.scenario), ...saved.world, aiProblem: aiProblem(), typing: [], code: { ...saved.world.code, busy: null } }, saved.priv, saved.scenario)
  s.rev = saved.rev
  s.userId = saved.userId
  await mkdir(s.dir, { recursive: true })
  // A redeploy or another instance has no copy on disk: the store's snapshot brings back the player's commits and unsaved work.
  const snapshot = async () => (await store().workspaces?.load(id)) ?? null
  s.ws = await Workspace.open(s.dir, s.world.cast[s.world.player], { repo: s.scenario.workspace.repo, author: s.scenario.cast[s.scenario.mentor], saved: snapshot })
  sessions.set(id, s)
  return s
}
/** Forgets a shift without ending it, as eviction does. */
export async function drop(id: string) {
  const s = sessions.get(id)
  sessions.delete(id)
  await s?.stop()
}
export const all = () => [...sessions.values()]
/** Hands a guest's runs to the account they linked to, in the store and in the cache. */
export async function adopt(from: string, to: string) {
  await moveRuns(from, to)
  all().forEach(s => { if (s.userId === from) s.userId = to })
}
/** Ends a player's runs for good: out of the cache, the store and the disk. */
export async function discard(userId: string) {
  await Promise.all(all().filter(s => s.userId === userId).map(s => drop(s.world.id)))
  await Promise.all((await deleteRuns(userId)).map(id => rm(join(DATA, id), { recursive: true, force: true })))
}
onAiProblem(p => all().forEach(s => s.set({ aiProblem: p })))
