// The shift itself: a clock, a queue of scripted events, and the player's actions.
// Framework-free so it can be driven from React (store.ts) or from node (check.ts).
import {
  CHANS, DEMO, HINT, INITIAL_TERM, LIVE, PEOPLE, START, START_METERS, clock, dur,
  initialChats, initialEmails, initialTickets,
} from './data.ts'
import type {
  AppId, Attachment, ChanId, ChatMsg, Email, FileId, Flags, Folder, MeterId, PersonId, SimState, TermLine, Toast, Tone, Win,
} from './data.ts'
import type { DocId } from './docs.ts'

const NO_DRAFT = { compose: null, mailDraft: '', mailFiles: [] as Attachment[] }

type Patch = Partial<SimState> | null

const win = (x: number, y: number, w: number, h: number, open: boolean, z: number): Win => ({ open, min: false, max: false, x, y, w, h, z })

export function fresh(): SimState {
  return {
    stage: 'onboard', level: 'bootcamp', theme: 'light', simMin: START, phase: 'calm',
    meters: { ...START_METERS }, flash: {},
    wins: { mail: win(60, 44, 1060, 620, true, 3), docs: win(180, 52, 1000, 640, false, 1), chat: win(260, 70, 820, 560, false, 1), code: win(110, 50, 1040, 640, false, 1), tracker: win(160, 60, 960, 560, false, 1), monitor: win(200, 44, 1020, 660, false, 1) },
    topZ: 3, focus: 'mail', toasts: [], desk: { W: 1280, H: 760 },
    emails: initialEmails(), mailFolder: 'inbox', mailSel: 'e1', mailDraft: '', mailFiles: [], compose: null,
    chats: initialChats(), chan: 'team', chatDraft: '', chatFiles: [], typing: null, unreadChat: { team: 0, incidents: 0, priya: 0, daniel: 0, leo: 1 },
    tickets: initialTickets(), ticketSel: 'LED-214', trackerNew: 0, monitorSeen: true, docPage: 'home',
    codeFile: 'vs', codeStage: 'draft', term: INITIAL_TERM, testsBusy: false, deployBusy: false,
    timeline: [{ time: '12:02 PM', text: 'Deploy billing-api@e0c3a18 (Daniel)', tone: 'dim' }],
    f: {},
  }
}

/** 401 error rate (%) on auth-api at sim minute m. Noisy baseline, spikes after the deploy, decays on recovery. */
export function errAt(f: Flags, m: number) {
  let v = 0.45 + 0.22 * Math.sin(m * 1.7) + 0.12 * Math.sin(m * 0.6)
  if (f.deploy !== undefined && m > f.deploy) {
    let k = Math.min(1, (m - f.deploy) / 2.2)
    if (f.resolved !== undefined && m >= f.resolved - 1) k *= Math.max(0, 1 - (m - f.resolved + 1) / 2)
    v += k * (37 + 1.6 * Math.sin(m * 2.3))
  }
  return Math.max(0.1, v)
}
export function lockedAt(f: Flags, m: number) {
  return f.deploy === undefined ? 0 : Math.max(0, Math.min(1340, Math.round(46 * (m - f.deploy - 1))))
}
/** Where a window actually sits once clamped to the desktop. */
export function winRect(w: Win, D: { W: number; H: number }) {
  if (w.max) return { left: 6, top: 32, width: D.W - 12, height: D.H - 32 - 90 }
  const width = Math.min(w.w, D.W - 20), height = Math.min(w.h, D.H - 110)
  return { left: Math.max(10 - width + 80, Math.min(w.x, D.W - 80)), top: Math.max(26, Math.min(w.y, D.H - 110)), width, height }
}

export class Sim {
  state = fresh()
  /** Sim minutes per real second. */
  speed = 1
  /** Multiplier on scripted real-time delays (typing, terminal output). The self-check shrinks it. */
  timeScale = 1
  private subs = new Set<() => void>()
  private q: { at: number; fn: () => void }[] = []
  private timers: ReturnType<typeof setTimeout>[] = []
  private iv: ReturnType<typeof setInterval> | undefined
  private uid = 100
  private danielWarned = false

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  set(p: Patch | ((s: SimState) => Patch)) {
    const patch = typeof p === 'function' ? p(this.state) : p
    if (!patch) return
    this.state = { ...this.state, ...patch }
    this.subs.forEach(fn => fn())
  }
  private setF(o: Flags) { this.set(s => ({ f: { ...s.f, ...o } })) }
  private later(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms * this.timeScale)) }
  private at(delta: number, fn: () => void) { this.q.push({ at: this.state.simMin + delta, fn }) }
  private stop() { clearInterval(this.iv); this.timers.forEach(clearTimeout); this.timers = []; this.q = [] }

  // ---------- sim control ----------
  start = () => {
    this.stop()
    this.danielWarned = false
    const { level, theme, desk } = this.state
    this.set({ ...fresh(), level, theme, desk, stage: 'sim' })
    this.startClock()
    this.later(900, () => this.toast({ app: 'mail', title: 'Priya Raman', body: 'LED-214: SSO users logged out after ~1 hour', go: () => this.openMail('e1') }))
    this.at(1, () => { this.danielWarned = true; this.post('team', 'daniel', '@maya saw Priya gave you LED-214. Heads up: verifySession is shared by every login path (SSO, password, API keys). Whatever you change in there, check the password flow too. I’m in reviews till ~2:30.', { files: [{ kind: 'code', file: 'vs' }, { kind: 'doc', doc: 'auth' }] }) })
    this.at(3, () => { this.setF({ leoAsked: true, leoAskedAt: this.state.simMin }); this.post('leo', 'leo', 'hey Maya, sorry to bug you. how do I run just the auth tests? the full suite takes 9 minutes on my laptop') })
    this.at(22, () => { if (this.state.phase === 'calm') this.post('priya', 'priya', 'How’s LED-214 looking? Ideally it’s out before 2:30 so we have buffer for the demo.') })
    this.at(45, () => { if (this.state.phase === 'calm') { this.post('priya', 'priya', 'Any update on LED-214? Sam is asking.'); this.bump('trust', -3) } })
  }
  startClock() { clearInterval(this.iv); this.iv = setInterval(this.tick, 1000 / this.speed) }
  tick = () => {
    if (this.state.stage !== 'sim') return
    this.set(s => ({ simMin: s.simMin + 1 }))
    const s = this.state, m = s.simMin
    const due = this.q.filter(e => e.at <= m)
    this.q = this.q.filter(e => e.at > m)
    due.forEach(e => e.fn())
    if (LIVE.includes(s.phase)) {
      const d = m - s.f.incident!
      if (d > 0 && d % 5 === 0) { this.bump('trust', -1); this.bump('rel', -1) }
      if (m === DEMO) this.demoHit()
    }
  }
  bump(k: MeterId, d: number) {
    const id = ++this.uid
    this.set(s => ({ meters: { ...s.meters, [k]: Math.max(0, Math.min(100, s.meters[k] + d)) }, flash: { ...s.flash, [k]: { d: (s.flash[k]?.d ?? 0) + d, id } } }))
    this.later(2800, () => this.set(s => (s.flash[k]?.id === id ? { flash: { ...s.flash, [k]: null } } : null)))
  }
  endShift = () => { clearInterval(this.iv); this.set({ stage: 'debrief' }) }
  replay = () => { this.stop(); const { level, theme, desk } = this.state; this.set({ ...fresh(), level, theme, desk }) }

  // ---------- messaging ----------
  private chatVisible(s: SimState, chan: ChanId) { return s.stage === 'sim' && s.wins.chat.open && !s.wins.chat.min && s.chan === chan }
  post(chan: ChanId, who: PersonId, text: string, extra: Partial<ChatMsg> = {}) {
    const id = ++this.uid
    this.set(s => {
      const msg: ChatMsg = { id, who, text, time: clock(s.simMin), ...extra }
      const upd: Patch = { chats: { ...s.chats, [chan]: [...s.chats[chan], msg] } }
      if (who !== 'maya' && !this.chatVisible(s, chan)) upd.unreadChat = { ...s.unreadChat, [chan]: (s.unreadChat[chan] || 0) + 1 }
      return upd
    })
    this.markRead()
    const s = this.state
    if (who !== 'maya' && !(this.chatVisible(s, chan) && s.focus === 'chat')) {
      this.toast({ app: 'chat', title: PEOPLE[who].name + (CHANS[chan].dm ? '' : ' in ' + CHANS[chan].label), body: text, go: () => this.openChat(chan) })
    }
  }
  private say(chan: ChanId, who: PersonId, text: string, ms = 2200) {
    this.set({ typing: { chan, who } })
    this.later(ms, () => { this.set({ typing: null }); this.post(chan, who, text) })
  }
  private markRead() {
    const s = this.state
    if (this.danielWarned && s.f.readTeam === undefined && this.chatVisible(s, 'team')) this.setF({ readTeam: s.simMin })
  }
  toast(t: Omit<Toast, 'id'>) {
    const id = ++this.uid
    this.set(s => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }))
    this.later(6500, () => this.dismissToast(id))
  }
  dismissToast = (id: number) => this.set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }))
  private mail(e: Pick<Email, 'who' | 'subject' | 'body'> & Partial<Email>) {
    const id = 'm' + ++this.uid
    const em: Email = { id, read: false, thread: [], files: [], time: clock(this.state.simMin), folder: 'inbox', ...e }
    this.set(s => ({ emails: [em, ...s.emails] }))
    this.toast({ app: 'mail', title: PEOPLE[e.who].name, body: e.subject, go: () => this.openMail(id) })
  }
  private timeline(text: string, tone: Tone = 'out') { this.set(s => ({ timeline: [...s.timeline, { time: clock(s.simMin), text, tone }] })) }

  // ---------- windows ----------
  /** Lay the windows out for the measured desktop. */
  fit(W: number, H: number) {
    const d: Record<AppId, [number, number, number, number]> = { mail: [0.04, 44, 1060, 620], docs: [0.12, 52, 1000, 640], chat: [0.3, 64, 820, 560], code: [0.08, 48, 1040, 640], tracker: [0.14, 58, 960, 560], monitor: [0.17, 42, 1020, 660] }
    this.set(s => {
      const wins = { ...s.wins }
      for (const k of Object.keys(d) as AppId[]) {
        const [px, y, w0, h0] = d[k], w = Math.min(w0, W - 40), h = Math.min(h0, H - 130)
        wins[k] = { ...s.wins[k], x: Math.max(10, Math.min(Math.round(W * px), W - w - 10)), y, w, h }
      }
      return { wins, desk: { W, H } }
    })
  }
  setDesk(W: number, H: number) { if (W !== this.state.desk.W || H !== this.state.desk.H) this.set({ desk: { W, H } }) }
  open = (app: AppId) => {
    this.set(s => {
      const z = s.topZ + 1
      const upd: Patch = { wins: { ...s.wins, [app]: { ...s.wins[app], open: true, min: false, z } }, topZ: z, focus: app }
      if (app === 'tracker') upd.trackerNew = 0
      if (app === 'monitor') upd.monitorSeen = true
      if (app === 'chat') upd.unreadChat = { ...s.unreadChat, [s.chan]: 0 }
      return upd
    })
    this.markRead()
  }
  focusWin = (app: AppId) => { const s = this.state; if (s.focus === app && s.wins[app].z === s.topZ) return; this.open(app) }
  private patchWin(app: AppId, p: Partial<Win>, blur = false) { this.set(s => ({ wins: { ...s.wins, [app]: { ...s.wins[app], ...p } }, focus: blur && s.focus === app ? null : s.focus })) }
  closeWin = (app: AppId) => this.patchWin(app, { open: false, max: false }, true)
  minWin = (app: AppId) => this.patchWin(app, { min: true }, true)
  maxWin = (app: AppId) => this.patchWin(app, { max: !this.state.wins[app].max })
  moveWin = (app: AppId, p: Partial<Pick<Win, 'x' | 'y' | 'w' | 'h'>>) => this.patchWin(app, p)

  openMail = (id: string) => {
    const em = this.state.emails.find(e => e.id === id)
    this.set(s => ({ mailSel: id, mailFolder: em ? em.folder : s.mailFolder, ...NO_DRAFT, emails: s.emails.map(e => (e.id === id ? { ...e, read: true } : e)) }))
    this.open('mail')
  }
  openChat = (chan: ChanId) => { this.set(s => ({ chan, unreadChat: { ...s.unreadChat, [chan]: 0 } })); this.open('chat') }
  openCode = (file: FileId = 'vs') => { this.pickFile(file); this.open('code') }
  openTicket = (id: string) => { if (this.state.tickets.some(t => t.id === id)) this.set({ ticketSel: id }); this.open('tracker') }
  pickFile = (k: FileId) => { this.set({ codeFile: k }); if (k === 'pw' && this.state.f.viewPwd === undefined) this.setF({ viewPwd: this.state.simMin }) }
  openDoc = (id: DocId) => { this.set({ docPage: id }); this.open('docs') }
  /** Opens an attachment in the app it belongs to. Uploads live outside the sim; the UI opens those. */
  openAttachment = (a: Attachment) => {
    if (a.kind === 'code') this.openCode(a.file)
    else if (a.kind === 'doc') this.openDoc(a.doc)
    else if (a.kind === 'ticket') this.openTicket(a.id)
    else if (a.kind === 'link') a.chan ? this.openChat(a.chan) : this.open(a.app)
  }
  startTicket = () => this.set(s => ({ tickets: s.tickets.map(t => (t.id === 'LED-214' ? { ...t, status: 'progress' } : t)) }))

  // ---------- code / deploy ----------
  private termSeq(lines: TermLine[], gap: number, done: () => void) {
    lines.forEach((l, i) => this.later(gap * (i + 1), () => this.set(s => ({ term: [...s.term, l] }))))
    this.later(gap * (lines.length + 1), done)
  }
  runTests = () => {
    const s = this.state
    if (s.testsBusy || s.codeStage !== 'draft') return
    this.set({ testsBusy: true })
    this.termSeq([{ c: 'cmd', t: 'npm test -- src/auth' }, { c: 'ok', t: ' PASS  src/auth/verifySession.test.ts' }, { c: 'out', t: '   ✓ accepts a valid bearer token (4 ms)' }, { c: 'out', t: '   ✓ rejects an expired bearer token (2 ms)' }, { c: 'out', t: '   ✓ allows 60s clock skew on SSO refresh (3 ms)' }, { c: 'out', t: '   ✓ rejects a missing token (1 ms)' }, { c: 'ok', t: ' PASS  src/sso/refresh.test.ts (14 tests)' }, { c: 'ok', t: 'Tests: 18 passed, 18 total · Time: 2.31 s' }], 260, () => {
      this.set({ testsBusy: false })
      if (this.state.f.ranTests === undefined) this.setF({ ranTests: this.state.simMin })
    })
  }
  deploy = () => {
    const s = this.state
    if (s.codeStage !== 'draft' || s.deployBusy || s.testsBusy) return
    this.set({ deployBusy: true })
    this.termSeq([{ c: 'cmd', t: 'git commit -am "fix(auth): read session token from Authorization header (LED-214)"' }, { c: 'out', t: '[maya/led-214-sso-expiry a41f9c2] 1 file changed, 4 insertions(+), 2 deletions(-)' }, { c: 'cmd', t: 'ldg deploy auth-api --env prod' }, { c: 'dim', t: '→ building auth-api@a41f9c2 … done (14s)' }, { c: 'dim', t: '→ rolling out 6/6 pods … done' }, { c: 'ok', t: '✓ auth-api@a41f9c2 is live in prod' }], 420, () => {
      const m = this.state.simMin
      this.set(st => ({ deployBusy: false, codeStage: 'deployed', phase: 'deployed', tickets: st.tickets.map(t => (t.id === 'LED-214' ? { ...t, status: 'done' } : t)) }))
      this.setF({ deploy: m })
      this.timeline('Deploy auth-api@a41f9c2 (Maya)', 'accent')
      this.post('incidents', 'cloudwatch', 'Deploy · auth-api@a41f9c2 by maya.chen · 6/6 pods healthy', { alert: 'info' })
      this.later(2500, () => this.say('priya', 'priya', 'Saw LED-214 go out. Nice, thanks Maya.', 1800))
      this.at(2, this.startIncident)
    })
  }
  private startIncident = () => {
    if (this.state.phase !== 'deployed') return
    const m = this.state.simMin, dep = this.state.f.deploy!
    this.set(s => ({ phase: 'incident', monitorSeen: false, trackerNew: 1, tickets: [{ id: 'INC-37', title: 'Password logins failing on auth-api', status: 'progress', who: 'maya', pri: 'Urgent', pts: null, desc: 'CloudWatch alarm: 401 rate on auth-api above 5% since ' + clock(m) + '. Opened automatically and assigned to the author of the latest deploy.' }, ...s.tickets] }))
    this.setF({ incident: m })
    this.bump('rel', -8)
    this.post('incidents', 'cloudwatch', '[FIRING] auth-api · 401 rate 38.2% (threshold 5%) · top reason: missing_token', { alert: 'fire', files: [{ kind: 'link', label: 'auth-api · prod dashboard', app: 'monitor' }] })
    this.mail({ who: 'cloudwatch', folder: 'alerts', subject: '[FIRING] auth-api: 401 rate 38.2% (threshold 5%)', body: ['Alarm: auth-api 401 rate above 5% for 2 minutes.', 'Current: 38.2% · Baseline: 0.4%', 'Top reason: missing_token (97% of failures)', 'Most recent deploy: auth-api@a41f9c2 by maya.chen at ' + clock(dep)], files: [{ kind: 'link', label: 'auth-api · prod dashboard', app: 'monitor' }, { kind: 'doc', doc: 'incident' }] })
    this.timeline('Alarm fired: 401 rate > 5%', 'bad')
    const live = () => LIVE.includes(this.state.phase), undecided = () => this.state.phase === 'incident'
    this.at(2, () => { if (live()) this.post('team', 'leo', 'is anyone else getting bounced back to the login page? email + password, prod') })
    this.at(3, () => { if (live() && this.state.f.ack === undefined) this.post('priya', 'priya', 'Maya, login errors are spiking and it lines up with your ' + clock(dep) + ' deploy. Are you on it?') })
    this.at(6, () => { if (live()) this.mail({ who: 'hana', subject: 'Spike in “can’t log in” tickets', kind: 'support', body: ['Hi eng,', 'We’ve had 31 tickets in the last 10 minutes, all the same: email + password users sign in, then get bounced straight back to the login page. SSO customers seem fine.', 'Osprey and Brightline have both called. Anything I can tell them?', 'Hana · Support'] }) })
    this.at(8, () => { if (live() && this.state.f.ack === undefined) { this.post('priya', 'priya', 'I need a status, even if it’s just “looking”.'); this.bump('trust', -5) } })
    this.at(9, () => {
      if (!live()) return
      this.setF({ clientMailAt: this.state.simMin })
      this.mail({ who: 'marta', subject: 'Our team can’t log in, and the demo is at 3:00', kind: 'client', toName: 'Ledgerly Support; Sam Whitfield', body: ['Hello,', 'Since about ' + clock(dep + 1) + ', none of our finance contractors can get into Ledgerly. They enter their password and land back on the sign-in page. They’re the people I’m showing the new invoice run to at 3:00.', 'This is exactly the kind of reliability issue we’re weighing in the renewal. Can someone tell me what’s happening?', 'Marta Lindqvist', 'Head of Finance Ops, Northwind Freight'] })
    })
    this.at(HINT[this.state.level] || 10, () => { if (undecided()) this.post('daniel', 'daniel', 'Out of my review for two minutes. Password login only ever sets ldg_session as a cookie. Nothing on that path sends an Authorization header. Whatever you do, do it before 3.') })
    this.at(15, () => { if (undecided()) this.post('incidents', 'priya', '@maya Northwind demo is in ' + dur(DEMO - this.state.simMin) + '. Revert or patch? I need to know which.') })
    this.at(18, () => { if (live()) { this.mail({ who: 'sam', subject: 'Do we postpone Northwind?', kind: 'sam', body: ['Priya looped me in. Marta just emailed me directly too.', 'If logins aren’t back by 2:45 I’ll have to call her and move the demo, which won’t help the renewal. What’s your read?', 'Sam'] }); this.bump('trust', -3) } })
  }
  revert = () => {
    if (this.state.phase !== 'incident') return
    this.set({ phase: 'recovering', codeStage: 'reverted', codeFile: 'vs' })
    this.setF({ choice: 'revert', choiceAt: this.state.simMin })
    this.timeline('Rollback to auth-api@7c19e02 started (Maya)', 'accent')
    this.post('incidents', 'cloudwatch', 'Rollback · auth-api → 7c19e02 by maya.chen', { alert: 'info' })
    this.termSeq([{ c: 'cmd', t: 'ldg rollback auth-api --to 7c19e02' }, { c: 'dim', t: '→ rolling back 6/6 pods …' }, { c: 'ok', t: '✓ auth-api@7c19e02 is live in prod (rollback)' }], 500, () => {})
    this.at(3, this.resolve)
  }
  patch = () => {
    if (this.state.phase !== 'incident') return
    this.set({ phase: 'patching', codeStage: 'patched', codeFile: 'vs' })
    this.setF({ choice: 'patch', choiceAt: this.state.simMin })
    this.timeline('Patch forward started: cookie fallback (Maya)', 'accent')
    this.termSeq([{ c: 'cmd', t: 'git commit -am "fix(auth): fall back to session cookie when no bearer header"' }, { c: 'cmd', t: 'npm test -- src/auth' }, { c: 'ok', t: 'Tests: 18 passed, 18 total' }, { c: 'cmd', t: 'ldg deploy auth-api --env prod' }, { c: 'dim', t: '→ building auth-api@c83d1b7 … done (15s)' }, { c: 'dim', t: '→ rolling out 6/6 pods … done' }, { c: 'ok', t: '✓ auth-api@c83d1b7 is live in prod' }], 450, () => {})
    this.at(6, this.resolve)
  }
  private resolve = () => {
    const s = this.state
    if (s.phase === 'resolved') return
    const m = s.simMin, choice = s.f.choice
    this.set(st => ({ phase: 'resolved', tickets: st.tickets.map(t => (t.id === 'INC-37' ? { ...t, status: 'done' } : t.id === 'LED-214' ? { ...t, status: choice === 'revert' ? 'progress' : 'done', reopened: choice === 'revert' } : t)) }))
    this.setF({ resolved: m })
    this.bump('rel', choice === 'revert' ? 7 : 4)
    this.post('incidents', 'cloudwatch', '[RESOLVED] auth-api · 401 rate back to 0.6% · duration ' + (m - s.f.incident!) + ' min', { alert: 'ok' })
    this.timeline('Resolved: 401 rate 0.6%', 'good')
    this.at(1, () => {
      this.post('priya', 'priya', 'We’re back. Thank you. Before you log off, send me a short postmortem: what happened, why, what we change. Blameless, keep it short.')
      this.mail({ who: 'priya', subject: 'Postmortem: auth-api password logins', kind: 'pm', files: [{ kind: 'doc', doc: 'postmortem' }], body: ['Hi Maya,', 'Thanks for getting us back. Please send a short, blameless postmortem before you log off: what happened, impact, why, how we fixed it, and what we’ll change. Replying here is fine.', 'Priya'] })
      this.post('team', 'leo', 'password login works again for me')
    })
    this.at(2, () => this.post('daniel', 'daniel', choice === 'revert' ? 'Good call rolling back first. We’ll work out the header change together tomorrow, with a test for the password path.' : 'You patched forward during an incident. It worked, but that was new, untested code going to prod with a client demo on the line. Rollback is one command. Let’s talk tomorrow.'))
    if (m < DEMO && !s.f.demoHit) this.at(3, () => { this.mail({ who: 'sam', subject: 'Northwind demo is on', body: ['Marta says her team is back in. Demo goes ahead at 3:00. Thanks for moving fast.', 'Sam'] }); this.bump('trust', 3) })
  }
  private demoHit() {
    if (this.state.f.demoHit) return
    this.setF({ demoHit: true }); this.bump('trust', -10); this.bump('rep', -4)
    this.timeline('Northwind demo postponed', 'bad')
    this.mail({ who: 'sam', subject: 'Northwind demo postponed', body: ['I called Marta and moved the demo to Thursday. She was polite about it, but she asked for a written explanation for their CFO.', 'Sam'] })
  }

  // ---------- replies ----------
  sendChat = (preset?: string) => {
    const text = (preset ?? this.state.chatDraft).trim(), files = this.state.chatFiles
    if (!text && !files.length) return
    const chan = this.state.chan
    this.set({ chatDraft: '', chatFiles: [] }); this.post(chan, 'maya', text, { files }); this.respond(chan, text)
  }
  private respond(chan: ChanId, text: string) {
    const s = this.state, f = s.f, live = LIVE.includes(s.phase), m = s.simMin
    if (chan === 'leo') {
      if (f.leoAsked && !f.leo) {
        const defer = /later|busy|after|swamped|not now/i.test(text)
        this.setF({ leo: defer ? 'deferred' : 'helped', leoAt: m })
        if (!defer) this.bump('rep', 5)
        this.say('leo', 'leo', defer ? 'no worries, I’ll poke around the jest config' : 'oh that’s so much faster. thank you!! owe you a coffee')
      } else this.say('leo', 'leo', live ? 'want me to keep an eye on support tickets while you fix it?' : 'nice, thanks')
    } else if (chan === 'incidents' || chan === 'priya') {
      if (live && f.ack === undefined) { this.setF({ ack: m, ackText: text }); this.bump('trust', 3); this.timeline('Acknowledged by Maya', 'accent'); this.say(chan, 'priya', 'Thanks for owning it. Post updates in #incidents every 10 minutes. Revert or patch is your call, but tell me which before you do it.', 2600) }
      else if (live) this.say(chan, 'priya', s.phase === 'incident' ? 'Ok. Keep going.' : 'Ok. Tell me when it’s green.')
      else if (s.phase === 'resolved') this.say(chan, 'priya', 'Thanks. Postmortem in my inbox when you can.')
      else if (chan === 'priya') this.say(chan, 'priya', 'Sounds good.')
    } else if (chan === 'daniel') {
      if (live && !f.danielAsked) { this.setF({ danielAsked: m }); this.say('daniel', 'daniel', 'Between sessions. What changed in how verifySession gets the token? Compare that with what each login path actually sends.', 3000) }
      else if (live) this.say('daniel', 'daniel', 'Your call. Whatever you pick, tell Priya first.')
      else if (s.phase === 'resolved') this.say('daniel', 'daniel', 'Good. Let’s pair on tests for the password path tomorrow.')
      else { if (!f.danielAsked) this.setF({ danielAsked: m }); this.say('daniel', 'daniel', 'In a review until ~2:30. Write it down here and I’ll read it between sessions.', 3200) }
    }
  }
  // Mail you write. A reply answers the open message; a new message to someone answers their latest unanswered scenario mail.
  reply = () => { this.patchMail(this.state.mailSel, { read: true }); this.set({ compose: { mode: 'reply', to: '', subject: '' }, mailDraft: '', mailFiles: [] }) }
  newMail = () => { this.set({ compose: { mode: 'new', to: '', subject: '' }, mailDraft: '', mailFiles: [] }); this.open('mail') }
  forward = () => {
    const em = this.state.emails.find(e => e.id === this.state.mailSel)
    if (em) this.set(s => ({ compose: { mode: 'forward', to: '', subject: 'Fw: ' + em.subject }, mailDraft: '', mailFiles: em.files, emails: s.emails.map(e => (e.id === em.id ? { ...e, read: true } : e)) }))
  }
  discardMail = () => this.set(NO_DRAFT)
  moveMail = (id: string, folder: Folder) => this.set(s => {
    const list = s.emails.filter(e => e.folder === s.mailFolder), i = list.findIndex(e => e.id === id)
    const next = list[i + 1] ?? list[i - 1]
    return { emails: s.emails.map(e => (e.id === id ? { ...e, folder } : e)), mailSel: s.mailSel === id ? next?.id ?? '' : s.mailSel, ...NO_DRAFT }
  })
  patchMail = (id: string, p: Partial<Pick<Email, 'read' | 'flagged'>>) => this.set(s => ({ emails: s.emails.map(e => (e.id === id ? { ...e, ...p } : e)) }))
  sendMail = () => {
    const s = this.state, c = s.compose, text = s.mailDraft.trim(), files = s.mailFiles
    const open = s.emails.find(e => e.id === s.mailSel)
    if (!c || (!text && !files.length) || (c.mode === 'reply' ? !open : !c.to.trim())) return
    const typed = c.to.trim().toLowerCase()
    const to = c.mode === 'reply' ? open!.who : (Object.keys(PEOPLE) as PersonId[]).find(k => PEOPLE[k].name.toLowerCase() === typed || PEOPLE[k].email === typed)
    const em = c.mode === 'reply' ? open : c.mode === 'new' ? s.emails.find(e => e.who === to && e.kind && !e.thread.length) : undefined
    const m = s.simMin, f = s.f
    const body = text.split('\n').filter(Boolean)
    if (c.mode === 'forward' && open) body.push('———  Forwarded message  ———', 'From: ' + PEOPLE[open.who].name + ' · ' + open.time, ...open.body)
    const sent: Email = { id: 's' + ++this.uid, folder: 'sent', who: 'maya', toName: to ? PEOPLE[to].name : c.to.trim(), subject: c.mode === 'reply' ? 'Re: ' + open!.subject : c.subject.trim() || '(No subject)', time: clock(m), read: true, body, files, thread: [] }
    this.set(st => ({ ...NO_DRAFT, emails: [sent, ...st.emails.map(e => (e.id === em?.id ? { ...e, thread: [...e.thread, { time: clock(m), text, files }] } : e))] }))
    if (!em) return
    if (em.kind === 'assign' && f.assignAck === undefined) { this.setF({ assignAck: m }); this.bump('trust', 2); this.say('priya', 'priya', 'Thanks Maya. Shout if you get stuck, and loop Daniel in early on anything auth.', 3000) }
    if (em.kind === 'client' && f.client === undefined) {
      this.setF({ client: m, clientText: text }); this.bump('trust', 6); this.bump('rep', 2); this.timeline('Client update sent to Northwind (Maya)', 'accent')
      this.at(2, () => this.post('priya', 'priya', 'Saw your note to Marta. Clear and honest. Thank you.'))
      this.at(4, () => this.mail({ who: 'marta', subject: 'Re: Our team can’t log in', body: this.state.phase === 'resolved' ? ['Confirmed, the team is back in. Thank you for writing to me directly.', 'Marta'] : ['Thank you, Maya. That’s the first clear answer I’ve had. Please let me know as soon as they can get in.', 'Marta'] }))
    }
    if (em.kind === 'support' && f.support === undefined) { this.setF({ support: m }); this.bump('rep', 3) }
    if (em.kind === 'sam' && f.samReply === undefined) { this.setF({ samReply: m }); this.bump('trust', 1) }
    if (em.kind === 'pm' && f.pm === undefined) { this.setF({ pm: m, pmText: text }); this.bump('trust', 4); this.say('priya', 'priya', 'Got it. This is a good postmortem. We’ll go through the action items at standup tomorrow.', 3000) }
  }
}
