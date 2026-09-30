// The browser's side of a shift. The server owns the world and streams changes to it;
// this store keeps a copy, adds what only the browser knows (windows, drafts, open files), and sends the player's actions.
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { APP_NAMES } from '../../shared/types.ts'
import type { AppId, Attachment, ChanId, Doc, Folder, Level, Patch, Priority, TermLine, Theme, Ticket, World } from '../../shared/types.ts'

export interface Win { open: boolean; min: boolean; max: boolean; x: number; y: number; w: number; h: number; z: number }
/** Without an app it is a notice from LARP itself. */
export interface Toast { id: number; app?: AppId; title: string; body: string; go: () => void }
export interface Compose { mode: 'reply' | 'new' | 'forward'; to: string; subject: string }
/** A file open in the editor. `saved` is what is on disk, so the two differ while there are unsaved edits. */
export interface Buffer { text: string; saved: string }
/** A request to flash an element tagged data-guide: the first of `keys` on screen, or `fallback` if none turns up. */
export interface Spot { keys: string[]; fallback?: string; n: number }
export interface View {
  stage: 'onboard' | 'sim' | 'recap'; theme: Theme; online: boolean; starting: boolean; error: string
  wins: Record<AppId, Win>; topZ: number; focus: AppId | null; toasts: Toast[]; desk: { W: number; H: number }
  mailFolder: Folder; mailSel: string; mailDraft: string; mailFiles: Attachment[]; compose: Compose | null
  chan: ChanId; chatDraft: string; chatFiles: Attachment[]
  ticketSel: string; docPage: string
  tabs: string[]; codeFile: string; buffers: Record<string, Buffer>; side: 'files' | 'git'; diff: { path: string; head: string } | null
  /** What the player has looked at or run, for the step guide. Only the browser knows this. */
  seen: string[]; spot: Spot | null; guideOpen: boolean
  /** On a phone an app shows one pane at a time: its list, or (true) what was opened from it. Wider screens show both and ignore this. */
  deep: Record<AppId, boolean>
  /** The lesson picked in the library, or '' for the server's default. Kept across shifts, like the level. */
  scenario: string
}
export type State = Omit<World, 'stage'> & View

const win = (x: number, y: number, w: number, h: number, open: boolean, z: number): Win => ({ open, min: false, max: false, x, y, w, h, z })
const LAYOUT: Record<AppId, [number, number, number, number]> = { mail: [0.04, 44, 1060, 620], docs: [0.12, 52, 1000, 640], chat: [0.3, 64, 900, 580], code: [0.06, 40, 1180, 700], tracker: [0.14, 58, 1040, 600], monitor: [0.17, 42, 1020, 660] }
const NO_DRAFT = { compose: null, mailDraft: '', mailFiles: [] as Attachment[] }
const KEY = 'larp.session'
const SEEN = 'larp.seen'
/** A lesson picked but not started yet, so a reload stays on its start page instead of resuming an older shift. */
const LESSON = 'larp.lesson'
const TEST = /^\s*(npm (test|t|run test)\b|node --test)/
/** Matches the media query in mobile.css. */
export const phone = () => matchMedia('(max-width: 720px), (pointer: coarse) and (max-height: 540px)').matches

const view = (): View => ({
  stage: 'onboard', theme: 'light', online: false, starting: false, error: '',
  wins: Object.fromEntries((Object.keys(LAYOUT) as AppId[]).map(k => [k, win(60, LAYOUT[k][1], LAYOUT[k][2], LAYOUT[k][3], k === 'mail', k === 'mail' ? 3 : 1)])) as Record<AppId, Win>,
  topZ: 3, focus: 'mail', toasts: [], desk: { W: 1280, H: 760 },
  mailFolder: 'inbox', mailSel: 'e1', ...NO_DRAFT,
  chan: 'team', chatDraft: '', chatFiles: [],
  ticketSel: 'LED-214', docPage: 'home',
  tabs: [], codeFile: '', buffers: {}, side: 'files', diff: null,
  seen: [], spot: null, guideOpen: true,
  deep: { mail: false, chat: false, code: true, tracker: false, docs: true, monitor: false },
  scenario: '',
})
const nowhere = (): Omit<World, 'stage'> => ({
  id: '', level: 'bootcamp', background: '', ai: 'live', aiProblem: null, pace: 4, simMin: 0, lesson: { id: '', title: '', summary: null }, company: '', workspace: { repo: '', host: '' }, calendar: { weekday: '', date: '', day: 0, start: 0 }, cast: {}, channels: {}, player: '', mentor: '', levels: {}, deadline: null, guide: [],
  impact: { alarmPercent: 0, checks: [], customers: { named: [], otherAccounts: 0, otherPasswordUsers: 0 } },
  emails: [], chats: {}, unread: {}, typing: [],
  tickets: [], docs: [], files: [], code: { branch: '', head: '', subject: '', changes: [], busy: null }, term: [],
  deploys: [], incident: null, demo: 'pending', timeline: [], recap: null,
})

/** Where a window actually sits once clamped to the desktop. */
export function winRect(w: Win, D: { W: number; H: number }) {
  if (w.max) return { left: 6, top: 32, width: D.W - 12, height: D.H - 32 - 90 }
  const width = Math.min(w.w, D.W - 20), height = Math.min(w.h, D.H - 110)
  return { left: Math.max(10 - width + 80, Math.min(w.x, D.W - 80)), top: Math.max(26, Math.min(w.y, D.H - 110)), width, height }
}
export const live = (s: Pick<World, 'incident'>) => !!s.incident && s.incident.resolvedAt === null

export class Store {
  state: State = { ...nowhere(), ...view(), scenario: sessionStorage.getItem(LESSON) ?? '' }
  private subs = new Set<() => void>()
  private stream: EventSource | null = null
  private seq = 0
  private uid = 0
  /** Messages and mail already on screen, so reconnecting does not announce them again. */
  private known = new Set<string>()
  private saver: ReturnType<typeof setTimeout> | undefined

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  set(p: Partial<State> | ((s: State) => Partial<State> | null)) {
    const patch = typeof p === 'function' ? p(this.state) : p
    if (!patch) return
    this.state = { ...this.state, ...patch }
    this.subs.forEach(fn => fn())
  }

  // ---------- the server ----------
  private async call(path: string, init?: RequestInit) {
    const res = await fetch(`/api/sessions/${this.state.id}${path}`, init && { ...init, headers: { 'content-type': 'application/json' } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'The server did not accept that.')
    return body
  }
  private act(a: Record<string, unknown>) {
    return this.call('/act', { method: 'POST', body: JSON.stringify(a) }).catch(e => { this.toast({ app: this.state.focus ?? 'mail', title: 'That did not go through', body: e.message, go: () => {} }); throw e })
  }
  /** Sends a file from the player's computer to the server, which keeps the bytes and answers with what to attach. */
  upload = async (f: File): Promise<Attachment> => {
    const res = await fetch(`/api/sessions/${this.state.id}/files?name=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: f,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'The server did not accept that file.')
    return body as Attachment
  }
  start = async () => {
    const { level, background, pace, scenario } = this.state
    this.set({ starting: true, error: '' })
    try {
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level, background, pace, scenario: scenario || undefined }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The server could not start a shift.')
      sessionStorage.removeItem(LESSON)
      this.connect((await res.json()).id)
    } catch (e) { this.set({ starting: false, error: (e as Error).message.includes('fetch') ? 'Cannot reach the LARP server. Is "npm run dev" running?' : (e as Error).message }) }
  }
  /** Asks the server whether the AI model answers, so the start page can warn before a colleague goes quiet. */
  checkAi = async () => {
    try {
      const res = await fetch('/api/health')
      if (!res.ok) return
      const { ai, problem } = await res.json() as { ai: World['ai']; problem: string | null }
      if (problem) console.error(`[LARP] AI health check failed: ${problem}. Colleagues will use scripted lines until it recovers.`)
      this.set(s => (s.stage === 'onboard' ? { ai, aiProblem: problem } : null))
    } catch { /* the server is down; starting a shift will say so */ }
  }
  /** Who the player will be, for the start page. The shift's own snapshot replaces it. */
  loadCast = async () => {
    try {
      const { scenario } = this.state
      const res = await fetch('/api/scenario' + (scenario ? '?id=' + encodeURIComponent(scenario) : ''))
      if (!res.ok) return
      const cast = await res.json() as Pick<World, 'lesson' | 'company' | 'workspace' | 'calendar' | 'cast' | 'channels' | 'player' | 'mentor' | 'levels' | 'deadline' | 'impact'>
      this.set(s => (s.stage === 'onboard' && s.scenario === scenario ? cast : null))
    } catch { /* the server is down; starting a shift will say so */ }
  }
  /** Picks a lesson from the library: a fresh start page for it. A shift left unfinished can still be resumed from the library. */
  choose = (scenario: string) => {
    this.replay()
    this.set({ scenario })
    sessionStorage.setItem(LESSON, scenario)
  }
  /** The shift this tab last played, if any. */
  saved = () => sessionStorage.getItem(KEY)
  /** Goes back to a shift from the library, rather than to a lesson picked but not started. */
  pickUp = (id: string) => { sessionStorage.removeItem(LESSON); sessionStorage.setItem(KEY, id) }
  leave() { this.stream?.close(); this.stream = null }
  /** Picks up a shift that was already running: this tab's, or with an account the newest one still going. */
  resume = async (accounts: boolean) => {
    const id = sessionStorage.getItem(KEY)
    if (id) return this.connect(id)
    if (!accounts || sessionStorage.getItem(LESSON)) return
    const runs = await fetch('/api/me/runs').then(r => (r.ok ? r.json() as Promise<{ id: string; status: string }[]> : []), () => [])
    const run = runs.find(r => r.status === 'active')
    if (run && !this.state.id) this.connect(run.id)
  }
  private connect(id: string) {
    this.stream?.close()
    sessionStorage.setItem(KEY, id)
    const es = this.stream = new EventSource(`/api/sessions/${id}/events`)
    const read = (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      // A gap means a message was lost. Reconnecting brings a fresh snapshot.
      if (e.type !== 'snapshot' && d.seq !== this.seq + 1) return this.connect(id)
      this.seq = d.seq
      return d
    }
    es.addEventListener('snapshot', e => {
      const { world } = read(e) as { world: World }
      const fresh = this.state.id !== world.id
      this.remember(world)
      this.set({ ...(fresh ? { ...view(), seen: this.recall(world.id) } : {}), theme: this.state.theme, desk: this.state.desk, scenario: this.state.scenario, ...world, online: true, starting: false })
      if (fresh) this.fit(this.state.desk.W, this.state.desk.H)
      // Only on a touch device: a narrow laptop window gets the phone layout too, but it is still a laptop.
      if (fresh && phone() && matchMedia('(pointer: coarse)').matches) this.toast({ title: 'Best on a laptop', body: 'LARP is built for a bigger screen. It works on your phone too, with less room.', go: () => {} })
    })
    es.addEventListener('patch', e => { const d = read(e); if (d) this.apply(d.patch) })
    es.addEventListener('term', e => {
      const d = read(e) as { lines: TermLine[]; clear?: boolean } | undefined
      if (d) this.set(s => ({ term: d.clear ? [] : [...s.term, ...d.lines].slice(-400) }))
    })
    es.onerror = async () => {
      this.set({ online: false })
      if (es.readyState !== EventSource.CLOSED || this.stream !== es) return // the browser is retrying by itself
      // Closed for good. Either the server no longer knows this shift, or it is briefly unreachable.
      const status = await fetch(`/api/sessions/${id}/file?path=package.json`).then(r => r.status, () => 0)
      if (this.stream !== es) return
      // Signed out elsewhere, or the session expired: reloading goes back to the sign-in page.
      if (status === 401) location.reload()
      else if (status === 404) this.replay()
      else setTimeout(() => { if (this.stream === es) this.connect(id) }, 2000)
    }
  }
  private remember(w: Pick<World, 'emails' | 'chats'>) {
    w.emails.forEach(e => this.known.add(e.id))
    Object.values(w.chats).flat().forEach(m => this.known.add('c' + m.id))
  }
  private apply(patch: Patch) {
    const before = this.state
    if (patch.aiProblem && patch.aiProblem !== before.aiProblem) console.error(`[LARP] AI calls are failing: ${patch.aiProblem}`)
    this.set(patch as Partial<State>)
    const s = this.state
    // Announce what is new, unless the player is already looking at it.
    for (const e of patch.emails ?? []) if (!this.known.has(e.id) && e.who !== s.player) this.toast({ app: 'mail', title: s.cast[e.who].name, body: e.subject, go: () => this.openMail(e.id) })
    for (const [chan, msgs] of Object.entries(patch.chats ?? {}) as [ChanId, World['chats'][ChanId]][]) for (const m of msgs) {
      if (this.known.has('c' + m.id) || m.who === s.player) continue
      if (!(this.watching(chan) && s.focus === 'chat')) this.toast({ app: 'chat', title: s.cast[m.who].name + (s.channels[chan].dm ? '' : ' in ' + s.channels[chan].label), body: m.text, go: () => this.openChat(chan) })
    }
    this.remember(s)
    if (patch.unread && this.watching(s.chan) && s.unread[s.chan]) void this.act({ type: 'seen', what: 'chan:' + s.chan })
    // A command may have changed files on disk (git checkout, git stash). Reload what is open and unedited.
    if (before.code.busy && !s.code.busy) s.tabs.forEach(p => { if (s.buffers[p]?.text === s.buffers[p]?.saved) void this.load(p) })
    if (patch.files) this.set(x => ({ tabs: x.tabs.filter(p => x.files.includes(p)), codeFile: x.files.includes(x.codeFile) ? x.codeFile : '' }))
  }
  private watching = (chan: ChanId) => { const s = this.state; return s.stage === 'sim' && s.wins.chat.open && !s.wins.chat.min && s.chan === chan && (s.deep.chat || !phone()) }

  // ---------- shift ----------
  setPace = (pace: number) => (this.state.id ? void this.act({ type: 'pace', pace }) : this.set({ pace }))
  endShift = () => void this.act({ type: 'end' })
  replay = () => { this.stream?.close(); this.stream = null; sessionStorage.removeItem(KEY); sessionStorage.removeItem(SEEN); this.known.clear(); const { theme, level, background, scenario } = this.state; this.set({ ...nowhere(), ...view(), theme, level, background, scenario }) }

  // ---------- notifications ----------
  toast(t: Omit<Toast, 'id'>) {
    const id = ++this.uid
    this.set(s => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }))
    setTimeout(() => this.dismissToast(id), 6500)
  }
  dismissToast = (id: number) => this.set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }))

  // ---------- the step guide ----------
  mark = (key: string) => {
    if (this.state.seen.includes(key)) return
    this.set(s => ({ seen: [...s.seen, key] }))
    try { sessionStorage.setItem(SEEN, JSON.stringify({ id: this.state.id, seen: this.state.seen })) } catch { /* only a convenience */ }
  }
  private recall(id: string): string[] {
    try { const r = JSON.parse(sessionStorage.getItem(SEEN) ?? 'null'); return r?.id === id ? r.seen : [] } catch { return [] }
  }
  spotlight = (keys: string[], fallback?: string) => this.set({ spot: { keys, fallback, n: ++this.uid } })

  // ---------- windows ----------
  fit(W: number, H: number) {
    this.set(s => {
      const wins = { ...s.wins }
      for (const k of Object.keys(LAYOUT) as AppId[]) {
        const [px, y, w0, h0] = LAYOUT[k], w = Math.min(w0, W - 40), h = Math.min(h0, H - 130)
        wins[k] = { ...s.wins[k], x: Math.max(10, Math.min(Math.round(W * px), W - w - 10)), y, w, h }
      }
      return { wins, desk: { W, H } }
    })
  }
  setDesk(W: number, H: number) { if (W !== this.state.desk.W || H !== this.state.desk.H) this.set({ desk: { W, H } }) }
  open = (app: AppId) => {
    this.set(s => { const z = s.topZ + 1; return { wins: { ...s.wins, [app]: { ...s.wins[app], open: true, min: false, z } }, topZ: z, focus: app } })
    const s = this.state
    if (app === 'chat' && s.unread[s.chan] && this.watching(s.chan)) void this.act({ type: 'seen', what: 'chan:' + s.chan })
    if (app === 'code' && !s.codeFile && s.files.length) void this.openFile(s.files.includes('src/auth/verifySession.ts') ? 'src/auth/verifySession.ts' : s.files[0])
    if (app === 'docs') { this.mark('doc:' + s.docPage); void this.act({ type: 'seen', what: 'doc:' + s.docPage }) }
    if (app === 'monitor') this.mark('monitor@' + s.deploys.length)
  }
  focusWin = (app: AppId) => { const s = this.state; if (s.focus === app && s.wins[app].z === s.topZ) return; this.open(app) }
  private patchWin(app: AppId, p: Partial<Win>, blur = false) { this.set(s => ({ wins: { ...s.wins, [app]: { ...s.wins[app], ...p } }, focus: blur && s.focus === app ? null : s.focus })) }
  closeWin = (app: AppId) => this.patchWin(app, { open: false, max: false }, true)
  minWin = (app: AppId) => this.patchWin(app, { min: true }, true)
  maxWin = (app: AppId) => this.patchWin(app, { max: !this.state.wins[app].max })
  moveWin = (app: AppId, p: Partial<Pick<Win, 'x' | 'y' | 'w' | 'h'>>) => this.patchWin(app, p)
  /** Which pane a phone shows: what was opened (the default), or back to the list with `false`. */
  dive = (app: AppId, on = true) => this.set(s => (s.deep[app] === on ? null : { deep: { ...s.deep, [app]: on } }))

  openChat = (chan: ChanId) => { this.set({ chan }); this.dive('chat'); this.open('chat') }
  openTicket = (id: string) => { if (this.state.tickets.some(t => t.id === id)) this.set({ ticketSel: id }); this.dive('tracker'); this.open('tracker') }
  openDoc = (id: string) => { if (this.state.docs.some(d => d.id === id)) this.set({ docPage: id }); this.dive('docs'); this.open('docs') }
  openAttachment = (a: Attachment) => {
    if (a.kind === 'code') void this.openCode(a.path)
    else if (a.kind === 'doc') this.openDoc(a.doc)
    else if (a.kind === 'ticket') this.openTicket(a.id)
    else if (a.kind === 'link') a.chan ? this.openChat(a.chan) : this.open(a.app)
    // Back through the shift's own route, which is what decides whether this player may have the file at all.
    else if (a.id && this.state.id) window.open(`/api/sessions/${this.state.id}/files/${a.id}`, '_blank', 'noopener')
  }

  // ---------- Outlook ----------
  openMail = (id: string) => {
    const em = this.state.emails.find(e => e.id === id)
    this.set(s => ({ mailSel: id, mailFolder: em?.folder ?? s.mailFolder, ...NO_DRAFT }))
    if (em && !em.read) void this.act({ type: 'mailPatch', id, read: true })
    this.dive('mail')
    this.open('mail')
  }
  reply = () => { this.set({ compose: { mode: 'reply', to: '', subject: '' }, mailDraft: '', mailFiles: [] }); const e = this.state.emails.find(x => x.id === this.state.mailSel); if (e && !e.read) this.patchMail(e.id, { read: true }) }
  newMail = () => { this.set({ compose: { mode: 'new', to: '', subject: '' }, mailDraft: '', mailFiles: [] }); this.dive('mail'); this.open('mail') }
  forward = () => { const e = this.state.emails.find(x => x.id === this.state.mailSel); if (e) this.set({ compose: { mode: 'forward', to: '', subject: 'Fw: ' + e.subject }, mailDraft: '', mailFiles: e.files }) }
  discardMail = () => this.set(NO_DRAFT)
  patchMail = (id: string, p: { read?: boolean; flagged?: boolean }) => void this.act({ type: 'mailPatch', id, ...p })
  moveMail = (id: string, folder: Folder) => {
    const s = this.state, list = s.emails.filter(e => e.folder === s.mailFolder), i = list.findIndex(e => e.id === id)
    this.set({ mailSel: s.mailSel === id ? (list[i + 1] ?? list[i - 1])?.id ?? '' : s.mailSel, ...NO_DRAFT })
    void this.act({ type: 'mailPatch', id, folder })
  }
  sendMail = () => {
    const s = this.state, c = s.compose
    if (!c || (!s.mailDraft.trim() && !s.mailFiles.length)) return
    const draft = { compose: c, mailDraft: s.mailDraft, mailFiles: s.mailFiles }
    this.set(NO_DRAFT)
    this.act({ type: 'mail', mode: c.mode, ref: s.mailSel, to: c.to, subject: c.subject, text: s.mailDraft, files: s.mailFiles }).catch(() => this.set(draft))
  }

  // ---------- Teams ----------
  sendChat = () => {
    const { chan, chatDraft, chatFiles } = this.state
    if (!chatDraft.trim() && !chatFiles.length) return
    this.set({ chatDraft: '', chatFiles: [] })
    this.act({ type: 'chat', chan, text: chatDraft, files: chatFiles }).catch(() => this.set({ chatDraft, chatFiles }))
  }

  // ---------- VS Code ----------
  private async load(path: string) {
    const { text } = await this.call('/file?path=' + encodeURIComponent(path))
    this.set(s => ({ buffers: { ...s.buffers, [path]: { text, saved: text } } }))
  }
  openFile = async (path: string) => {
    this.set(s => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path], codeFile: path, diff: null }))
    this.dive('code')
    this.mark('file:' + path)
    if (!this.state.buffers[path]) await this.load(path).catch(() => this.closeFile(path))
  }
  openCode = async (path?: string) => { this.open('code'); if (path && this.state.files.includes(path)) await this.openFile(path) }
  closeFile = (path: string) => this.set(s => {
    const tabs = s.tabs.filter(p => p !== path), { [path]: _gone, ...buffers } = s.buffers
    return { tabs, buffers, codeFile: s.codeFile === path ? tabs.at(-1) ?? '' : s.codeFile }
  })
  edit = (path: string, text: string) => {
    this.set(s => (s.buffers[path] ? { buffers: { ...s.buffers, [path]: { ...s.buffers[path], text } } } : null))
    // A phone has no ⌘S, so edits save themselves once the typing pauses.
    if (phone()) { clearTimeout(this.saver); this.saver = setTimeout(() => void this.save(path).catch(() => {}), 800) }
  }
  /** Explorer or source control. On a phone, tapping the one already showing goes back to the editor, as in VS Code. */
  sidebar = (side: View['side']) => this.set(s => ({ side, deep: { ...s.deep, code: s.side === side && !s.deep.code } }))
  save = async (path = this.state.codeFile) => {
    const b = this.state.buffers[path]
    if (!b || b.text === b.saved) return
    await this.call('/file', { method: 'PUT', body: JSON.stringify({ path, text: b.text }) })
    this.set(s => ({ buffers: { ...s.buffers, [path]: { text: s.buffers[path].text, saved: b.text } } }))
  }
  newFile = async (path: string) => {
    await this.call('/file', { method: 'PUT', body: JSON.stringify({ path, text: '' }) })
    await this.openFile(path)
  }
  showDiff = async (path: string) => {
    const head = (await this.call(`/file?rev=HEAD&path=${encodeURIComponent(path)}`)).text
    if (!this.state.buffers[path] && this.state.files.includes(path)) await this.load(path)
    this.set({ diff: { path, head }, codeFile: path })
    this.dive('code')
  }
  /** Saves whatever is unsaved first, so a command never runs against stale files. */
  exec = async (cmd: string) => {
    const s = this.state
    // Tests count towards the guide once there is something of yours to test.
    if (TEST.test(cmd) && (s.code.changes.length || !s.deploys.some(d => d.sha === s.code.head))) this.mark('tested@' + s.deploys.length)
    this.open('code')
    this.dive('code')
    await Promise.all(this.state.tabs.map(p => this.save(p))).catch(() => {})
    await this.act({ type: 'exec', cmd }).catch(() => {})
  }
  commit = async (message: string) => {
    await Promise.all(this.state.tabs.map(p => this.save(p))).catch(() => {})
    await this.act({ type: 'commit', message }).catch(() => {})
  }
  stop = () => void this.act({ type: 'kill' })

  // ---------- Jira, Confluence ----------
  saveTicket = (id: string | undefined, p: Partial<Pick<Ticket, 'title' | 'desc' | 'status' | 'who'>> & { pri?: Priority }) => this.act({ type: 'ticket', id, ...p }).then(r => { if (!id) this.set({ ticketSel: r.id }) }).catch(() => {})
  comment = (id: string, text: string) => this.act({ type: 'comment', id, text }).catch(() => {})
  saveDoc = (id: string | undefined, d: Pick<Doc, 'title' | 'group' | 'body'>) => this.act({ type: 'doc', id, ...d }).then(r => { this.set({ docPage: r.id }); return true }).catch(() => false)
  seen = (what: string) => { if (this.state.id) void this.act({ type: 'seen', what }).catch(() => {}) }
}

export const sim = new Store()
export const wallpaperName = new URLSearchParams(location.search).get('wallpaper') ?? 'Dusk'
// Leaving the page is not an error: close the stream first so it is not mistaken for one.
addEventListener('pagehide', () => sim.leave())

/** Subscribe to a slice of the shift. Select existing state, not freshly built objects. */
export function useSim<T>(select: (s: State) => T): T {
  return useSyncExternalStore(sim.subscribe, () => select(sim.state))
}
/** Switches theme with a native cross-fade where the browser supports it. */
export function setTheme(theme: Theme) {
  const apply = () => flushSync(() => sim.set({ theme }))
  if (document.startViewTransition) document.startViewTransition(apply)
  else apply()
}
export const setLevel = (level: Level) => sim.set({ level })
export { APP_NAMES }
