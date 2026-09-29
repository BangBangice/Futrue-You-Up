// Runs the shift: the clock, the things that happen on schedule, and what follows from what the player does.
// No model calls here. The director decides what is true; personas and the mentor decide how to say it.
import { ALARM, CHECK_LABEL, COLS, DEMO, PEOPLE, SHARE, START, clock, dur, errAt, failing, isOutage, lockedAt, personByName } from '../shared/types.ts'
import type { Attachment, ChanId, Check, Doc, Email, Folder, TermLine, Ticket } from '../shared/types.ts'
import * as mentor from './ai/mentor.ts'
import { reply } from './ai/personas.ts'
import type { Persona } from './ai/personas.ts'
import { Refusal, tokenize } from './sandbox.ts'
import type { Emit } from './sandbox.ts'
import type { Beat, Session } from './world.ts'

/** The browser gets the checks customers can feel. Security verdicts stay on the server. */
const visible = (checks: Check[]) => checks.filter(c => SHARE[c.id] > 0)
const open = (s: Session) => !!s.world.incident && s.world.incident.resolvedAt === null
const dashboard: Attachment = { kind: 'link', label: 'auth-api · prod dashboard', app: 'monitor' }
const wait = (s: Session, ms: number) => new Promise(r => setTimeout(r, ms * s.timeScale))

// ---------- start, clock ----------
export async function start(s: Session) {
  const [state, base] = [await s.ws.state(), await s.ws.accept()]
  s.priv.verdicts[state.head] = { ...base, diff: '' }
  s.world.term = [{ c: 'dim', t: 'Last login: Tue Sep 29 09:14 on ttys002' }, { c: 'dim', t: 'Type "help" to see what is available here.' }]
  s.set({ files: await s.ws.tree(), code: state, deploys: [{ sha: state.head, at: START - 300, by: 'daniel', kind: 'deploy', checks: visible(base.checks) }] })
  s.at(1, 'daniel_warning'); s.at(3, 'leo_question'); s.at(22, 'priya_checkin'); s.at(45, 'priya_chase')
  s.priv.beats.push({ at: DEMO, kind: 'demo' })
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
  due.forEach(b => BEATS[b.kind]?.(s, b))
  // Production follows the code. A rollout takes two minutes to show either way.
  const live = s.world.deploys.at(-1)!
  if (m < live.at + 2) return
  if (!open(s) && isOutage(live.checks) && s.world.incident?.sha !== live.sha) openIncident(s)
  else if (open(s) && !isOutage(live.checks)) resolveIncident(s)
}

// ---------- things that happen on schedule ----------
const during = (s: Session, b: Beat) => open(s) && s.world.incident!.id === b.inc
const shipped = (s: Session) => s.world.deploys.some(d => d.by === 'maya')
const BEATS: Record<string, (s: Session, b: Beat) => void> = {
  daniel_warning: s => {
    s.priv.f.warnedAt = s.world.simMin
    s.post('team', 'daniel', '@maya saw Priya gave you LED-214. Heads up: verifySession is shared by every login path (SSO, password, API keys). Whatever you change in there, check the password flow too. Ping me when you get stuck, not after.', { files: [{ kind: 'code', path: 'src/auth/verifySession.ts' }, { kind: 'doc', doc: 'auth' }] })
  },
  leo_question: s => { s.priv.f.leoAskedAt = s.world.simMin; s.post('leo', 'leo', 'hey Maya, sorry to bug you. how do I run just the auth tests? the full suite takes 9 minutes on my laptop') },
  priya_checkin: s => { if (!shipped(s)) s.post('priya', 'priya', 'How’s LED-214 looking? Ideally it’s out before 2:30 so we have buffer for the demo.') },
  priya_chase: s => { if (!shipped(s)) s.post('priya', 'priya', 'Any update on LED-214? Sam is asking.') },

  leo_bounced: (s, b) => { if (during(s, b)) s.post('team', 'leo', 'is anyone else getting bounced back to the login page? email + password, prod') },
  priya_ack1: (s, b) => { if (during(s, b) && s.priv.f.ackAt === undefined) s.post('priya', 'priya', `Maya, login errors are spiking and it lines up with your ${clock(s.world.deploys.at(-1)!.at)} deploy. Are you on it?`) },
  priya_ack2: (s, b) => { if (during(s, b) && s.priv.f.ackAt === undefined) s.post('priya', 'priya', 'I need a status, even if it’s just “looking”.') },
  hana_mail: (s, b) => {
    if (during(s, b)) s.mail({ who: 'hana', subject: 'Spike in “can’t log in” tickets', kind: 'support', body: ['Hi eng,', 'We’ve had 31 tickets in the last 10 minutes, all the same: email + password users sign in, then get bounced straight back to the login page. SSO customers seem fine.', 'Osprey and Brightline have both called. Anything I can tell them?', 'Hana · Support'] })
  },
  marta_mail: (s, b) => {
    if (!during(s, b)) return
    s.priv.f.clientMailAt = s.world.simMin
    s.mail({ who: 'marta', subject: 'Our team can’t log in, and the demo is at 3:00', kind: 'client', toName: 'Ledgerly Support; Sam Whitfield', body: ['Hello,', `Since about ${clock(s.world.deploys.at(-1)!.at + 1)}, none of our finance contractors can get into Ledgerly. They enter their password and land back on the sign-in page. They’re the people I’m showing the new invoice run to at 3:00.`, 'This is exactly the kind of reliability issue we’re weighing in the renewal. Can someone tell me what’s happening?', 'Marta Lindqvist', 'Head of Finance Ops, Northwind Freight'] })
  },
  priya_decide: (s, b) => { if (during(s, b)) s.post('incidents', 'priya', `@maya Northwind demo is in ${dur(Math.max(0, DEMO - s.world.simMin))}. Revert or patch? I need to know which.`) },
  sam_mail: (s, b) => {
    if (during(s, b)) s.mail({ who: 'sam', subject: 'Do we postpone Northwind?', kind: 'sam', body: ['Priya looped me in. Marta just emailed me directly too.', 'If logins aren’t back by 2:45 I’ll have to call her and move the demo, which won’t help the renewal. What’s your read?', 'Sam'] })
  },

  priya_postmortem: s => {
    s.post('priya', 'priya', 'We’re back. Thank you. Before you log off, send me a short postmortem: what happened, why, what we change. Blameless, keep it short.')
    s.mail({ who: 'priya', subject: 'Postmortem: auth-api password logins', kind: 'pm', files: [{ kind: 'doc', doc: 'postmortem' }], body: ['Hi Maya,', 'Thanks for getting us back. Please send a short, blameless postmortem before you log off: what happened, impact, why, how we fixed it, and what we’ll change. Replying here is fine, or write it up as a page in Confluence.', 'Priya'] })
  },
  leo_works: s => s.post('team', 'leo', 'password login works again for me'),
  sam_demo_on: s => { if (s.world.demo === 'pending') s.mail({ who: 'sam', subject: 'Northwind demo is on', body: ['Marta says her team is back in. Demo goes ahead at 3:00. Thanks for moving fast.', 'Sam'] }) },
  demo: s => {
    const held = !open(s)
    s.set({ demo: held ? 'held' : 'postponed' })
    s.log('demo', { held })
    if (held) return
    s.timeline('Northwind demo postponed', 'bad')
    s.mail({ who: 'sam', subject: 'Northwind demo postponed', body: ['I called Marta and moved the demo to Thursday. She was polite about it, but she asked for a written explanation for their CFO.', 'Sam'] })
  },
}

// ---------- production ----------
function openIncident(s: Session) {
  const w = s.world, m = w.simMin, live = w.deploys.at(-1)!, v = s.priv.verdicts[live.sha]
  const id = 'INC-' + (37 + w.tickets.filter(t => t.id.startsWith('INC')).length)
  const what = failing(live.checks).filter(c => c !== 'sso_after_refresh').map(c => CHECK_LABEL[c]).join(', ')
  const rate = errAt(w.deploys, m).toFixed(1), reason = live.checks.find(c => !c.ok && c.id !== 'sso_after_refresh')?.reason ?? 'rejected'
  const t: Ticket = { id, title: `${what} failing on auth-api`, status: 'progress', who: 'maya', pri: 'Urgent', pts: null, comments: [], activity: [{ time: s.now, text: 'CloudWatch: created the issue' }], desc: `CloudWatch alarm: 401 rate on auth-api above ${ALARM}% since ${clock(m)}. Opened automatically and assigned to the author of the latest deploy, auth-api@${live.sha}.` }
  s.set({ incident: { id, sha: live.sha, startedAt: m, resolvedAt: null, failing: failing(live.checks) }, tickets: [t, ...w.tickets] })
  s.mail({ who: 'jira', folder: 'alerts', subject: `[JIRA] (${id}) assigned to you: ${t.title}`, body: [`CloudWatch assigned ${id} to you.`, t.desc], files: [{ kind: 'ticket', id }] })
  s.post('incidents', 'cloudwatch', `[FIRING] auth-api · 401 rate ${rate}% (threshold ${ALARM}%) · top reason: ${reason}`, { alert: 'fire', files: [dashboard] })
  s.mail({ who: 'cloudwatch', folder: 'alerts', subject: `[FIRING] auth-api: 401 rate ${rate}% (threshold ${ALARM}%)`, body: [`Alarm: auth-api 401 rate above ${ALARM}% for 2 minutes.`, `Current: ${rate}% · Baseline: 0.4%`, `Top reason: ${reason}`, `Most recent deploy: auth-api@${live.sha} by maya.chen at ${clock(live.at)}`], files: [dashboard, { kind: 'doc', doc: 'incident' }] })
  s.timeline(`Alarm fired: 401 rate > ${ALARM}%`, 'bad')
  s.log('incident', { id, what })
  for (const [d, kind] of [[2, 'leo_bounced'], [3, 'priya_ack1'], [6, 'hana_mail'], [8, 'priya_ack2'], [9, 'marta_mail'], [15, 'priya_decide'], [18, 'sam_mail']] as const) s.at(d, kind, id)
  mentor.onIncident(s, live.sha, v, v.diff)
}

function resolveIncident(s: Session) {
  const w = s.world, m = w.simMin, inc = w.incident!, live = w.deploys.at(-1)!
  s.set({ incident: { ...inc, resolvedAt: m } })
  s.ticket(inc.id, { status: 'done' }, 'cloudwatch', 'resolved: 401 rate back under threshold')
  s.post('incidents', 'cloudwatch', `[RESOLVED] auth-api · 401 rate back to ${errAt(w.deploys, m + 2).toFixed(1)}% · duration ${m - inc.startedAt} min`, { alert: 'ok' })
  s.timeline(`Resolved: 401 rate ${errAt(w.deploys, m + 2).toFixed(1)}%`, 'good')
  s.log('resolved', { id: inc.id, mins: m - inc.startedAt })
  s.at(1, 'priya_postmortem'); s.at(1, 'leo_works')
  if (m < DEMO - 3) s.at(3, 'sam_demo_on')
  void mentor.onHealthy(s, live.kind === 'rollback' ? 'rollback' : 'fix')
}

async function ldg(s: Session, args: string[], emit: Emit): Promise<number> {
  const say = (t: string, c: TermLine['c'] = 'out') => emit({ c, t })
  const w = s.world, f = s.priv.f, m = w.simMin, live = w.deploys.at(-1)!
  const [sub, service] = args
  if (!sub || sub === 'help') { ['ldg status', 'ldg logs', 'ldg deploy auth-api --env prod', 'ldg rollback auth-api [--to <sha>]'].forEach(l => say(l, 'dim')); return 0 }
  if (service && !service.startsWith('-') && service !== 'auth-api') throw new Refusal(`ldg: you have no changes for ${service}. The service in this repo is auth-api.`)

  if (sub === 'status') {
    say(`auth-api  prod  ${live.sha}  ${live.kind === 'rollback' ? 'rolled back' : 'deployed'} ${clock(live.at)} by ${PEOPLE[live.by].name}  6/6 pods`)
    say(`401 rate  ${errAt(w.deploys, m).toFixed(1)}%  (alarm at ${ALARM}%)`, isOutage(live.checks) ? 'err' : 'ok')
    return 0
  }
  if (sub === 'logs') {
    const bad = failing(live.checks)
    const line = (path: string, how: string, ok: boolean, reason = '') => say(`${clock(m)}  auth-api  ${ok ? '200' : '401 ' + reason}  ${path}  auth=${how}`, ok ? 'out' : 'err')
    const why = (id: Check['id']) => live.checks.find(c => c.id === id)?.reason ?? ''
    line('GET /invoices org=org_northwind', 'cookie (password login)', !bad.includes('password_login'), why('password_login'))
    line('GET /invoices org=org_osprey', 'cookie (password login)', !bad.includes('password_login'), why('password_login'))
    line('GET /invoices org=org_northwind', 'bearer (sso, first hour)', true)
    line('GET /invoices org=org_brightline', 'bearer after refresh + expired cookie (sso)', !bad.includes('sso_after_refresh'), why('sso_after_refresh'))
    line('GET /invoices org=org_osprey', 'x-api-key', !bad.includes('api_key'), why('api_key'))
    return 0
  }
  if (sub === 'deploy') {
    if (!args.some(a => a === 'prod' || a === '--env=prod')) throw new Refusal('ldg deploy: say where. Usage: ldg deploy auth-api --env prod')
    const st = await s.ws.state()
    if (st.changes.length) { say('error: you have uncommitted changes. Only committed code is deployed.', 'err'); say('  git commit -am "what you changed"', 'dim'); return 1 }
    if (st.head === live.sha) { say(`auth-api@${st.head} is already live in prod. Nothing to deploy.`, 'dim'); return 0 }
    say(`→ building auth-api@${st.head} …`, 'dim')
    const v = { ...(await s.ws.accept()), diff: (await s.ws.git(['diff', live.sha, 'HEAD', '--', 'src'])).out }
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
    const first = !shipped(s), bad = failing(v.checks), holes = bad.filter(c => mentor.SECURITY.includes(c))
    s.set({ deploys: [...w.deploys, { sha: st.head, at: s.world.simMin, by: 'maya', kind: 'deploy', checks: visible(v.checks) }] })
    s.timeline(`Deploy auth-api@${st.head} (Maya)`, 'accent')
    s.post('incidents', 'cloudwatch', `Deploy · auth-api@${st.head} by maya.chen · 6/6 pods healthy`, { alert: 'info' })
    s.log('deploy', { sha: st.head, tested: f.testedAt !== undefined && (f.editedAt === undefined || f.testedAt >= f.editedAt), broke: bad.filter(c => c !== 'sso_after_refresh').map(c => CHECK_LABEL[c]).join(', ') })
    if (first) s.later(2500, () => s.say('priya', 'priya', 'Saw LED-214 go out. Thanks Maya. Keep an eye on CloudWatch for a few minutes.'))

    if (!bad.length) {
      f.fixedAt = s.world.simMin
      s.ticket('LED-214', { status: 'done', reopened: false }, 'jira', `released in auth-api@${st.head}`)
      if (!open(s)) void mentor.onHealthy(s, s.priv.attempts ? 'fix' : 'first-time')
    } else if (holes.length && !isOutage(v.checks)) s.later(5000, () => mentor.onSilentHole(s, st.head, v, v.diff))
    else if (!isOutage(v.checks)) s.later(5000, () => mentor.onNoFix(s, st.head, v, v.diff))
    return 0
  }
  if (sub === 'rollback') {
    const to = args[args.indexOf('--to') + 1], wanted = args.includes('--to') ? w.deploys.findLast(d => d.sha.startsWith(to ?? '\0')) : w.deploys.findLast(d => d.sha !== live.sha)
    if (!wanted || wanted.sha === live.sha) { say(args.includes('--to') ? `ldg rollback: no release ${to} in the history` : 'Nothing to roll back to: this is the only release.', 'err'); return 1 }
    say(`→ rolling back 6/6 pods to ${wanted.sha} …`, 'dim')
    await wait(s, 1200)
    say(`✓ auth-api@${wanted.sha} is live in prod (rollback)`, 'ok')
    const hadHole = failing(s.priv.verdicts[live.sha]?.checks ?? []).some(c => mentor.SECURITY.includes(c))
    f.rolledBackAt = s.world.simMin
    s.set({ deploys: [...w.deploys, { sha: wanted.sha, at: s.world.simMin, by: 'maya', kind: 'rollback', checks: wanted.checks }] })
    s.timeline(`Rollback to auth-api@${wanted.sha} (Maya)`, 'accent')
    s.post('incidents', 'cloudwatch', `Rollback · auth-api → ${wanted.sha} by maya.chen`, { alert: 'info' })
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
  if (!before || state.head === before || s.priv.verdicts[state.head]) return
  s.log('commit', { sha: state.head, subject: state.subject })
  // Get ahead: find out now what this commit would do in production, and start on the coaching if it would do harm.
  const live = s.world.deploys.at(-1)!
  const v = { ...(await s.ws.accept()), diff: (await s.ws.git(['diff', live.sha, 'HEAD', '--', 'src'])).out }
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
    if (s.world.unread[id as ChanId]) s.set(w => ({ unread: { ...w.unread, [id]: 0 } }))
    if (id === 'team' && f.warnedAt !== undefined && f.readWarningAt === undefined) f.readWarningAt = s.world.simMin
  } else if (kind === 'mail') {
    if (s.world.emails.some(e => e.id === id && !e.read)) s.set(w => ({ emails: w.emails.map(e => (e.id === id ? { ...e, read: true } : e)) }))
  } else if ((kind === 'file' || kind === 'doc') && !f.seen.includes(what)) { f.seen.push(what); s.log('seen', { what }) }
}
export function patchMail(s: Session, id: string, p: { read?: boolean; flagged?: boolean; folder?: Folder }) {
  s.set(w => ({ emails: w.emails.map(e => (e.id === id ? { ...e, ...p } : e)) }))
}

// ---------- what the player writes ----------
const NAMES: [RegExp, Persona][] = [[/\bdaniel\b/i, 'daniel'], [/\bpriya\b/i, 'priya'], [/\bleo\b/i, 'leo']]
/** The line a colleague falls back on when the model cannot be reached. */
function scripted(s: Session, who: Persona, firstAck: boolean): string {
  const f = s.priv.f, live = open(s), resolved = !!s.world.incident?.resolvedAt
  if (who === 'leo') return f.leo === 'deferred' ? 'no worries, I’ll poke around the test config' : f.leo === 'helped' && f.leoAskedAt !== undefined && !s.priv.events.some(e => e.type === 'leo-thanked') ? 'oh that’s so much faster. thank you!! owe you a coffee' : live ? 'want me to keep an eye on support tickets while you fix it?' : 'nice, thanks'
  if (who === 'priya') return firstAck ? 'Thanks for owning it. Post updates in #incidents every 10 minutes. Revert or patch is your call, but tell me which before you do it.' : live ? 'Ok. Tell me when it’s green.' : resolved ? 'Thanks. Postmortem in my inbox when you can.' : 'Sounds good.'
  return live ? 'What changed in how verifySession gets the token? Compare that with what each login path actually sends.' : resolved ? 'Good. Next: a test that signs in with a password and then calls verifySession.' : 'Tell me what you have tried and what you expected to happen. I will come back with a question.'
}

export function chat(s: Session, chan: ChanId, text: string, files: Attachment[]) {
  const f = s.priv.f, m = s.world.simMin
  s.post(chan, 'maya', text, { files })
  const firstAck = open(s) && f.ackAt === undefined && (chan === 'incidents' || chan === 'priya')
  if (firstAck) { f.ackAt = m; f.ackText = text; s.timeline('Acknowledged by Maya', 'accent'); void mentor.review(s, 'ack', text) }
  if (chan === 'daniel') f.askedDanielAt ??= m
  if (chan === 'leo' && f.leoAskedAt !== undefined && !f.leo) f.leo = /later|busy|after|swamped|not now/i.test(text) ? 'deferred' : 'helped'

  const named = NAMES.find(([re]) => re.test(text))?.[1]
  const who: Persona = chan === 'team' ? named ?? (text.includes('?') ? 'daniel' : 'leo') : chan === 'incidents' ? named ?? 'priya' : chan
  const line = scripted(s, who, firstAck)
  if (who === 'leo' && f.leo === 'helped') s.log('leo-thanked')
  void reply(s, who, { room: chan }, text + (files.length ? `\n[attached: ${files.map(a => (a.kind === 'code' ? a.path : a.kind === 'doc' ? 'wiki page ' + a.doc : a.kind === 'ticket' ? a.id : a.kind === 'upload' ? a.name : a.label)).join(', ')}]` : ''), line)
}

export function mail(s: Session, a: { mode: 'reply' | 'new' | 'forward'; ref?: string; to?: string; subject?: string; text: string; files: Attachment[] }) {
  const w = s.world, f = s.priv.f, m = w.simMin
  const ref = w.emails.find(e => e.id === a.ref)
  const to = a.mode === 'reply' ? ref?.who : personByName(a.to ?? '')
  if (a.mode === 'reply' && !ref) throw new Refusal('That message no longer exists.')
  // A new message to someone answers their latest unanswered scenario mail, the same as replying would.
  const answers = a.mode === 'reply' ? ref : a.mode === 'new' ? w.emails.find(e => e.who === to && e.kind && !e.thread.length) : undefined
  const body = a.text.split('\n').map(p => p.trim()).filter(Boolean)
  if (a.mode === 'forward' && ref) body.push('———  Forwarded message  ———', `From: ${PEOPLE[ref.who].name} · ${ref.time}`, ...ref.body)
  const sent: Email = { id: 's' + s.id(), folder: 'sent', who: 'maya', toName: to ? PEOPLE[to].name : (a.to ?? '').trim().slice(0, 120), subject: a.mode === 'reply' ? 'Re: ' + ref!.subject.replace(/^Re: /, '') : (a.subject ?? '').trim().slice(0, 140) || '(No subject)', time: s.now, read: true, body, files: a.files, thread: [] }
  s.set(x => ({ emails: [sent, ...x.emails.map(e => (e.id === answers?.id ? { ...e, read: true, thread: [...e.thread, { time: s.now, text: a.text, files: a.files }] } : e))] }))
  s.log('mail', { who: 'maya', to: sent.toName, subject: sent.subject, text: a.text })
  if (!to || ['maya', 'people', 'cloudwatch', 'jira'].includes(to)) return

  const kind = answers?.kind
  if (kind === 'assign') f.assignAckAt ??= m
  if (kind === 'client' && f.clientAt === undefined) { f.clientAt = m; f.clientText = a.text; s.timeline('Client update sent to Northwind (Maya)', 'accent'); void mentor.review(s, 'client', a.text) }
  if (kind === 'pm' && f.pmAt === undefined) { f.pmAt = m; f.pmText = a.text; void mentor.review(s, 'pm', a.text) }
  const line = kind === 'assign' ? 'Thanks Maya. Shout if you get stuck, and loop Daniel in early on anything auth.'
    : kind === 'client' ? (open(s) ? 'Thank you, Maya. Please let me know as soon as they can get in.\nMarta' : 'Confirmed, the team is back in. Thank you for writing to me directly.\nMarta')
    : kind === 'pm' ? 'Got it, thank you. We’ll go through the action items at standup tomorrow.'
    : null
  const context = answers ? s.world.emails.find(e => e.id === answers.id)! : { ...sent, who: to, body: [`(Maya wrote to ${PEOPLE[to].name})`], thread: [{ time: s.now, text: a.text, files: [] }] }
  void reply(s, to as Persona, { room: to === 'priya' && kind !== 'client' ? 'priya' : null, mail: context }, a.text, line)
}

export function saveTicket(s: Session, id: string | undefined, p: Partial<Pick<Ticket, 'title' | 'desc' | 'status' | 'pri' | 'who' | 'pts'>>) {
  if (id) return s.ticket(id, p, 'maya')
  const n = Math.max(217, ...s.world.tickets.map(t => Number(t.id.replace('LED-', '')) || 0)) + 1
  const t: Ticket = { id: 'LED-' + n, title: p.title || 'Untitled', desc: p.desc ?? '', status: p.status ?? 'todo', who: p.who ?? 'maya', pri: p.pri ?? 'Medium', pts: p.pts ?? null, comments: [], activity: [{ time: s.now, text: 'Maya Chen: created the issue' }] }
  s.set(w => ({ tickets: [...w.tickets, t] }))
  s.log('ticket', { id: t.id, title: t.title })
  return t.id
}
export function comment(s: Session, id: string, text: string) {
  const t = s.world.tickets.find(x => x.id === id)
  if (t) s.ticket(id, { comments: [...t.comments, { who: 'maya', time: s.now, text }] }, 'maya', 'commented')
}
export function saveDoc(s: Session, id: string | undefined, d: Pick<Doc, 'title' | 'group' | 'body'>) {
  const f = s.priv.f, old = s.world.docs.find(x => x.id === id)
  const next: Doc = old ? { ...old, ...d, version: old.version + 1, updated: 'today ' + s.now } : { id: 'p' + s.id(), ...d, owner: 'maya', updated: 'today ' + s.now, version: 1 }
  s.set(w => ({ docs: old ? w.docs.map(x => (x.id === old.id ? next : x)) : [...w.docs, next] }))
  s.log('doc', { who: 'maya', id: next.id, title: next.title })
  // A postmortem written as a wiki page counts the same as one sent by email.
  if (/post-?mortem/i.test(d.title) && s.world.incident?.resolvedAt && f.pmAt === undefined) {
    f.pmAt = s.world.simMin; f.pmText = d.body
    void mentor.review(s, 'pm', d.body)
    s.later(3000, () => s.say('priya', 'priya', `Saw “${d.title}” in Confluence. Thank you. We’ll go through the action items at standup tomorrow.`))
  }
  return next.id
}

export async function end(s: Session) {
  if (s.world.stage !== 'sim') return
  pause(s)
  s.log('end')
  s.set({ stage: 'recap', typing: [], recap: { ready: false, happened: mentor.story(s), corrected: [], next: [], note: '' } })
  s.set({ recap: await mentor.recap(s) })
}
export { COLS, lockedAt }
