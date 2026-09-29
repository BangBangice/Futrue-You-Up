// Self-check for the shift logic: plays the "ship it, break prod, roll back" path headlessly.
// Run with: npm run check
import assert from 'node:assert/strict'
import { Sim, errAt } from './engine.ts'
import { buildDebrief, buildReport } from './debrief.ts'
import { CODE, FILES } from './data.ts'
import { DOCS } from './docs.ts'

const sim = new Sim()
sim.timeScale = 0.001
const settle = () => new Promise(r => setTimeout(r, 40))
const ticks = (n: number) => { for (let i = 0; i < n; i++) sim.tick() }
const ticket = (id: string) => sim.state.tickets.find(t => t.id === id)!

sim.start()
assert.equal(sim.state.stage, 'sim')
ticks(3)
assert.equal(sim.state.chats.team.at(-1)!.who, 'daniel', 'Daniel warns about verifySession at +1')
assert.deepEqual(sim.state.chats.team.at(-1)!.files!.map(a => a.kind), ['code', 'doc'], 'his warning links the file and the wiki page')
assert.equal(sim.state.unreadChat.leo, 2, 'Leo asks for help at +3')

// Outlook: reply with an attachment
sim.openMail('e1')
sim.reply()
sim.set({ mailDraft: 'On it, fix out before 2:30.', mailFiles: [{ kind: 'code', file: 'vs' }] })
sim.sendMail()
assert.equal(sim.state.compose, null, 'sending closes the editor')
assert.deepEqual([sim.state.emails[0].folder, sim.state.emails[0].subject, sim.state.emails[0].files.length], ['sent', 'Re: LED-214: SSO users logged out after ~1 hour', 1])
assert.equal(sim.state.emails.find(e => e.id === 'e1')!.thread.length, 1)
assert.equal(sim.state.f.assignAck, sim.state.simMin, 'replying to the assignment counts')

// Outlook: filing
sim.moveMail('e3', 'archive')
assert.equal(sim.state.emails.find(e => e.id === 'e3')!.folder, 'archive')
sim.openMail('e2'); sim.moveMail('e2', 'deleted')
assert.equal(sim.state.mailSel, 'e4', 'deleting the open mail selects its neighbour')

// attachments open in the app they belong to
sim.openAttachment({ kind: 'doc', doc: 'auth' })
assert.deepEqual([sim.state.docPage, sim.state.wins.docs.open, sim.state.focus], ['auth', true, 'docs'])
sim.openAttachment({ kind: 'code', file: 'pw' })
assert.deepEqual([sim.state.codeFile, sim.state.f.viewPwd], ['pw', sim.state.simMin])
sim.openAttachment({ kind: 'ticket', id: 'LED-214' })
assert.equal(sim.state.focus, 'tracker')

// Teams: a message with only a file still sends
sim.openChat('leo')
sim.set({ chatFiles: [{ kind: 'doc', doc: 'tests' }] })
sim.sendChat()
assert.deepEqual([sim.state.chats.leo.at(-1)!.files!.length, sim.state.chatFiles.length, sim.state.f.leo], [1, 0, 'helped'])

sim.runTests()
await settle()
sim.deploy()
await settle()
assert.equal(sim.state.phase, 'deployed')
assert.equal(ticket('LED-214').status, 'done')

ticks(2)
assert.equal(sim.state.phase, 'incident', 'incident fires two minutes after the deploy')
assert.equal(sim.state.tickets[0].id, 'INC-37')
assert.ok(errAt(sim.state.f, sim.state.simMin + 3) > 30, 'error rate spikes')

sim.openChat('incidents')
sim.sendChat('Investigating, likely my deploy.')
assert.equal(sim.state.f.ack, sim.state.simMin)

// Outlook: a new message to the client counts the same as replying to her
ticks(9)
assert.ok(sim.state.emails.some(e => e.who === 'marta'), 'the client escalates at +9')
sim.newMail()
sim.set({ compose: { mode: 'new', to: 'marta lindqvist', subject: 'Sign-in issue' }, mailDraft: 'A deploy broke password sign-in. Rolling back now.' })
sim.sendMail()
assert.equal(sim.state.f.client, sim.state.simMin)
assert.equal(sim.state.emails[0].toName, 'Marta Lindqvist')

sim.revert()
assert.equal(sim.state.phase, 'recovering')
ticks(3)
assert.equal(sim.state.phase, 'resolved')
assert.equal(ticket('LED-214').reopened, true)
ticks(6)
assert.ok(errAt(sim.state.f, sim.state.simMin) < 5, 'error rate recovers')

sim.endShift()
const d = buildDebrief(sim.state)
assert.ok(d.items.some(i => i.title === 'Rolled back first, investigated after'))
assert.deepEqual(d.items.map(i => i.t), d.items.map(i => i.t).toSorted((a, b) => a - b), 'replay is chronological')
assert.ok(d.scores.every(([, v]) => v >= 12 && v <= 97))
assert.equal(d.stats[3].value, 'Held')
assert.match(buildReport(sim.state).summary, /rolled the change back and restored service in 12 minutes/)

// the wiki only points at files that exist
for (const doc of Object.values(DOCS)) for (const b of doc.blocks) {
  if ('files' in b) b.files.forEach(f => assert.ok(FILES[f] && (f === 'vs' || CODE[f]), doc.id + ' → ' + f))
  if ('pages' in b) b.pages.forEach(p => assert.ok(DOCS[p], doc.id + ' → ' + p))
}

sim.replay()
assert.equal(sim.state.stage, 'onboard')
assert.deepEqual(sim.state.f, {})
console.log('sim check passed')
