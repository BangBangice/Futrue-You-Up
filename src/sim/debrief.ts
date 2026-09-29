// Turns the flags recorded during a shift into the debrief and the evidence report. Pure functions.
import { DEMO, METERS, RATE, START_METERS, clock, dur, money } from './data.ts'
import type { SimState, Tag } from './data.ts'

export interface DebriefItem { t: number; tag: Tag; title: string; detail: string; senior: string }
export type Score = [label: string, value: number]
export const levelOf = (v: number) => (v >= 80 ? 'Strong' : v >= 60 ? 'Solid' : 'Developing')

export function buildDebrief(s: SimState) {
  const f = s.f, m = s.simMin, dep = f.deploy, items: DebriefItem[] = []
  if (dep !== undefined) {
    items.push(f.readTeam !== undefined && f.readTeam <= dep
      ? { t: f.readTeam, tag: 'Missed signal', title: 'Read Daniel’s warning, then shipped without checking the other login paths', detail: 'Daniel said verifySession is shared by SSO, password and API-key logins. The change went out without anyone checking the password flow.', senior: 'Turn the warning into a test plan: find every caller of verifySession and check what each one sends (header, cookie or API key).' }
      : { t: dep, tag: 'Missed signal', title: 'Deployed before reading #team', detail: 'Daniel’s warning about verifySession was posted at 1:11 PM and was still unread when the deploy went out.', senior: 'Check team channels before touching shared code. Often the most useful review is already sitting in chat.' })
    if (f.viewPwd !== undefined && f.viewPwd <= dep) items.push({ t: f.viewPwd, tag: 'Could improve', title: 'Opened passwordLogin.ts but didn’t connect it to the change', detail: 'That file sets the token as a cookie. Your change stopped reading cookies.', senior: 'When you read a caller, ask one question: after my change, where does this path’s token come from?' })
    items.push(f.ranTests !== undefined && f.ranTests <= dep
      ? { t: f.ranTests, tag: 'Could improve', title: 'Ran the auth tests: 18 of 18 passed', detail: 'Every test used a bearer token. The suite covered the path you fixed, not the paths you could break.', senior: 'Before fixing anything, write one failing test for the risk: a password login followed by verifySession.' }
      : { t: dep, tag: 'Missed signal', title: 'Deployed without running tests', detail: 'The change went to prod straight from your branch.', senior: 'Run the suite, then ask what it doesn’t cover.' })
    items.push({ t: dep, tag: 'Root cause', title: 'Deployed a41f9c2: token read from the Authorization header only', detail: 'SSO clients send a bearer header. Password login only sets the ldg_session cookie, so every password session failed with missing_token.', senior: 'Read the header first and fall back to the cookie. Ship to one pod, watch 401s for five minutes, then roll out.' })
  }
  if (f.leoAsked) items.push(f.leo === 'helped'
    ? { t: f.leoAt!, tag: 'Strong', title: 'Unblocked Leo on running only the auth tests', detail: 'Answered ' + (f.leoAt! - f.leoAskedAt!) + ' min after he asked.', senior: '' }
    : f.leo === 'deferred'
      ? { t: f.leoAt!, tag: 'Could improve', title: 'Asked Leo to wait until later', detail: 'Reasonable when you’re focused, but it was a 30-second answer.', senior: 'If the answer is shorter than explaining why you’re busy, just answer.' }
      : { t: f.leoAskedAt!, tag: 'Could improve', title: 'Leo’s question went unanswered', detail: 'He asked how to run only the auth tests and heard nothing back.', senior: 'Even “busy till 3, try npm test -- src/auth” keeps a teammate moving.' })
  if (f.incident !== undefined) {
    if (f.ack !== undefined) {
      const d = f.ack - f.incident
      items.push({ t: f.ack, tag: d <= 4 ? 'Strong' : 'Could improve', title: 'Owned the incident publicly after ' + d + ' min', detail: d <= 4 ? 'You said it was probably your deploy before anyone had to ask twice.' : 'Priya had to chase you for a status first.', senior: d <= 4 ? '' : 'Post within two minutes: what you see, that it may be your deploy, and when the next update is.' })
    } else items.push({ t: f.incident, tag: 'Missed signal', title: 'Never acknowledged the incident', detail: '#incidents and Priya heard nothing from you while logins were failing.', senior: 'A one-line “investigating, likely my deploy” buys trust while you work.' })
    if (f.clientMailAt !== undefined) items.push(f.client !== undefined
      ? { t: f.client, tag: 'Strong', title: 'Wrote to Northwind during the incident', detail: 'Marta heard from engineering directly: what broke and what happens next.', senior: 'Same, and copy Sam so the account team isn’t surprised.' }
      : { t: f.incident + 9, tag: 'Missed signal', title: 'Northwind’s escalation went unanswered', detail: 'Marta wrote at ' + clock(f.incident + 9) + ' with a renewal demo on the line.', senior: 'A short, honest reply: what’s affected, that a fix is under way, when you’ll update.' })
    if (f.choice === 'revert') items.push({ t: f.choiceAt!, tag: 'Strong', title: 'Rolled back first, investigated after', detail: 'Rollback started ' + (f.choiceAt! - f.incident) + ' min into the incident. Known-good code, one command.', senior: 'Exactly this. Restore service, then fix forward calmly with a test for the password path.' })
    else if (f.choice === 'patch') items.push({ t: f.choiceAt!, tag: 'Could improve', title: 'Risky call: patched forward under pressure', detail: 'The cookie fallback worked, but it went to prod during a live incident with no password-login test and a client demo ' + dur(Math.max(0, DEMO - f.choiceAt!)) + ' away.', senior: 'Roll back first. A rollback is one command and known-good; a patch is new, untested code.' })
    else items.push({ t: m, tag: 'Missed signal', title: 'Incident still open at end of shift', detail: 'No rollback or patch was started.', senior: 'When a deploy lines up with an alert, rolling back is the default.' })
    if (f.resolved !== undefined && !f.demoHit) items.push({ t: f.resolved, tag: 'Strong', title: 'Service restored ' + (DEMO - f.resolved) + ' min before the demo', detail: 'Northwind’s demo went ahead.', senior: '' })
    if (f.demoHit) items.push({ t: DEMO, tag: 'Missed signal', title: 'Northwind demo postponed', detail: 'Password logins were still failing at 3:00 PM.', senior: 'Time-box diagnosis. If it isn’t understood in 10 minutes, roll back.' })
    if (f.resolved !== undefined) items.push(f.pm !== undefined
      ? { t: f.pm, tag: 'Strong', title: 'Sent a postmortem the same day', detail: 'Blameless, with concrete follow-ups.', senior: '' }
      : { t: m, tag: 'Could improve', title: 'No postmortem sent', detail: 'Priya asked for one before you logged off.', senior: 'Write it while it’s fresh: 10 minutes, five headings.' })
  }
  if (dep === undefined) items.push({ t: m, tag: 'Could improve', title: 'LED-214 not shipped', detail: 'The shift ended before a fix went out.', senior: 'Ship small and early in the afternoon so there’s room to recover before the demo.' })
  items.sort((a, b) => a.t - b.t)

  const c = (v: number) => Math.max(12, Math.min(97, Math.round(v)))
  const ackFast = f.ack !== undefined && f.ack - f.incident! <= 4
  const scores: Score[] = [
    ['Technical judgment', c(46 + (f.viewPwd !== undefined ? 8 : 0) + (f.ranTests !== undefined ? 6 : 0) + (f.choice === 'revert' ? 22 : f.choice === 'patch' ? 6 : 0) - (f.demoHit ? 8 : 0))],
    ['Incident response', c(f.incident === undefined ? 40 : 34 + (f.ack !== undefined ? (ackFast ? 24 : 12) : 0) + (f.choice === 'revert' ? 22 : f.choice === 'patch' ? 8 : 0) + (f.resolved !== undefined && !f.demoHit ? 14 : 0))],
    ['Communication', c(32 + (f.ack !== undefined ? 16 : 0) + (f.client !== undefined ? 22 : 0) + (f.pm !== undefined ? 18 : 0) + (f.assignAck !== undefined ? 6 : 0) + (f.support !== undefined ? 4 : 0))],
    ['Collaboration', c(42 + (f.leo === 'helped' ? 24 : f.leo === 'deferred' ? 8 : 0) + (f.readTeam !== undefined ? 10 : 0) + (f.danielAsked !== undefined ? 10 : 0))],
    ['Risk awareness', c(28 + (f.readTeam !== undefined && dep !== undefined && f.readTeam <= dep ? 6 : 0) + (f.viewPwd !== undefined ? 12 : 0) + (f.choice === 'revert' ? 32 : 0) + (f.ranTests !== undefined ? 6 : 0))],
  ]

  const endM = f.resolved ?? m
  const stats = [
    { label: 'Time to acknowledge', value: f.ack !== undefined ? f.ack - f.incident! + ' min' : f.incident !== undefined ? 'Never' : '—' },
    { label: 'Time to recover', value: f.resolved !== undefined ? f.resolved - f.incident! + ' min' : f.incident !== undefined ? 'Not recovered' : '—' },
    { label: 'Revenue exposed', value: f.incident !== undefined ? money((endM - f.incident) * RATE) : '$0' },
    { label: 'Northwind demo', value: f.demoHit ? 'Postponed' : f.incident === undefined ? 'On schedule' : f.resolved !== undefined ? 'Held' : 'At risk' },
  ]
  const meterDelta = METERS.map(([k, label]) => ({ label, from: START_METERS[k], to: s.meters[k], d: s.meters[k] - START_METERS[k] }))
  return { items, scores, stats, meterDelta, window: '1:10 PM – ' + clock(m) }
}

export function buildReport(s: SimState) {
  const f = s.f, m = s.simMin, b = buildDebrief(s)
  const growth = b.items.filter(i => i.tag === 'Missed signal' || i.tag === 'Could improve')
  const choiceTxt = f.choice === 'revert' ? 'rolled the change back' : f.choice === 'patch' ? 'patched forward with a cookie fallback' : 'had not restored service by the end of the shift'
  const summary = f.deploy === undefined
    ? 'Maya investigated an SSO session bug (LED-214) but did not ship a fix during this shift.'
    : `Maya shipped a fix for an SSO session bug (LED-214) that unintentionally broke password logins for every customer. She ${f.ack !== undefined ? 'owned the incident publicly within ' + (f.ack - f.incident!) + ' minutes, ' : ''}${choiceTxt}${f.resolved !== undefined ? ' and restored service in ' + (f.resolved - f.incident!) + ' minutes' + (f.demoHit ? '' : ', before a key client demo') : ''}.${f.client !== undefined ? ' She wrote to the affected client directly during the incident.' : ''}${f.pm !== undefined ? ' She sent a blameless postmortem the same day.' : ''}`

  const ev = (t: number, text: string, src: string) => ({ t, time: clock(t), text, src })
  const comps: { name: string; level: string; ev: ReturnType<typeof ev>[] }[] = []
  const comp = (name: string, score: number, e: ReturnType<typeof ev>[]) => { if (e.length) comps.push({ name, level: levelOf(b.scores[score][1]), ev: e.sort((x, y) => x.t - y.t) }) }
  const ir = []
  if (f.ack !== undefined) ir.push(ev(f.ack, '“' + f.ackText + '”', 'Teams'))
  if (f.choice) ir.push(ev(f.choiceAt!, f.choice === 'revert' ? 'Rolled back auth-api to known-good 7c19e02' : 'Patched forward: cookie fallback, c83d1b7', f.choice === 'revert' ? 'PR #1183' : 'PR #1184'))
  if (f.resolved !== undefined) ir.push(ev(f.resolved, 'Service restored after ' + (f.resolved - f.incident!) + ' min', 'INC-37'))
  comp('Incident response', 1, ir)
  const cm = []
  if (f.client !== undefined) cm.push(ev(f.client, '“' + f.clientText!.split('\n')[0].slice(0, 150) + (f.clientText!.length > 150 ? '…' : '') + '”', 'Email to Northwind'))
  if (f.pm !== undefined) cm.push(ev(f.pm, 'Same-day blameless postmortem with action items', 'Postmortem'))
  if (f.assignAck !== undefined) cm.push(ev(f.assignAck, 'Confirmed ownership and timeline for LED-214', 'Email to manager'))
  comp('Communication', 2, cm)
  const cl = []
  if (f.leo === 'helped') cl.push(ev(f.leoAt!, 'Unblocked a teammate on the auth test workflow', 'Teams DM'))
  if (f.danielAsked !== undefined) cl.push(ev(f.danielAsked, 'Asked the senior engineer for input', 'Teams DM'))
  if (f.readTeam !== undefined) cl.push(ev(f.readTeam, 'Read team context in #team', 'Teams'))
  comp('Collaboration', 3, cl)
  const cd = []
  if (f.deploy !== undefined) cd.push(ev(f.deploy, 'Fixed the SSO expiry bug; change also broke the password path', 'PR #1182'))
  if (f.ranTests !== undefined) cd.push(ev(f.ranTests, 'Ran the auth suite before deploying (18/18)', 'VS Code terminal'))
  comp('Code change & testing', 0, cd)

  const arts: { kind: string; id: string; title: string; meta: string; status: string }[] = []
  if (f.deploy !== undefined) arts.push({ kind: 'PR', id: '#1182', title: 'fix(auth): read session token from Authorization header', meta: '+4 −2 · deployed ' + clock(f.deploy) + ' · a41f9c2', status: f.choice === 'revert' ? 'Reverted' : f.choice === 'patch' ? 'Amended' : 'Live' })
  if (f.choice === 'revert') arts.push({ kind: 'PR', id: '#1183', title: 'Revert “fix(auth): read session token from Authorization header”', meta: 'rollback to 7c19e02 · ' + clock(f.choiceAt!), status: 'Merged' })
  if (f.choice === 'patch') arts.push({ kind: 'PR', id: '#1184', title: 'fix(auth): fall back to session cookie when no bearer header', meta: '+2 −1 · no new tests · ' + clock(f.choiceAt!), status: 'Merged' })
  if (f.incident !== undefined) arts.push({ kind: 'Incident', id: 'INC-37', title: 'Password logins failing on auth-api', meta: 'SEV-2 · ' + ((f.resolved ?? m) - f.incident) + ' min · ' + (f.resolved !== undefined ? 'resolved' : 'open at end of shift'), status: f.resolved !== undefined ? 'Resolved' : 'Open' })
  if (f.pm !== undefined) arts.push({ kind: 'Doc', id: 'PM-0929', title: 'Postmortem: auth-api password logins', meta: f.pmText!.split('\n')[0].slice(0, 120), status: 'Sent' })
  if (f.client !== undefined) arts.push({ kind: 'Email', id: '', title: 'Incident update to Northwind Freight', meta: 'Sent ' + clock(f.client) + ' during the incident', status: 'Sent' })

  return { summary, comps, growth: growth.slice(0, 3).map(g => ({ title: g.title, senior: g.senior || g.detail })), arts, events: 20 + Object.keys(f).length * 3, window: b.window }
}
