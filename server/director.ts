// Runs the shift: the clock, the things that happen on schedule, and what follows from what the player does.
// No model calls here. The director decides what is true; personas and the mentor decide how to say it.
import { clientOf } from '../shared/scenario.ts'
import { COLS, clock, errAt, failing, firstName, isOutage, minutes, personByName, shortDay, shortName } from '../shared/types.ts'
import type { Attachment, ChanId, Check, Doc, Email, Folder, PersonId, TermLine, Ticket } from '../shared/types.ts'
import * as mentor from './ai/mentor.ts'
import { reply } from './ai/personas.ts'
import { Refusal, tokenize } from './sandbox.ts'
import type { Emit } from './sandbox.ts'
import * as triggers from './triggers.ts'
import type { Beat, Session } from './world.ts'

/** The browser gets the checks customers can feel. Security verdicts stay on the server. */
const visible = (s: Session, checks: Check[]) => checks.filter(c => (s.scenario.checks.find(x => x.id === c.id)?.share ?? 0) > 0)
const label = (s: Session, id: string) => s.scenario.checks.find(c => c.id === id)!.label
const accept = (s: Session) => s.ws.accept(s.scenario.checks.map(c => c.id))
const player = (s: Session) => firstName(s.world.cast[s.world.player])
/** A colleague's first name, by cast id, so a renamed cast reads right. */
const call = (s: Session, who: PersonId) => firstName(s.world.cast[who])
const open = (s: Session) => !!s.world.incident && s.world.incident.resolvedAt === null
const dashboard: Attachment = { kind: 'link', label: 'auth-api · prod dashboard', app: 'monitor' }
const wait = (s: Session, ms: number) => new Promise(r => setTimeout(r, ms * s.timeScale))

// ---------- start, clock ----------
export async function start(s: Session) {
  // The shift has only the template so far, whose verdict is known without starting a sandbox for it.
  const [state, base] = [await s.ws.state(), await s.ws.acceptTemplate(s.scenario.checks.map(c => c.id))]
  s.priv.verdicts[state.head] = { ...base, diff: '' }
  s.world.term = [{ c: 'dim', t: `Last login: ${shortDay(s.world.calendar.weekday)} ${s.world.calendar.date} 09:14 on ttys002` }, { c: 'dim', t: 'Type "help" to see what is available here.' }]
  s.set({ files: await s.ws.tree(), code: state, deploys: [{ sha: state.head, at: minutes(s.scenario.clock.start) - 300, by: s.scenario.mentor, kind: 'deploy', checks: visible(s, base.checks) }] })
  triggers.schedule(s, s.scenario.triggers, 'start')
  if (s.scenario.clock.deadline) s.priv.beats.push({ at: minutes(s.scenario.clock.deadline), kind: 'demo' })
  s.log('start', { level: s.world.level })
}
/** The clock only runs while someone is watching. */
export function run(s: Session) {
  if (s.clock || s.world.stage !== 'sim' || !s.clients.size) return
  s.clock = setInterval(() => tick(s), 60_000 / s.world.pace)
}
export function pause(s: Session) { clearInterval(s.clock); s.clock = undefined }
export function pace(s: Session, to: number) { s.set({ pace: to }); pause(s); run(s) }

export function tick(s: Session) {
  if (s.world.stage !== 'sim') return
  s.set(w => ({ simMin: w.simMin + 1 }))
  const m = s.world.simMin
  const due = s.priv.beats.filter(b => b.at <= m)
  s.priv.beats = s.priv.beats.filter(b => b.at > m)
  due.forEach(b => beat(s, b))
  // Production follows the code. A rollout takes two minutes to show either way.
  const live = s.world.deploys.at(-1)!
  if (m < live.at + 2) return
  if (!open(s) && isOutage(s.scenario, live.checks) && s.world.incident?.sha !== live.sha) openIncident(s)
  else if (open(s) && !isOutage(s.scenario, live.checks)) resolveIncident(s)
}

// ---------- things that happen on schedule ----------
const shipped = (s: Session) => s.world.deploys.some(d => d.by === s.world.player)
// Beats hold a trigger id, or "demo". Shifts saved before triggers were data used the same names.
function beat(s: Session, b: Beat) {
  if (b.kind === 'demo') return demo(s)
  const t = s.scenario.triggers.find(x => x.id === b.kind)
  if (t) triggers.fire(s, t, b.inc)
}
function demo(s: Session) {
  const held = !open(s)
  s.set({ demo: held ? 'held' : 'postponed' })
  s.log('demo', { held })
  if (held) return
  const { who, subject, body } = s.scenario.story.postponed, v = triggers.vars(s)
  s.timeline(`${shortName(clientOf(s.scenario))} demo postponed`, 'bad')
  s.mail({ who, subject: triggers.render(subject, v), body: body.map(b => triggers.render(b, v)) })
}

// ---------- production ----------
function openIncident(s: Session) {
  const w = s.world, m = w.simMin, live = w.deploys.at(-1)!, v = s.priv.verdicts[live.sha]
  const id = 'INC-' + (37 + w.tickets.filter(t => t.id.startsWith('INC')).length)
  const what = failing(live.checks).filter(c => c !== 'sso_after_refresh').map(c => label(s, c)).join(', ')
  const rate = errAt(s.scenario, w.deploys, m).toFixed(1), alarm = s.scenario.alarmPercent, reason = live.checks.find(c => !c.ok && c.id !== 'sso_after_refresh')?.reason ?? 'rejected'
  const t: Ticket = { id, title: `${what} failing on auth-api`, status: 'progress', who: s.world.player, pri: 'Urgent', pts: null, comments: [], activity: [{ time: s.now, text: 'CloudWatch: created the issue' }], desc: `CloudWatch alarm: 401 rate on auth-api above ${alarm}% since ${clock(m)}. Opened automatically and assigned to the author of the latest deploy, auth-api@${live.sha}.` }
  s.set({ incident: { id, sha: live.sha, startedAt: m, resolvedAt: null, failing: failing(live.checks) }, tickets: [t, ...w.tickets] })
  s.mail({ who: 'jira', folder: 'alerts', subject: `[JIRA] (${id}) assigned to you: ${t.title}`, body: [`CloudWatch assigned ${id} to you.`, t.desc], files: [{ kind: 'ticket', id }] })
  s.post('incidents', 'cloudwatch', `[FIRING] auth-api · 401 rate ${rate}% (threshold ${alarm}%) · top reason: ${reason}`, { alert: 'fire', files: [dashboard] })
  s.mail({ who: 'cloudwatch', folder: 'alerts', subject: `[FIRING] auth-api: 401 rate ${rate}% (threshold ${alarm}%)`, body: [`Alarm: auth-api 401 rate above ${alarm}% for 2 minutes.`, `Current: ${rate}% · Baseline: 0.4%`, `Top reason: ${reason}`, `Most recent deploy: auth-api@${live.sha} by ${s.world.cast[live.by].email.split('@')[0]} at ${clock(live.at)}`], files: [dashboard, { kind: 'doc', doc: 'incident' }] })
  s.timeline(`Alarm fired: 401 rate > ${alarm}%`, 'bad')
  s.log('incident', { id, what })
  triggers.schedule(s, s.scenario.triggers, 'incident.opened', id)
  mentor.onIncident(s, live.sha, v, v.diff)
}

function resolveIncident(s: Session) {
  const w = s.world, m = w.simMin, inc = w.incident!, live = w.deploys.at(-1)!
  s.set({ incident: { ...inc, resolvedAt: m } })
  s.ticket(inc.id, { status: 'done' }, 'cloudwatch', 'resolved: 401 rate back under threshold')
  s.post('incidents', 'cloudwatch', `[RESOLVED] auth-api · 401 rate back to ${errAt(s.scenario, w.deploys, m + 2).toFixed(1)}% · duration ${m - inc.startedAt} min`, { alert: 'ok' })
  s.timeline(`Resolved: 401 rate ${errAt(s.scenario, w.deploys, m + 2).toFixed(1)}%`, 'good')
  s.log('resolved', { id: inc.id, mins: m - inc.startedAt })
  triggers.schedule(s, s.scenario.triggers, 'incident.resolved', inc.id)
  void mentor.onHealthy(s, live.kind === 'rollback' ? 'rollback' : 'fix')
}

async function ldg(s: Session, args: string[], emit: Emit): Promise<number> {
  const say = (t: string, c: TermLine['c'] = 'out') => emit({ c, t })
  const w = s.world, f = s.priv.f, m = w.simMin, live = w.deploys.at(-1)!
  const [sub, service] = args
  if (!sub || sub === 'help') { ['ldg status', 'ldg logs', 'ldg deploy auth-api --env prod', 'ldg rollback auth-api [--to <sha>]'].forEach(l => say(l, 'dim')); return 0 }
  if (service && !service.startsWith('-') && service !== 'auth-api') throw new Refusal(`ldg: you have no changes for ${service}. The service in this repo is auth-api.`)

  if (sub === 'status') {
    say(`auth-api  prod  ${live.sha}  ${live.kind === 'rollback' ? 'rolled back' : 'deployed'} ${clock(live.at)} by ${s.world.cast[live.by].name}  6/6 pods`)
    say(`401 rate  ${errAt(s.scenario, w.deploys, m).toFixed(1)}%  (alarm at ${s.scenario.alarmPercent}%)`, isOutage(s.scenario, live.checks) ? 'err' : 'ok')
    return 0
  }
  if (sub === 'logs') {
    const bad = failing(live.checks)
    const line = (path: string, how: string, ok: boolean, reason = '') => say(`${clock(m)}  auth-api  ${ok ? '200' : '401 ' + reason}  ${path}  auth=${how}`, ok ? 'out' : 'err')
    const why = (id: Check['id']) => live.checks.find(c => c.id === id)?.reason ?? ''
    // Requests from the scenario's own customers, the first three in turn.
    const named = s.scenario.customers.named
    const org = (i: number) => 'GET /invoices org=org_' + (named.length ? shortName(named[i % named.length]).toLowerCase().replace(/[^a-z0-9]/g, '') : 'default')
    line(org(0), 'cookie (password login)', !bad.includes('password_login'), why('password_login'))
    line(org(1), 'cookie (password login)', !bad.includes('password_login'), why('password_login'))
    line(org(0), 'bearer (sso, first hour)', true)
    line(org(2), 'bearer after refresh + expired cookie (sso)', !bad.includes('sso_after_refresh'), why('sso_after_refresh'))
    line(org(1), 'x-api-key', !bad.includes('api_key'), why('api_key'))
    return 0
  }
  if (sub === 'deploy') {
    if (!args.some(a => a === 'prod' || a === '--env=prod')) throw new Refusal('ldg deploy: say where. Usage: ldg deploy auth-api --env prod')
    const st = await s.ws.state()
    if (st.changes.length) { say('error: you have uncommitted changes. Only committed code is deployed.', 'err'); say('  git commit -am "what you changed"', 'dim'); return 1 }
    if (st.head === live.sha) { say(`auth-api@${st.head} is already live in prod. Nothing to deploy.`, 'dim'); return 0 }
    say(`→ building auth-api@${st.head} …`, 'dim')
    const v = { ...(await accept(s)), diff: (await s.ws.git(['diff', live.sha, 'HEAD', '--', 'src'])).out }
    s.priv.verdicts[st.head] = v
    if (v.build === 'broken') {
      say(`✗ build failed: ${v.error}`, 'err'); say('Nothing was deployed. Production is unchanged.', 'dim')
      s.log('build', { sha: st.head, error: v.error })
      mentor.onBuildBroken(s, v.error ?? 'the service did not start')
      return 1
    }
    await wait(s, 900); say('→ build done (14s)', 'dim')
    await wait(s, 900); say('→ rolling out 6/6 pods … done', 'dim')
    say(`✓ auth-api@${st.head} is live in prod`, 'ok')
    const first = !shipped(s), bad = failing(v.checks), holes = bad.filter(c => mentor.security(s).includes(c))
    s.set({ deploys: [...w.deploys, { sha: st.head, at: s.world.simMin, by: s.world.player, kind: 'deploy', checks: visible(s, v.checks) }] })
    s.timeline(`Deploy auth-api@${st.head} (${player(s)})`, 'accent')
    s.post('incidents', 'cloudwatch', `Deploy · auth-api@${st.head} by ${s.world.cast[s.world.player].email.split('@')[0]} · 6/6 pods healthy`, { alert: 'info' })
    s.log('deploy', { sha: st.head, tested: f.testedAt !== undefined && (f.editedAt === undefined || f.testedAt >= f.editedAt), broke: bad.filter(c => c !== 'sso_after_refresh').map(c => label(s, c)).join(', ') })
    if (first) s.later(2500, () => s.say('priya', 'priya', `Saw LED-214 go out. Thanks ${player(s)}. Keep an eye on CloudWatch for a few minutes.`))

    if (!bad.length) {
      f.fixedAt = s.world.simMin
      s.ticket('LED-214', { status: 'done', reopened: false }, 'jira', `released in auth-api@${st.head}`)
      if (!open(s)) void mentor.onHealthy(s, s.priv.attempts ? 'fix' : 'first-time')
    } else if (holes.length && !isOutage(s.scenario, v.checks)) s.later(5000, () => mentor.onSilentHole(s, st.head, v, v.diff))
    else if (!isOutage(s.scenario, v.checks)) s.later(5000, () => mentor.onNoFix(s, st.head, v, v.diff))
    return 0
  }
  if (sub === 'rollback') {
    const to = args[args.indexOf('--to') + 1], wanted = args.includes('--to') ? w.deploys.findLast(d => d.sha.startsWith(to ?? '\0')) : w.deploys.findLast(d => d.sha !== live.sha)
    if (!wanted || wanted.sha === live.sha) { say(args.includes('--to') ? `ldg rollback: no release ${to} in the history` : 'Nothing to roll back to: this is the only release.', 'err'); return 1 }
    say(`→ rolling back 6/6 pods to ${wanted.sha} …`, 'dim')
    await wait(s, 1200)
    say(`✓ auth-api@${wanted.sha} is live in prod (rollback)`, 'ok')
    const hadHole = failing(s.priv.verdicts[live.sha]?.checks ?? []).some(c => mentor.security(s).includes(c))
    f.rolledBackAt = s.world.simMin
    s.set({ deploys: [...w.deploys, { sha: wanted.sha, at: s.world.simMin, by: s.world.player, kind: 'rollback', checks: wanted.checks }] })
    s.timeline(`Rollback to auth-api@${wanted.sha} (${player(s)})`, 'accent')
    s.post('incidents', 'cloudwatch', `Rollback · auth-api → ${wanted.sha} by ${s.world.cast[s.world.player].email.split('@')[0]}`, { alert: 'info' })
    s.log('rollback', { sha: wanted.sha })
    if (s.world.tickets.find(t => t.id === 'LED-214')?.status === 'done') s.ticket('LED-214', { status: 'progress', reopened: true }, 'jira', `reopened: auth-api@${live.sha} was rolled back`)
    if (!open(s) && hadHole) void mentor.onHealthy(s, 'rollback')
    return 0
  }
  throw new Refusal(`ldg ${sub}: unknown command. Try: ldg status, ldg logs, ldg deploy auth-api --env prod, ldg rollback auth-api`)
}

/** Brings the browser's view of the repository up to date, and notices new commits. */
export async function refresh(s: Session) {
  const [state, files] = [await s.ws.state(), await s.ws.tree()]
  const before = s.world.code.head
  s.set({ code: state, files })
  // Saves, commits, branch changes and every command end up here, so this is where the workspace is snapshotted (debounced).
  s.snap()
  if (!before || state.head === before || s.priv.verdicts[state.head]) return
  s.log('commit', { sha: state.head, subject: state.subject })
  // Get ahead: find out now what this commit would do in production, and start on the coaching if it would do harm.
  const live = s.world.deploys.at(-1)!
  // No sandbox to run it in (already logged): deploying works it out instead, and says so if it still cannot.
  const verdict = await accept(s).catch(e => { if (e instanceof Refusal) return null; throw e })
  if (!verdict) return
  const v = { ...verdict, diff: (await s.ws.git(['diff', live.sha, 'HEAD', '--', 'src'])).out }
  if (state.changes.length === 0) s.priv.verdicts[state.head] = v
  if (v.build === 'ok' && failing(v.checks).length) void mentor.prepare(s, state.head, v, v.diff)
}

/** One line typed into the terminal, or sent by a button that types it for you. */
export async function command(s: Session, raw: string) {
  const cmd = raw.trim().slice(0, 500)
  if (!cmd) return
  if (s.world.code.busy) return s.term({ c: 'err', t: 'A command is still running. Stop it first.' })
  const f = s.priv.f, emit: Emit = l => s.term(l)
  s.term({ c: 'cmd', t: cmd })
  s.set(w => ({ code: { ...w.code, busy: cmd.split(/\s+/)[0] } }))
  try {
    const argv = tokenize(cmd)
    if (argv[0] === 'clear') { s.world.term = []; s.send('term', { clear: true, lines: [] }) }
    else if (argv[0] === 'ldg') await ldg(s, argv.slice(1), emit)
    else {
      const code = await s.ws.exec(argv, emit)
      const tested = (argv[0] === 'npm' && /^(test|t|run)$/.test(argv[1] ?? '')) || (argv[0] === 'node' && argv[1] === '--test')
      if (tested) { f.testedAt = s.world.simMin; f.testsPassed = code === 0; s.log('test', { passed: code === 0 }) }
      if (argv[0] === 'cat' && code === 0) argv.slice(1).forEach(a => seen(s, 'file:' + [s.ws.cwd, a].filter(Boolean).join('/')))
    }
  } catch (e) {
    if (e instanceof Refusal) emit({ c: 'err', t: e.message })
    else { console.error('[command]', e); emit({ c: 'err', t: 'Something went wrong running that command.' }) }
  } finally { await refresh(s) }
}
export async function commit(s: Session, message: string) { return command(s, `git commit -am "${message.replace(/["\\]/g, "'").slice(0, 200)}"`) }
export async function saveFile(s: Session, path: string, text: string) {
  await s.ws.write(path, text)
  s.priv.f.editedAt = s.world.simMin
  s.log('edit', { path })
  await refresh(s)
}

// ---------- what the player reads ----------
export function seen(s: Session, what: string) {
  const f = s.priv.f, [kind, id] = [what.slice(0, what.indexOf(':')), what.slice(what.indexOf(':') + 1)]
  if (kind === 'chan' && id in s.world.unread) {
    if (s.world.unread[id]) s.set(w => ({ unread: { ...w.unread, [id]: 0 } }))
    if (id === 'team' && f.warnedAt !== undefined && f.readWarningAt === undefined) f.readWarningAt = s.world.simMin
  } else if (kind === 'mail') {
    if (s.world.emails.some(e => e.id === id && !e.read)) s.set(w => ({ emails: w.emails.map(e => (e.id === id ? { ...e, read: true } : e)) }))
  } else if ((kind === 'file' || kind === 'doc') && !f.seen.includes(what)) { f.seen.push(what); s.log('seen', { what }) }
}
export function patchMail(s: Session, id: string, p: { read?: boolean; flagged?: boolean; folder?: Folder }) {
  s.set(w => ({ emails: w.emails.map(e => (e.id === id ? { ...e, ...p } : e)) }))
}

// ---------- what the player writes ----------
/** Colleagues who chat, by first name, the mentor first so a question naming several goes to them. */
function named(s: Session, text: string): PersonId | undefined {
  const { cast, mentor } = s.scenario, words = new Set(text.toLowerCase().match(/\p{L}+/gu))
  const chatty = Object.keys(cast).filter(id => cast[id].persona?.rooms.length).sort((a, b) => Number(b === mentor) - Number(a === mentor))
  return chatty.find(id => words.has(cast[id].name.split(' ')[0].toLowerCase()))
}
/** The line a colleague falls back on when the model cannot be reached. */
function scripted(s: Session, who: PersonId, firstAck: boolean): string {
  const f = s.priv.f, live = open(s), resolved = !!s.world.incident?.resolvedAt
  if (who === 'leo') return f.leo === 'deferred' ? 'no worries, I’ll poke around the test config' : f.leo === 'helped' && f.leoAskedAt !== undefined && !s.priv.events.some(e => e.type === 'leo-thanked') ? 'oh that’s so much faster. thank you!! owe you a coffee' : live ? 'want me to keep an eye on support tickets while you fix it?' : 'nice, thanks'
  if (who === 'priya') return firstAck ? 'Thanks for owning it. Post updates in #incidents every 10 minutes. Revert or patch is your call, but tell me which before you do it.' : live ? 'Ok. Tell me when it’s green.' : resolved ? 'Thanks. Postmortem in my inbox when you can.' : 'Sounds good.'
  return live ? 'What changed in how verifySession gets the token? Compare that with what each login path actually sends.' : resolved ? 'Good. Next: a test that signs in with a password and then calls verifySession.' : 'Tell me what you have tried and what you expected to happen. I will come back with a question.'
}

export function chat(s: Session, chan: ChanId, text: string, files: Attachment[]) {
  const f = s.priv.f, m = s.world.simMin
  s.post(chan, s.world.player, text, { files })
  const firstAck = open(s) && f.ackAt === undefined && (chan === 'incidents' || chan === 'priya')
  if (firstAck) { f.ackAt = m; f.ackText = text; s.timeline(`Acknowledged by ${player(s)}`, 'accent'); void mentor.review(s, 'ack', text) }
  if (chan === s.scenario.mentor) f.askedDanielAt ??= m
  if (chan === 'leo' && f.leoAskedAt !== undefined && !f.leo) f.leo = /later|busy|after|swamped|not now/i.test(text) ? 'deferred' : 'helped'

  const who = chan === 'team' ? named(s, text) ?? (text.includes('?') ? s.scenario.mentor : 'leo') : chan === 'incidents' ? named(s, text) ?? 'priya' : chan
  const line = scripted(s, who, firstAck)
  if (who === 'leo' && f.leo === 'helped') s.log('leo-thanked')
  void reply(s, who, { room: chan }, text + (files.length ? `\n[attached: ${files.map(a => (a.kind === 'code' ? a.path : a.kind === 'doc' ? 'wiki page ' + a.doc : a.kind === 'ticket' ? a.id : a.kind === 'upload' ? a.name : a.label)).join(', ')}]` : ''), line)
}

export function mail(s: Session, a: { mode: 'reply' | 'new' | 'forward'; ref?: string; to?: string; subject?: string; text: string; files: Attachment[] }) {
  const w = s.world, f = s.priv.f, m = w.simMin
  const ref = w.emails.find(e => e.id === a.ref)
  const to = a.mode === 'reply' ? ref?.who : personByName(s.world.cast, a.to ?? '')
  if (a.mode === 'reply' && !ref) throw new Refusal('That message no longer exists.')
  // A new message to someone answers their latest unanswered scenario mail, the same as replying would.
  const answers = a.mode === 'reply' ? ref : a.mode === 'new' ? w.emails.find(e => e.who === to && e.kind && !e.thread.length) : undefined
  const body = a.text.split('\n').map(p => p.trim()).filter(Boolean)
  if (a.mode === 'forward' && ref) body.push('———  Forwarded message  ———', `From: ${s.world.cast[ref.who].name} · ${ref.time}`, ...ref.body)
  const sent: Email = { id: 's' + s.id(), folder: 'sent', who: s.world.player, toName: to ? s.world.cast[to].name : (a.to ?? '').trim().slice(0, 120), subject: a.mode === 'reply' ? 'Re: ' + ref!.subject.replace(/^Re: /, '') : (a.subject ?? '').trim().slice(0, 140) || '(No subject)', time: s.now, read: true, body, files: a.files, thread: [] }
  s.set(x => ({ emails: [sent, ...x.emails.map(e => (e.id === answers?.id ? { ...e, read: true, thread: [...e.thread, { time: s.now, text: a.text, files: a.files }] } : e))] }))
  s.log('mail', { who: s.world.player, to: sent.toName, subject: sent.subject, text: a.text })
  if (!to || !s.scenario.cast[to].persona) return

  const kind = answers?.kind
  if (kind === 'assign') f.assignAckAt ??= m
  if (kind === 'client' && f.clientAt === undefined) { f.clientAt = m; f.clientText = a.text; s.timeline(`Client update sent to ${shortName(clientOf(s.scenario))} (${player(s)})`, 'accent'); void mentor.review(s, 'client', a.text) }
  if (kind === 'pm' && f.pmAt === undefined) { f.pmAt = m; f.pmText = a.text; void mentor.review(s, 'pm', a.text) }
  const sign = call(s, s.scenario.story.client)
  const line = kind === 'assign' ? `Thanks ${player(s)}. Shout if you get stuck, and loop ${call(s, s.scenario.mentor)} in early on anything auth.`
    : kind === 'client' ? (open(s) ? `Thank you, ${player(s)}. Please let me know as soon as they can get in.\n${sign}` : `Confirmed, the team is back in. Thank you for writing to me directly.\n${sign}`)
    : kind === 'pm' ? 'Got it, thank you. We’ll go through the action items at standup tomorrow.'
    : null
  const context = answers ? s.world.emails.find(e => e.id === answers.id)! : { ...sent, who: to, body: [`(${player(s)} wrote to ${s.world.cast[to].name})`], thread: [{ time: s.now, text: a.text, files: [] }] }
  void reply(s, to, { room: to === 'priya' && kind !== 'client' ? 'priya' : null, mail: context }, a.text, line)
}

export function saveTicket(s: Session, id: string | undefined, p: Partial<Pick<Ticket, 'title' | 'desc' | 'status' | 'pri' | 'who' | 'pts'>>) {
  if (id) return s.ticket(id, p, s.world.player)
  const n = Math.max(217, ...s.world.tickets.map(t => Number(t.id.replace('LED-', '')) || 0)) + 1
  const t: Ticket = { id: 'LED-' + n, title: p.title || 'Untitled', desc: p.desc ?? '', status: p.status ?? 'todo', who: p.who ?? s.world.player, pri: p.pri ?? 'Medium', pts: p.pts ?? null, comments: [], activity: [{ time: s.now, text: `${s.world.cast[s.world.player].name}: created the issue` }] }
  s.set(w => ({ tickets: [...w.tickets, t] }))
  s.log('ticket', { id: t.id, title: t.title })
  return t.id
}
export function comment(s: Session, id: string, text: string) {
  const t = s.world.tickets.find(x => x.id === id)
  if (t) s.ticket(id, { comments: [...t.comments, { who: s.world.player, time: s.now, text }] }, s.world.player, 'commented')
}
export function saveDoc(s: Session, id: string | undefined, d: Pick<Doc, 'title' | 'group' | 'body'>) {
  const f = s.priv.f, old = s.world.docs.find(x => x.id === id)
  const next: Doc = old ? { ...old, ...d, version: old.version + 1, updated: 'today ' + s.now } : { id: 'p' + s.id(), ...d, owner: s.world.player, updated: 'today ' + s.now, version: 1 }
  s.set(w => ({ docs: old ? w.docs.map(x => (x.id === old.id ? next : x)) : [...w.docs, next] }))
  s.log('doc', { who: s.world.player, id: next.id, title: next.title })
  // A postmortem written as a wiki page counts the same as one sent by email.
  if (/post-?mortem/i.test(d.title) && s.world.incident?.resolvedAt && f.pmAt === undefined) {
    f.pmAt = s.world.simMin; f.pmText = d.body
    void mentor.review(s, 'pm', d.body)
    s.later(3000, () => s.say('priya', 'priya', `Saw “${d.title}” in Confluence. Thank you. We’ll go through the action items at standup tomorrow.`))
  }
  return next.id
}

/** Ends the shift, from the player's End shift button. It counts as finished, which is what testing a draft needs, only once the
 * lesson's work is done: the fix shipped and everything live passes, hidden checks included. That is the guide's last phase. */
export async function end(s: Session) {
  if (s.world.stage !== 'sim') return
  pause(s)
  void s.ws.close()
  const live = s.priv.verdicts[s.world.deploys.at(-1)!.sha]
  s.priv.finished = s.priv.f.fixedAt !== undefined && !!live && !failing(live.checks).length
  s.log('end', { finished: s.priv.finished })
  s.set({ stage: 'recap', typing: [], recap: { ready: false, happened: mentor.story(s), corrected: [], next: [], note: '' } })
  s.set({ recap: await mentor.recap(s) })
}
export { COLS }
