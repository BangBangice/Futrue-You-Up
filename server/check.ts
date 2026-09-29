// Plays a whole shift against the real server code, with the model stubbed out. Run with: npm run check
// Covers: the three code outcomes, the incident, the mentor, mail and chat, tickets and docs, and the sandbox guards.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { errAt, isOutage } from '../shared/types.ts'
import * as director from './director.ts'
import { create } from './world.ts'

process.env.LLM = 'stub'
process.env.NVIDIA_API_KEY = 'must-never-reach-player-code'
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

// ---- the world at 1:10 PM
assert.equal(s.world.code.branch, 'maya/led-214-sso-expiry')
assert.ok(s.world.files.includes(vs))
assert.deepEqual(s.world.deploys[0].checks.filter(c => !c.ok).map(c => c.id), ['sso_after_refresh'], 'production starts with the LED-214 bug and nothing else')
assert.ok(!s.world.deploys[0].checks.some(c => c.id.startsWith('rejects')), 'security verdicts are never sent to the browser')
assert.ok(!isOutage(s.world.deploys[0].checks))

ticks(3)
assert.equal(s.world.chats.team.at(-1)!.who, 'daniel', 'Daniel warns about verifySession at +1')
assert.equal(s.world.unread.leo, 2, 'Leo asks for help at +3')
director.seen(s, 'chan:team')
assert.equal(s.priv.f.readWarningAt, s.world.simMin)

// ---- mail and chat
director.mail(s, { mode: 'reply', ref: 'e1', text: 'On it, fix out before 2:30.', files: [{ kind: 'code', path: vs }] })
assert.deepEqual([s.world.emails[0].folder, s.world.emails[0].subject, s.world.emails[0].files.length], ['sent', 'Re: LED-214: SSO users logged out after ~1 hour', 1])
assert.equal(s.priv.f.assignAckAt, s.world.simMin)
director.chat(s, 'leo', 'npm test -- src/auth runs just the auth suite', [{ kind: 'doc', doc: 'tests' }])
assert.equal(s.priv.f.leo, 'helped')
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
ticks(2)
assert.equal(incident()?.id, 'INC-37')
assert.equal(s.world.tickets[0].id, 'INC-37')
assert.ok(errAt(s.world.deploys, s.world.simMin + 3) > 30, 'error rate spikes')
assert.ok(s.world.emails.some(e => e.who === 'jira' && e.subject.includes('INC-37')), 'Jira notifies by email')

// ---- the mentor steps in at once, with facts, and then coaches
const first = daniel().at(-1)!
assert.match(first.text, /email \+ password login/)
assert.match(first.text, /ldg rollback auth-api/, 'a new grad is told the next step')
assert.match(first.text, /Northwind/)
await settle(120)
const coached = daniel().at(-1)!
assert.ok(coached.coach?.why.includes('cookie') && coached.coach.blast.includes('1,340'), 'coaching explains the cause and the blast radius')

director.chat(s, 'incidents', 'Investigating login failures. Likely my 2:17 deploy. Rolling back now, update in 10 min.', [])
assert.equal(s.priv.f.ackAt, s.world.simMin)
ticks(9)
assert.ok(s.world.emails.some(e => e.who === 'marta'), 'the client escalates at +9')
director.mail(s, { mode: 'new', to: 'marta lindqvist', subject: 'Sign-in issue', text: 'Hi Marta, a change we deployed broke email and password sign-in. I am sorry. We are rolling it back now and I will update you within 15 minutes.', files: [] })
assert.equal(s.priv.f.clientAt, s.world.simMin, 'a new message to the client counts the same as a reply')

await sh('ldg rollback auth-api')
assert.equal(s.world.deploys.at(-1)!.kind, 'rollback')
assert.equal(ticket('LED-214').reopened, undefined, 'LED-214 was never closed, so it is not reopened')
ticks(2)
assert.ok(incident()!.resolvedAt, 'the incident resolves once the rollback has rolled out')
assert.equal(ticket('INC-37').status, 'done')
ticks(6)
assert.ok(errAt(s.world.deploys, s.world.simMin) < 5, 'error rate recovers')
await settle(120)
assert.match(daniel().map(m => m.text).join('\n'), /Rolling back first was the right call/)

// ---- outcome 2: opening a door. Dashboards stay green, so only the mentor notices.
await director.saveFile(s, vs, original.replace('export async function verifySession(req: Request): Promise<Session> {', 'export async function verifySession(req: Request): Promise<Session> {\n  if (req) return { ok: true, userId: "u", org: "o" }'))
await sh('git commit -am "fix(auth): always accept"')
await sh('ldg deploy auth-api --env prod')
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
await settle(120)
assert.match(daniel().map(m => m.text).join('\n'), /Every login path is healthy/)

// ---- the stream and the snapshot agree
const rebuilt = events.filter(e => e.event === 'patch').reduce((w, e) => ({ ...w, ...e.data.patch }), {} as any)
for (const k of Object.keys(rebuilt)) assert.deepEqual(rebuilt[k], (s.world as any)[k], `patches rebuild world.${k}`)
assert.deepEqual(events.map(e => e.data.seq), events.map((_, i) => i + 1), 'every event is numbered in order')

// ---- end of shift: a recap, no numbers to be graded by
await director.end(s)
const recap = s.world.recap!
assert.ok(recap.ready && recap.note && recap.next.length >= 2 && recap.happened.length >= 8)
assert.ok(!/score|\/100|grade|rating|\d+%/i.test(JSON.stringify([recap.note, recap.corrected, recap.next])), 'the recap does not grade')
assert.ok(recap.happened.some(l => /Rolled production back/.test(l)) && recap.happened.some(l => /INC-37 opened/.test(l)))

// ---- nothing leaked, nothing escaped
assert.ok(!JSON.stringify(s.world).includes('must-never-reach'), 'the key is not in the world')
assert.equal(execFileSync('git', ['check-ignore', '.env', '.data'], { cwd: new URL('..', import.meta.url).pathname }).toString().trim(), '.env\n.data')
assert.ok(!readFileSync(new URL('../.data/sessions/' + s.world.id + '/events.jsonl', import.meta.url), 'utf8').includes('must-never-reach'))

s.stop()
console.log(`server check passed · ${s.priv.events.length} events · ${events.length} stream messages`)
process.exit(0)
