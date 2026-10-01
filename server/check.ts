// Plays a whole shift against the real server code, with the model stubbed out. Run with: npm run check
// Covers: the three code outcomes, the incident, the mentor, mail and chat, tickets and docs, the sandbox guards, scenario validation, and picking the scenario per run.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { allDone, done, plan, required, stepsFor } from '../shared/guide.ts'
import type { Facts } from '../shared/guide.ts'
import { INCIDENT_PHASES, Scenario, personalize } from '../shared/scenario.ts'
import { normalizeTags } from '../shared/tags.ts'
import { errAt, isOutage, minutes as minutesOf } from '../shared/types.ts'
import { heard } from './ai/llm.ts'
import * as director from './director.ts'
import { getLesson, lessonTags, listLessons } from './lessons.ts'
import { api, errors } from './routes.ts'
import { store } from './runs.ts'
import { conform } from './sandbox.ts'
import { loadScenario } from './scenarios.ts'
import { create, drop, find, roster } from './world.ts'

process.env.LLM = 'stub'
// This check reads .data/ directly. npm run check:db covers Postgres.
delete process.env.DATABASE_URL
process.env.OPENAI_API_KEY = 'must-never-reach-player-code'
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
const s = await create('newgrad', 'Six years as a hospital pharmacist', 4, 'stub')
s.timeScale = 0.001
const events: { event: string; data: any }[] = []
s.clients.add({ write: (f: string) => { const [e, d] = f.trim().split('\n'); if (e.startsWith('event:')) events.push({ event: e.slice(7), data: JSON.parse(d.slice(6)) }) } } as any)
await director.start(s)

const ticks = (n: number) => { for (let i = 0; i < n; i++) director.tick(s) }
const sh = (cmd: string) => director.command(s, cmd)
const out = () => s.world.term.map(l => l.t).join('\n')
const daniel = () => s.world.chats.daniel.filter(m => m.who === 'daniel')
const ticket = (id: string) => s.world.tickets.find(t => t.id === id)!
const incident = () => s.world.incident
const vs = 'src/auth/verifySession.ts'
const original = await s.ws.read(vs)
const edit = (to: string) => director.saveFile(s, vs, original.replace("  const token = req.cookies[SESSION_COOKIE]\n", to))
const NAIVE = "  const header = req.headers['authorization'] ?? ''\n  const token = header.replace(/^Bearer\\s+/i, '')\n"
const CORRECT = "  const header = req.headers['authorization'] ?? ''\n  const token = header.replace(/^Bearer\\s+/i, '') || req.cookies[SESSION_COOKIE]\n"
/** The step list as the browser would show it now: the phase, and each step's id with a tick. */
const guideNow = (x = s, extra = {}) => { const p = plan({ ...x.world, seen: x.priv.f.seen, ...extra }, x.world.phases, x.world.level); return { ...p, ticks: Object.fromEntries(p.steps.map(t => [t.id, t.done])) } }

// ---- the world at 1:10 PM
assert.equal(s.world.code.branch, 'maya/led-214-sso-expiry')
assert.ok(s.world.files.includes(vs))
assert.deepEqual(s.world.deploys[0].checks.filter(c => !c.ok).map(c => c.id), ['sso_after_refresh'], 'production starts with the LED-214 bug and nothing else')
assert.ok(!s.world.deploys[0].checks.some(c => c.id.startsWith('rejects')), 'security verdicts are never sent to the browser')
assert.ok(!JSON.stringify(s.world.impact).includes('rejects'), 'nor are the security checks themselves')
assert.ok(!isOutage(s.scenario, s.world.deploys[0].checks))

ticks(3)
assert.equal(s.world.chats.team.at(-1)!.who, 'daniel', 'Daniel warns about verifySession at +1')
assert.equal(s.world.unread.leo, 2, 'Leo asks for help at +3')
director.seen(s, 'chan:team')
assert.equal(s.priv.f.readWarningAt, s.world.simMin)
assert.deepEqual([guideNow().phase, guideNow().title, guideNow().ticks.leo], ['ticket', 'Fix LED-214', false], 'the opening phase, with Leo’s question waiting')
assert.match(guideNow().sub, /Priya wants it fixed before the 3:00 PM demo/, 'names and the deadline are filled in')
assert.deepEqual(guideNow().map.map(p => `${p.id}:${p.state}`), ['ticket:current', 'deployed:upcoming', 'incident:upcoming', 'after:upcoming', 'shipped:upcoming'])

// ---- mail and chat
director.mail(s, { mode: 'reply', ref: 'e1', text: 'On it, fix out before 2:30.', files: [{ kind: 'code', path: vs }] })
assert.deepEqual([s.world.emails[0].folder, s.world.emails[0].subject, s.world.emails[0].files.length], ['sent', 'Re: LED-214: SSO users logged out after ~1 hour', 1])
assert.equal(s.priv.f.assignAckAt, s.world.simMin)
director.chat(s, 'leo', 'npm test -- src/auth runs just the auth suite', [{ kind: 'doc', doc: 'tests' }])
assert.equal(s.priv.f.leo, 'helped')
assert.equal(guideNow().ticks.leo, true, 'answering Leo ticks his question off')
await settle()
assert.match(s.world.chats.leo.at(-1)!.text, /thank you/, 'scripted reply when the model is unavailable')
director.patchMail(s, 'e3', { folder: 'archive', flagged: true })
assert.equal(s.world.emails.find(e => e.id === 'e3')!.folder, 'archive')

// ---- tickets and docs
director.saveTicket(s, 'LED-214', { status: 'progress' })
assert.equal(ticket('LED-214').status, 'progress')
const made = director.saveTicket(s, undefined, { title: 'Add a password-path test for verifySession' })
assert.equal(made, 'LED-218')
director.comment(s, 'LED-214', 'Reading the three login paths first.')
assert.equal(ticket('LED-214').comments.at(-1)!.who, 'maya')
const page = director.saveDoc(s, undefined, { title: 'Notes on LED-214', group: 'Auth', body: '# Notes\n\nPassword login sets a cookie.' })
director.saveDoc(s, page, { title: 'Notes on LED-214', group: 'Auth', body: '# Notes\n\nUpdated.' })
assert.deepEqual([s.world.docs.find(d => d.id === page)!.version, s.world.docs.find(d => d.id === page)!.owner], [2, 'maya'])

// ---- the terminal refuses what it should
for (const cmd of ['cat ../../../.env', 'git commit -F ../../../.env', 'git -c core.pager=x status', 'git push origin main', 'npm install left-pad', 'node -e 1', 'npm test; ls', 'curl https://example.com', 'ldg deploy auth-api']) {
  const before = s.world.term.length
  await sh(cmd)
  assert.equal(s.world.term.slice(before).filter(l => l.c === 'err').length, 1, `${cmd} should be refused with one message`)
}
await assert.rejects(s.ws.read('../../../.env'), /outside the project/)
await assert.rejects(s.ws.write('.git/hooks/pre-commit', 'x'), /managed for you/)

// ---- outcome 1: the naive fix. Tests pass, production does not.
await edit(NAIVE)
assert.deepEqual(s.world.code.changes, [{ status: 'M', path: vs }])
await sh('npm test -- src/auth')
assert.match(out(), /pass 12/)
assert.equal(s.priv.f.testsPassed, true, 'the trap: the suite is green')
await sh('ldg deploy auth-api --env prod')
assert.match(out(), /uncommitted changes/, 'deploy refuses a dirty tree')
await sh('git commit -am "fix(auth): read session token from Authorization header (LED-214)"')
const bad = s.world.code.head
assert.equal(s.world.code.changes.length, 0)
await sh('ldg deploy auth-api --env prod')
assert.equal(s.world.deploys.at(-1)!.sha, bad)
assert.equal(incident(), null, 'the alarm takes two minutes to fire')
assert.deepEqual([guideNow().phase, guideNow().ticks.deploy, guideNow().ticks.watch], ['deployed', false, false], 'deployed, and the ticket still open')
assert.equal(guideNow(s, { looking: ['monitor'] }).ticks.watch, true, 'CloudWatch on screen counts as watching it')
ticks(2)
assert.equal(incident()?.id, 'INC-37')
assert.equal(s.world.tickets[0].id, 'INC-37')
assert.ok(errAt(s.scenario, s.world.deploys, s.world.simMin + 3) > 30, 'error rate spikes')
assert.ok(s.world.emails.some(e => e.who === 'jira' && e.subject.includes('INC-37')), 'Jira notifies by email')

// ---- the mentor steps in at once, with facts, and then coaches
const first = daniel().at(-1)!
assert.match(first.text, /email \+ password login/)
assert.match(first.text, /ldg rollback auth-api/, 'a new grad is told the next step')
assert.match(first.text, /Northwind/)
await settle(120)
const coached = daniel().at(-1)!
assert.ok(coached.coach?.why.includes('cookie') && coached.coach.blast.includes('1,340'), 'coaching explains the cause and the blast radius')

assert.deepEqual([guideNow().phase, guideNow().ticks.ack, guideNow().ticks.rollback], ['incident', false, false], 'the incident outranks the deploy')
assert.equal(guideNow().map.find(p => p.id === 'deployed')!.state, 'past')
director.chat(s, 'incidents', 'Investigating login failures. Likely my 2:17 deploy. Rolling back now, update in 10 min.', [])
assert.equal(s.priv.f.ackAt, s.world.simMin)
assert.equal(guideNow().ticks.ack, true)
ticks(9)
assert.ok(s.world.emails.some(e => e.who === 'marta'), 'the client escalates at +9')
director.mail(s, { mode: 'new', to: 'marta lindqvist', subject: 'Sign-in issue', text: 'Hi Marta, a change we deployed broke email and password sign-in. I am sorry. We are rolling it back now and I will update you within 15 minutes.', files: [] })
assert.equal(s.priv.f.clientAt, s.world.simMin, 'a new message to the client counts the same as a reply')

await sh('ldg rollback auth-api')
assert.equal(s.world.deploys.at(-1)!.kind, 'rollback')
assert.equal(ticket('LED-214').reopened, undefined, 'LED-214 was never closed, so it is not reopened')
ticks(2)
assert.ok(incident()!.resolvedAt, 'the incident resolves once the rollback has rolled out')
assert.deepEqual([guideNow().phase, guideNow().sub, guideNow().ticks.deploy], ['after', 'Close out the incident, then fix LED-214 for real.', false], 'service is back, the ticket is not')
assert.deepEqual(guideNow().map.map(p => p.state), ['past', 'past', 'past', 'current', 'upcoming'], 'the incident happened')
assert.equal(ticket('INC-37').status, 'done')
ticks(6)
assert.ok(errAt(s.scenario, s.world.deploys, s.world.simMin) < 5, 'error rate recovers')
await settle(120)
assert.match(daniel().map(m => m.text).join('\n'), /Rolling back first was the right call/)

// ---- outcome 2: opening a door. Dashboards stay green, so only the mentor notices.
await director.saveFile(s, vs, original.replace('export async function verifySession(req: Request): Promise<Session> {', 'export async function verifySession(req: Request): Promise<Session> {\n  if (req) return { ok: true, userId: "u", org: "o" }'))
await sh('git commit -am "fix(auth): always accept"')
await sh('ldg deploy auth-api --env prod')
assert.deepEqual([guideNow().phase, guideNow().ticks.deploy, guideNow().ticks.edit], ['after', true, false], 'a deploy after the rollback ticks off, and the next change starts over')
ticks(3)
assert.ok(incident()!.resolvedAt, 'no alarm fires for a security hole')
await settle(120)
assert.match(daniel().map(m => m.text).join('\n'), /CloudWatch is green .* and that is the problem/)
await sh('ldg rollback auth-api')

// ---- outcome 3: code that does not start never ships
await director.saveFile(s, vs, original.replace('const claims', 'const claims ='))
await sh('git commit -am "wip"')
const live = s.world.deploys.length
await sh('ldg deploy auth-api --env prod')
assert.equal(s.world.deploys.length, live, 'a broken build changes nothing in production')
assert.match(out(), /build failed/)

// ---- outcome 4: the correct fix, and the loop closes
await edit(CORRECT)
await sh('npm test')
await sh('git commit -am "fix(auth): read bearer header, fall back to session cookie (LED-214)"')
await sh('ldg deploy auth-api --env prod')
ticks(3)
assert.deepEqual(s.world.deploys.at(-1)!.checks.filter(c => !c.ok), [])
assert.equal(ticket('LED-214').status, 'done')
assert.ok(incident()!.resolvedAt, 'no new incident')
assert.deepEqual([guideNow().phase, guideNow().sub, 'deploy' in guideNow().ticks], ['after', 'Close out the incident.', false], 'fixed, but the postmortem is still owed')
const pmDoc = { id: 'pm', title: 'Postmortem: INC-37', group: 'Incidents', owner: 'maya', updated: 'today', body: '', version: 1 }
const shipped = guideNow(s, { docs: [...s.world.docs, pmDoc] })
assert.deepEqual([shipped.phase, shipped.ready, shipped.steps.map(x => x.id)], ['shipped', true, ['watch', 'tell', 'finish']], 'with the postmortem written, it is shipped and can end')
await settle(120)
assert.match(daniel().map(m => m.text).join('\n'), /Every login path is healthy/)

// ---- the stream and the snapshot agree
const rebuilt = events.filter(e => e.event === 'patch').reduce((w, e) => ({ ...w, ...e.data.patch }), {} as any)
for (const k of Object.keys(rebuilt)) assert.deepEqual(rebuilt[k], (s.world as any)[k], `patches rebuild world.${k}`)
assert.deepEqual(events.map(e => e.data.seq), events.map((_, i) => i + 1), 'every event is numbered in order')

// ---- end of shift: a recap, no numbers to be graded by
await director.end(s)
const recap = s.world.recap!
assert.equal(recap.finished, true, 'the fix shipped and every check passes')
assert.deepEqual(s.world.lesson, { id: s.scenario.id, title: s.scenario.title, summary: s.scenario.summary ?? null }, 'the shift knows its lesson')
assert.ok(recap.ready && recap.note && recap.next.length >= 2 && recap.happened.length >= 8)
assert.ok(!/score|\/100|grade|rating|\d+%/i.test(JSON.stringify([recap.note, recap.corrected, recap.next])), 'the recap does not grade')
assert.ok(recap.happened.some(l => /Rolled production back/.test(l)) && recap.happened.some(l => /INC-37 opened/.test(l)))

// ---- nothing leaked, nothing escaped
assert.ok(!JSON.stringify(s.world).includes('must-never-reach'), 'the key is not in the world')
assert.equal(execFileSync('git', ['check-ignore', '.env', '.data'], { cwd: new URL('..', import.meta.url).pathname }).toString().trim(), '.env\n.data')
assert.ok(!readFileSync(new URL('../.data/sessions/' + s.world.id + '/events.jsonl', import.meta.url), 'utf8').includes('must-never-reach'))

// ---- scenario files: broken references are refused before a shift can start
const good = loadScenario('ledgerly-day2')
const broken = (edit: (s: any) => void) => { const c = structuredClone(good) as any; edit(c); const r = Scenario.safeParse(c); return r.success ? [] : r.error.issues.map(i => i.message) }
assert.deepEqual(broken(() => {}), [])
assert.deepEqual(broken(c => { c.seed.emails[0].files[0].id = 'LED-999' }), ['no ticket with id "LED-999"'])
assert.deepEqual(broken(c => { c.seed.docs[0].body += ' [x](doc:nope)' }), ['links to missing doc "nope"'])
assert.deepEqual(broken(c => { c.seed.tickets[1].id = 'LED-214' }), ['duplicate ticket id "LED-214"'])
assert.deepEqual(broken(c => { c.seed.emails[0].who = 'nobody' }), ['no cast member with id "nobody"'])
assert.deepEqual(broken(c => { c.seed.tickets[0].comments.push({ who: 'nobody', time: '1:00 PM', text: 'hi' }) }), ['no cast member with id "nobody"'])
assert.deepEqual(broken(c => { delete c.seed.chats.leo }), ['missing channel "leo"'])
assert.deepEqual(broken(c => { c.seed.unread.random = 0 }), ['no channel with id "random"'])
const warning = (c: any) => c.triggers.find((t: any) => t.id === 'daniel_warning')
assert.deepEqual(broken(c => { warning(c).do[1].post.chan = 'random' }), ['no channel with id "random"'])
assert.deepEqual(broken(c => { warning(c).do[1].post.who = 'nobody' }), ['no cast member with id "nobody"'])
assert.deepEqual(broken(c => { warning(c).do[0].flag = 'mood' }), ['no flag "mood"'])
assert.deepEqual(broken(c => { warning(c).if = { any: [{ flag: 'mood', set: true }] } }), ['no flag "mood"'])
assert.deepEqual(broken(c => { warning(c).do[1].post.text += ' {{mood}}' }), ['unknown placeholder "{{mood}}"'])
assert.deepEqual(broken(c => { warning(c).do[1].post.files = [{ kind: 'doc', doc: 'nope' }] }), ['no doc with id "nope"'])
assert.deepEqual(broken(c => { warning(c).do.push({ flag: 'warnedAt', post: warning(c).do[1].post }) }), ['an action needs exactly one of post, mail, flag'])
assert.deepEqual(broken(c => { warning(c).if = { incident: 'still-open' } }), ['"incident": "still-open" only applies to triggers on incident.opened'])
assert.deepEqual(broken(c => { c.triggers.push(warning(c)) }), ['duplicate trigger id "daniel_warning"'])
assert.deepEqual(broken(c => { c.cast.leo.persona.can.push('deploy') }), ['no tool "deploy"'])
assert.deepEqual(broken(c => { c.cast.leo.persona.can = ['send_teams_message'] }), ['a persona must be able to do_nothing'])
assert.deepEqual(broken(c => { c.cast.leo.persona.rooms.push('random') }), ['no channel with id "random"'])
assert.deepEqual(broken(c => { c.mentor = 'nobody' }), ['no cast member with id "nobody"'])
assert.deepEqual(broken(c => { c.mentor = 'sam' }), ['the mentor needs a DM channel with id "sam"'])
assert.deepEqual(broken(c => { c.checks[1].id = 'password_login' }), ['duplicate check id "password_login"'])
assert.deepEqual(broken(c => { c.checks[0].share = -1 }), ['a share cannot be negative'])
assert.deepEqual(broken(c => { c.checks[4].share = 2 }), ['a security check fails silently, so its share must be 0'])
assert.deepEqual(broken(c => { c.clock.deadline = '1:00 PM' }), ['the deadline must be after the start'])
assert.deepEqual(broken(c => { c.clock.start = '13:10' }), ['a time like "1:10 PM"'])
assert.deepEqual(broken(c => { delete c.clock.deadline }), ['uses the demo, so the clock needs a deadline', 'uses the demo, so the clock needs a deadline', '{{deadline}} needs the clock to have a deadline'])
const step = (c: any, id: string) => c.phases[0].steps.find((g: any) => g.id === id)
assert.deepEqual(broken(c => { step(c, 'read').doneWhen = { mailOpened: 'e1' } }), ['Unrecognized key: "mailOpened"', 'a step condition needs exactly one of all, any, not, mailRead, mailReplied, ticket, commented, posted, channelRead, openedDoc, openedFile, code, deployed, redeployed, git, ran, incident, watched, postmortem, ended, stepsDone'])
assert.deepEqual(broken(c => { step(c, 'team').doneWhen.all[1] = { channelRead: 'random' } }), ['no channel with id "random"'])
assert.deepEqual(broken(c => { step(c, 'wiki').doneWhen = { not: { openedDoc: 'nope' } } }), ['no doc with id "nope"'])
assert.deepEqual(broken(c => { step(c, 'ticket').showMe = { ticket: 'LED-999' } }), ['no ticket with id "LED-999"'])
assert.deepEqual(broken(c => { step(c, 'wiki').levels = ['intern'] }), ['no level "intern"'])
assert.deepEqual(broken(c => { step(c, 'read').showMe = { mail: 'e1', doc: 'auth' } }), ['a show-me target needs exactly one of mail, reply, ticket, chat, doc, file, edit, vscode, monitor, finish'])
assert.deepEqual(broken(c => { step(c, 'read').text += ' {{mood}}' }), ['unknown placeholder "{{mood}}"'])
assert.deepEqual(broken(c => { step(c, 'read').text += ' {{from}}' }), ['unknown placeholder "{{from}}"'], '{{from}} only in a step with each')
assert.deepEqual(broken(c => { delete step(c, 'read').doneWhen }), ['a step needs doneWhen (only a step with "each" has its own)'])
assert.deepEqual(broken(c => { c.phases[0].side[0].if.posted.match = '(' }), ['not a valid regular expression'])
assert.deepEqual(broken(c => { c.phases[0].when = { deployed: true } }), ['the first phase has no "when": it is where the lesson starts'])
assert.deepEqual(broken(c => { c.phases[2].id = 'ticket' }), ['duplicate phase id "ticket"'])
assert.deepEqual(broken(c => { c.phases[4].steps[1].doneWhen.posted.after.who = 'nobody' }), ['no cast member with id "nobody"'])
assert.deepEqual(broken(c => { c.guide = [step(c, 'read')] }), ['give the steps as phases or as guide, not both: guide is the older form of the first phase'])
assert.deepEqual(broken(c => { c.seed.chats.team[0].id = 100 }), ['seed message ids must be below 100'])
// The opening steps tick off from browser-side facts alone.
const facts = { ...structuredClone(good.seed), player: good.player, code: { branch: '', head: '', subject: '', changes: [], busy: null }, deploys: [], seen: ['doc:auth'] }
const ticked = () => stepsFor(good.phases[0].steps, 'newgrad').filter(g => done(facts, g.doneWhen!)).map(g => g.id)
assert.deepEqual(ticked(), ['wiki'])
facts.emails[0].read = true
facts.tickets.find(t => t.id === 'LED-214')!.status = 'progress'
assert.deepEqual(ticked(), ['read', 'ticket', 'wiki'])
assert.deepEqual(stepsFor(good.phases[0].steps, 'bootcamp').map(g => g.id).filter(id => id === 'wiki' || id === 'password'), [], 'only new grads get the extra steps')
// A deploy that does not close the ticket: the list says so, and "Deploy the new version" ticks off rather than coming back forever.
const retry: Facts = { ...facts, cast: good.cast, mentor: good.mentor, deploys: [{ sha: 'base', at: 0, by: 'daniel', kind: 'deploy', checks: [] }] }
const deploy = (sha: string) => { retry.code = { ...retry.code, head: sha }; retry.deploys = [...retry.deploys, { sha, at: 0, by: 'maya', kind: 'deploy', checks: [] }] }
const now = () => { const p = plan(retry, good.phases, 'bootcamp'); return [p.phase, p.sub, p.steps.find(x => x.id === 'deploy')!.done] }
deploy('a1')
assert.deepEqual(now(), ['deployed', 'Jira still shows LED-214 as open. See what production says.', false])
retry.code = { ...retry.code, head: 'b2' }
assert.deepEqual(now(), ['deployed', 'Jira still shows LED-214 as open. See what production says.', false], 'a new commit waits for its deploy')
deploy('b2')
assert.deepEqual(now(), ['deployed', 'That deploy didn’t close LED-214 either, so it stays open. See what production says, then change the code and deploy again.', true], 'the second deploy is done, and honest about the ticket')
retry.code = { ...retry.code, changes: [{ status: 'M', path: vs }] }
assert.equal(now()[2], false, 'new work to ship: the next deploy is the step')
// Phases are data. A spec saved before they were, with only guide, plays as the engine did then: the incident shift gets its own
// opening steps and Ledgerly's later phases, and a lesson with a goal becomes one phase that ends by finishing.
const { phases: _p, ...ledgerlyOld } = structuredClone(good) as any
const old = Scenario.parse({ ...ledgerlyOld, guide: good.phases[0].steps })
assert.deepEqual(old.phases, good.phases, 'an incident spec without phases gets Ledgerly’s')
assert.deepEqual(INCIDENT_PHASES.map(p => p.id), ['deployed', 'incident', 'after', 'shipped'])
assert.ok(!('guide' in old), 'guide is read into phases, not kept beside them')
const git = loadScenario('git-101'), { phases: gp, ...gitOld } = structuredClone(git) as any
const oldGit = Scenario.parse({ ...gitOld, guide: gp[0].steps.filter((x: any) => x.id !== 'finish') })
assert.deepEqual([oldGit.phases.length, oldGit.phases[0].title, oldGit.phases[0].steps.at(-1)!.id], [1, git.goal!.title, 'finish'])
const gitFacts = { ...structuredClone(git.seed), player: 'maya', code: { branch: 'main', head: 'x', subject: '', changes: [], busy: null }, deploys: [], seen: [] }
assert.deepEqual([allDone(gitFacts, oldGit.phases, 'newgrad'), required(gitFacts, oldGit.phases, 'newgrad').map(x => x.id)], [false, required(gitFacts, git.phases, 'newgrad').map(x => x.id)], 'the same steps decide it')
// The hidden harness is code: if it and the scenario disagree about which checks exist, the build counts as broken.
const ids = good.checks.map(c => c.id), verdict = { build: 'ok' as const, checks: ids.map(id => ({ id, ok: true, reason: '' })) }
assert.equal(conform(verdict, ids), verdict)
assert.match(conform(verdict, [...ids.slice(1), 'new_check']).error ?? '', /missing new_check; unexpected password_login/)
// Versions stored before personas were data must not parse, so runs fall back to the file rather than lose every AI colleague.
assert.ok(broken(c => { delete c.mentor }).length)
// Nor those stored before the clock, checks and customers were, so they fall back to the file too.
assert.ok(broken(c => { delete c.checks; delete c.customers }).length)

// ---- the player is whoever is playing. Without accounts, the scenario's own player; a guest keeps their whole made-up name.
assert.ok(!JSON.stringify(s.world).includes('{{player}}'), 'no {{player}} left in the world')
assert.equal(s.world.emails.find(e => e.id === 'e1')!.body[0], 'Hi Maya,')
const guest = personalize(good, { name: 'Happy Mango', short: 'Happy Mango' }), named = personalize(good, { name: 'Jimmy Lee' })
assert.deepEqual([guest.cast.maya.name, guest.cast.maya.init, guest.cast.maya.email], ['Happy Mango', 'HM', 'happy.mango@ledgerly.io'])
assert.equal(guest.seed.emails.find(e => e.id === 'e1')!.body[0], 'Hi Happy Mango,')
assert.equal(named.seed.emails.find(e => e.id === 'e1')!.body[0], 'Hi Jimmy,')
assert.match(named.cast.daniel.persona!.knows, /Jimmy’s mentor/)
assert.ok(!JSON.stringify(named).includes('{{player}}') && !/Maya/.test(JSON.stringify({ ...named, cast: { ...named.cast, maya: null } })), 'no Maya left once someone else plays')

// ---- the scenario is picked per run, by id, and a reloaded run keeps its own
await assert.rejects(create('newgrad', '', 4, 'stub', null, undefined, 'nope'), /No scenario "nope"/)
const picked = await create('bootcamp', '', 4, 'stub', null, undefined, 'ledgerly-day2')
assert.equal(picked.scenario.id, 'ledgerly-day2')
assert.equal(await picked.flush(), true)
const saved = new URL('../.data/sessions/' + picked.world.id + '/session.json', import.meta.url)
assert.equal(JSON.parse(readFileSync(saved, 'utf8')).scenario, 'ledgerly-day2', 'the file store saves the scenario id')
await drop(picked.world.id)
const reloaded = (await find(picked.world.id))!
assert.notEqual(reloaded, picked, 'reloaded, not the cached object')
assert.deepEqual(reloaded.scenario, picked.scenario, 'the run reloads on its own scenario')
// Runs saved before the id was, or whose scenario file has since gone, play the default.
const { world: w0, priv: p0 } = JSON.parse(readFileSync(saved, 'utf8'))
for (const scenario of [undefined, 'gone']) {
  writeFileSync(saved, JSON.stringify({ scenario, world: w0, priv: p0 }))
  assert.equal((await store().loadRun(picked.world.id, reloaded.dir))!.scenario.id, 'ledgerly-day2')
}
await drop(picked.world.id)
// The routes check the id before anything starts.
const server = express().use(express.json(), api, errors).listen(0)
await once(server, 'listening')
const base = `http://localhost:${(server.address() as AddressInfo).port}`
assert.deepEqual(await (await fetch(base + '/scenario')).json(), JSON.parse(JSON.stringify(roster(good))), 'the default scenario without an id')
assert.deepEqual(await (await fetch(base + '/scenario?id=ledgerly-day2')).json(), JSON.parse(JSON.stringify(roster(good))))
assert.equal((await fetch(base + '/scenario?id=nope')).status, 404)
const refused = await fetch(base + '/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'newgrad', scenario: 'nope' }) })
assert.equal(refused.status, 400)
assert.match((await refused.json()).error, /scenario must be one of: .*ledgerly-day2/)
server.close()

// ---- the lesson library. Tags are cleaned one way everywhere; without a database the scenario files are the library.
assert.deepEqual(normalizeTags([' Incident Response', 'incident_response', 'C++', '---', 'x'.repeat(30), ...'bcdefgh']), ['incident-response', 'c', 'x'.repeat(24), 'b', 'd', 'e', 'f', 'g'])
assert.deepEqual(normalizeTags(['沟通', ' 团队 协作', 'Résumé', 'हिंदी', '한국어']), ['沟通', '团队-协作', 'resume', 'हिंदी', '한국어'], 'letters in any script are kept')
assert.equal(Scenario.parse({ ...good, tags: ['Engineering '] }).tags?.[0], 'engineering', 'a spec keeps its tags cleaned')
assert.deepEqual(roster(Scenario.parse({ ...good, story: { ...good.story, weekday: 'Friday', date: 'Mar 6', day: 4 } })).calendar, { weekday: 'Friday', date: 'Mar 6', day: 4, start: minutesOf(good.clock.start) }, 'the calendar is the scenario’s')
assert.deepEqual(roster(Scenario.parse({ ...good, story: { ...good.story, date: undefined, day: undefined } })).calendar, roster(good).calendar, 'a spec saved before the calendar was data gets Ledgerly’s')
assert.deepEqual(broken(c => { c.story.day = 6 }), ['Too big: expected number to be <=5'])
if (!process.env.DATABASE_URL) {
  const [lesson] = await listLessons({ tag: 'incident-response' })
  assert.deepEqual([lesson?.id, lesson?.author], ['ledgerly-day2', null], 'a built-in is a public lesson with no author')
  assert.deepEqual(await listLessons({ tag: 'no-such-tag' }), [])
  assert.ok((await lessonTags()).some(t => t.tag === 'communication' && t.count === 1))
  assert.deepEqual(await getLesson('ledgerly-day2', null), lesson, 'a built-in opens by id, as listed')
  assert.equal(await getLesson('no-such-lesson', null), null)
}

// ---- a lesson that renames everyone: the engine's own lines follow, so no old name reaches the browser or the model.
// Ids stay (the engine and the schema refer to them); every other string gets the new names, as a generated lesson would.
await s.stop()
// A stopped shift may be loaded again as a new Session. A model reply or timer that lands on the old one afterwards changes nothing.
const quiet = [events.length, s.world.chats.daniel.length, s.priv.events.length]
s.post('daniel', 'daniel', 'A reply that arrived after the shift stopped.')
s.mail({ who: 'marta', subject: 'Is the SSO login issue being addressed?', body: ['Late.'] })
s.later(0, () => s.post('daniel', 'daniel', 'A timer that fired after the shift stopped.'))
await settle()
assert.deepEqual([events.length, s.world.chats.daniel.length, s.priv.events.length], quiet, 'a stopped shift takes nothing more')
const OLD = ['northwindfreight', 'ledgerly', 'daniel', 'okafor', 'priya', 'raman', 'marta', 'lindqvist', 'leo', 'martins', 'maya', 'chen', 'sam', 'whitfield', 'northwind', 'osprey', 'brightline']
const NEW_ = ['kestrelhaul', 'quillstone', 'rosa', 'albescu', 'nadia', 'osei', 'ines', 'barros', 'theo', 'lund', 'kai', 'moreno', 'june', 'park', 'kestrel', 'pelican', 'clearwater']
const oldName = new RegExp(`(?<![a-z])(${OLD.join('|')})(?![a-z])`, 'gi')
const keep = new Set([...Object.keys(good.cast), ...Object.keys(good.channels)])
// Placeholders like {{priya}} are ids too.
const rename = (v: unknown): unknown => typeof v === 'string' ? (keep.has(v) ? v : v.split(/(\{\{\w+\}\})/).map((t, i) => i % 2 ? t : t.replace(oldName, m => { const n = NEW_[OLD.indexOf(m.toLowerCase())]; return m[0] === m[0].toUpperCase() ? n[0].toUpperCase() + n.slice(1) : n })).join(''))
  : Array.isArray(v) ? v.map(rename) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rename(x)])) : v
const renamed = Scenario.parse({ ...(rename(good) as object), workspace: { repo: 'books-api', host: 'quill-mbp-7' } })
assert.equal(renamed.cast.daniel.name, 'Rosa Albescu')
assert.equal(renamed.company.name, 'Quillstone')
const asked: string[] = []
heard.add(a => asked.push(`${a.system}\n${a.user}\n${JSON.stringify(a.tools)}`))
const r = await create('newgrad', 'Six years as a hospital pharmacist', 4, 'stub', null, undefined, { spec: renamed, version: 'renamed' })
r.timeScale = 0.001
await director.start(r)
const rt = (n: number) => { for (let i = 0; i < n; i++) director.tick(r) }
const rsh = (cmd: string) => director.command(r, cmd)
const rvs = await r.ws.read(vs)
rt(3)
director.seen(r, 'chan:team')
director.mail(r, { mode: 'reply', ref: 'e1', text: 'On it.', files: [] })
director.chat(r, 'leo', 'npm test -- src/auth runs just the auth suite', [])
director.chat(r, 'team', 'Rosa, where does the token come from?', [])
for (const cmd of ['pwd', 'npm test -- src/auth', 'git log', 'ldg status']) await rsh(cmd)
await director.saveFile(r, vs, rvs.replace('  const token = req.cookies[SESSION_COOKIE]\n', NAIVE))
await rsh('git commit -am "naive"')
await rsh('ldg deploy auth-api --env prod')
rt(2)
await rsh('ldg logs')
director.chat(r, 'incidents', 'Investigating, likely my deploy. Update in 10 min.', [])
rt(9)
director.mail(r, { mode: 'new', to: 'ines barros', subject: 'Sign-in issue', text: 'Sorry, we are rolling back. Update in 15 minutes.', files: [] })
while (r.world.simMin < minutesOf(renamed.clock.deadline!) + 1) rt(1)
assert.equal(r.world.demo, 'postponed', 'the deadline passes during the outage')
await rsh('ldg rollback auth-api')
rt(4)
director.saveDoc(r, undefined, { title: 'Postmortem: INC-37', group: 'Incidents', body: 'summary impact cause fix' })
await director.saveFile(r, vs, rvs.replace('  const token = req.cookies[SESSION_COOKIE]\n', CORRECT))
await rsh('git commit -am "fix"')
await rsh('ldg deploy auth-api --env prod')
rt(3)
await settle(200)
await director.end(r)
await settle(120)
const rterm = r.world.term.map(l => l.t).join('\n')
for (const want of ['/Users/kai/books-api', 'books-api@4.18.2 test', 'Author: Rosa Albescu <rosa@quillstone.io>', 'org=org_kestrel']) assert.ok(rterm.includes(want), `the terminal says ${want}`)
assert.ok(r.world.timeline.some(t => t.text === 'Kestrel demo postponed') && r.world.emails.some(e => e.subject === 'Kestrel demo postponed'))
// Every string the browser holds, terminal included, except the ids themselves, which step text names as {{id}} for the browser to fill.
const texts: string[] = []
const walk = (v: unknown) => { if (typeof v === 'string') { if (!keep.has(v)) texts.push(v) } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
walk(r.world)
const leaks = (where: string, all: string[]) => all.flatMap(t => [...t.replaceAll(/"(\w+)"|\{\{(\w+)\}\}/g, (q, a, b) => (keep.has(a ?? b) ? '' : q)).matchAll(oldName)].map(m => `${where}: …${t.slice(Math.max(0, m.index - 40), m.index + 40)}…`))
assert.ok(asked.length >= 8, 'the stub model was asked')
assert.deepEqual([...leaks('world', texts), ...leaks('prompt', asked)], [], 'no old name reaches the browser or the model')
r.stop()

// ---- a lesson with its own goal: Git 101, played through. No production, a remote that is played, and done when the steps are.
const g = await create('newgrad', '', 4, 'stub', null, { name: 'Sam Rivera' }, 'git-101')
g.timeScale = 0.001
await director.start(g)
const gsh = (cmd: string) => director.command(g, cmd)
const gout = () => g.world.term.map(l => l.t).join('\n')
const gsteps = () => required({ ...g.world, seen: g.priv.f.seen }, g.world.phases, g.world.level).filter(x => !x.done).map(x => x.id)
assert.deepEqual([g.world.goal?.title, g.world.code.branch, g.world.code.remote, g.world.deploys[0].checks], ['Your first commit, start to finish', 'main', ['main'], []], 'starts on main, cloned from origin, with no production')
assert.ok(!('priya' in g.world.cast) && Object.keys(g.world.cast).length === 2, 'only the player and one senior')
await gsh('ldg deploy auth-api --env prod')
assert.match(gout(), /no production to deploy to/)
director.seen(g, 'mail:e1')
await gsh('git status')
assert.match(gout(), /Your branch is up to date with 'origin\/main'/, 'main tracks origin/main, like a clone')
await gsh('git push origin nope')
assert.match(gout(), /src refspec nope does not match any/)
await gsh('git switch -c sam/readme')
assert.deepEqual([g.world.code.branch, gsteps().slice(0, 1)], ['sam/readme', ['edit']])
const readme = await g.ws.read('README.md')
await director.saveFile(g, 'README.md', readme.replace('Customers: Sam Whitfield.', 'Customers: Sam Whitfield. Onboarding questions: Sam.'))
await gsh('git diff')
assert.match(gout(), /\+.*Onboarding questions: Sam/)
await gsh('git add README.md')
assert.equal(g.world.code.staged, true)
await gsh('git commit -m "docs: add Sam to who to ask"')
assert.deepEqual([g.world.code.mine, g.world.code.staged], [1, false])
await gsh('git log --oneline')
await gsh('git push')
assert.match(gout(), /has no upstream branch[\s\S]*git push --set-upstream origin sam\/readme/, 'a first plain push explains -u')
await gsh('git push origin sam/readme:main')
assert.match(gout(), /Protected branch update failed/, 'main is protected')
await gsh('git push -u origin sam/readme')
assert.match(gout(), /\* \[new branch\]\s+sam\/readme -> sam\/readme[\s\S]*set up to track 'origin\/sam\/readme'/)
assert.deepEqual(g.world.code.remote, ['main', 'sam/readme'])
await gsh('git push')
assert.match(gout(), /Everything up-to-date/)
await gsh('git checkout main')
assert.ok(!(await g.ws.read('README.md')).includes('Onboarding questions'), 'main does not have the change')
assert.deepEqual(gsteps(), ['tell'])
assert.equal(g.priv.f.fixedAt, undefined)
assert.deepEqual([guideNow(g).phase, guideNow(g).ready, 'finish' in guideNow(g).ticks], ['goal', false, false], 'no finish step while a step is left')
director.chat(g, 'daniel', 'Pushed sam/readme!', [])
assert.deepEqual(gsteps(), [])
assert.deepEqual([guideNow(g).ready, guideNow(g).sub, guideNow(g).steps.filter(x => !x.side).at(-1)!.id], [true, 'Every step is done.', 'finish'], 'then the last step is finishing')
assert.ok(g.priv.f.fixedAt !== undefined && g.priv.events.some(e => e.type === 'goal'), 'every step done is noticed')
await settle(200)
assert.match(g.world.chats.daniel.filter(m => m.who === 'daniel').map(m => m.text).join('\n'), /Finish lesson/, 'the mentor says the lesson can end')
// The workspace comes back from a snapshot with origin and the upstream it had.
const packed = await g.ws.pack()
await director.end(g)
await settle(100)
assert.equal(g.priv.finished, true)
assert.ok(g.world.recap?.happened.some(l => l.includes('Pushed sam/readme to origin')), 'the recap tells the lesson')
const { Workspace } = await import('./sandbox.ts')
const { mkdtemp } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const again = await Workspace.open(await mkdtemp(tmpdir() + '/larp-'), g.world.cast.maya, { repo: 'ledgerly-api', author: g.world.cast.daniel, saved: async () => packed, remote: 'git@github.com:ledgerly/ledgerly-api.git' })
const said: string[] = []
await again.exec(['git', 'switch', 'sam/readme'], l => said.push(l.t))
await again.exec(['git', 'status'], l => said.push(l.t))
assert.match(said.join('\n'), /up to date with 'origin\/sam\/readme'/)
g.stop()

// ---- what kind of lesson a description asks for, and what a half-written one already says
const { kindOf, peek } = await import('./generate.ts')
assert.equal(kindOf('build a git usage 101 lessons, about how to commit, add, push, diff, branch, checkout'), 'practice')
assert.equal(kindOf('Writing a clear bug report for a teammate'), 'practice')
assert.equal(kindOf('An outage after a bad deploy, and the on-call engineer has to roll back'), 'incident')
assert.equal(kindOf('Retitle it', loadScenario('git-101')), 'practice', 'a revision keeps its kind')
const half = JSON.stringify(loadScenario('git-101'))
const cut = half.slice(0, half.indexOf('"id":"branch"') + 30)
assert.deepEqual(peek(cut), { title: 'Git 101: your first commit, start to finish', goal: 'Your first commit, start to finish', people: ['Maya Chen', 'Daniel Okafor'], emails: ['Your first change, start to finish'], steps: ['Read Daniel’s email with today’s plan', 'See where you are: run git status'] })
assert.deepEqual(peek(''), { title: undefined, goal: undefined, people: [], emails: [], steps: [] })

console.log(`server check passed · ${s.priv.events.length} events · ${events.length} stream messages`)
process.exit(0)
