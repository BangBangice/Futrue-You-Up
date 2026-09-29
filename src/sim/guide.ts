// The step list in the top-left corner: what to do next, worked out from the state of the shift.
// Steps say what to do and where. They never say what the bug is: finding that out is the lesson.
// New grads also get the checks a senior would make first.
import { PEOPLE } from '../../shared/types.ts'
import type { AppId, ChanId, Email } from '../../shared/types.ts'
import { live, sim } from './store.ts'
import type { State } from './store.ts'

export interface Step {
  id: string; text: string; done: boolean
  /** One line of help, shown under the step you are on. */
  hint?: string
  /** Something that arrived and is waiting on you, rather than a step in the plan. */
  side?: boolean
  /** Brings the right window forward and flashes where to look. */
  show: () => void
}
export interface Guide { phase: string; title: string; sub: string; steps: Step[] }

const NEW = 100 // messages posted during the shift have ids above this; the seed uses 1–7
const VERIFY = 'src/auth/verifySession.ts', PASSWORD = 'src/auth/passwordLogin.ts'

// ---------- where "Show me" points ----------
const inApp = (app: AppId, ...keys: string[]) => () => { sim.open(app); sim.spotlight(keys, 'dock:' + app) }
const inCode = (side: 'files' | 'git', ...keys: string[]) => () => { sim.set({ side }); sim.open('code'); sim.spotlight(keys, 'dock:code') }
const inChat = (chan: ChanId) => () => {
  const s = sim.state, here = s.chan === chan && s.wins.chat.open && !s.wins.chat.min
  sim.open('chat')
  sim.spotlight(here ? ['chat-input'] : ['chan:' + chan], 'dock:chat')
}
/** Points at the message in the list, or at Reply once it is the one being read. */
const inMail = (e: Email, reply = false) => () => {
  const s = sim.state, reading = s.mailSel === e.id && s.mailFolder === e.folder && s.wins.mail.open && !s.wins.mail.min
  sim.set({ mailFolder: e.folder })
  sim.open('mail')
  sim.spotlight(reply && reading ? ['mail-reply'] : ['mail:' + e.id], 'dock:mail')
}

export function guide(s: State): Guide {
  const n = s.deploys.length, prod = s.deploys.at(-1)
  const fixed = s.tickets.find(t => t.id === 'LED-214')?.status === 'done'
  const committed = !!s.code.head && !s.deploys.some(d => d.sha === s.code.head)
  const watched = s.seen.includes('monitor@' + n) || (s.wins.monitor.open && !s.wins.monitor.min)
  const saidIn = (chan: ChanId, after: number) => s.chats[chan].some(m => m.who === 'maya' && m.id > after)
  const lastAlert = (kind: 'fire' | 'ok' | 'info') => s.chats.incidents.findLast(m => m.alert === kind && m.id > NEW)?.id ?? NEW
  const pm = s.emails.find(e => e.kind === 'pm')
  const pmDone = !!pm?.thread.length || s.docs.some(d => d.owner === 'maya' && /post-?mortem/i.test(d.title))

  const watch = (text: string): Step => ({ id: 'watch', text, done: watched, hint: 'A deploy takes about two minutes to show up.', show: inApp('monitor', 'error-rate') })
  const daniel = (after: number, side = false): Step[] => s.chats.daniel.some(m => m.who === 'daniel' && m.id > after)
    ? [{ id: 'daniel', text: 'Read Daniel’s message in Teams', done: !s.unread.daniel, side, show: inChat('daniel') }] : []
  const replies = (): Step[] => s.emails.filter(e => e.kind === 'client' || e.kind === 'support' || e.kind === 'sam')
    .map(e => ({ id: e.id, text: `Reply to ${PEOPLE[e.who].name}`, done: e.thread.length > 0, side: true, show: inMail(e, true) }))
  const ship = (again: boolean): Step[] => [
    { id: 'edit', text: again ? 'Change the code and save (⌘S)' : 'Make your change and save it (⌘S)', done: s.code.changes.length > 0 || committed, show: () => { void sim.openCode(VERIFY); sim.spotlight(['editor'], 'dock:code') } },
    { id: 'test', text: 'Run the tests', done: s.seen.includes('tested@' + n), hint: 'Run tests at the top of VS Code, or type npm test in the terminal.', show: inCode('files', 'run-tests') },
    { id: 'commit', text: 'Commit your change', done: committed && !s.code.changes.length, hint: 'Source control, on the left of VS Code. Write what you changed and why.', show: inCode('git', 'commit') },
    { id: 'deploy', text: again ? 'Deploy the new version' : 'Deploy to production', done: false, hint: 'Deploy at the top of VS Code, or ldg deploy auth-api --env prod.', show: inCode('files', 'deploy') },
  ]

  // ---------- production is down ----------
  if (live(s)) {
    const fire = lastAlert('fire')
    return {
      phase: 'incident:' + s.incident!.id, title: 'Production is down', sub: 'The alarm fired after your deploy. Restore service first, investigate after.',
      steps: [
        { id: 'ack', text: 'Say in #incidents that you’re on it', done: saidIn('incidents', fire) || saidIn('priya', fire), hint: 'One line is enough. People can see the alarm and are waiting to hear who has it.', show: inChat('incidents') },
        { id: 'look', text: 'Check CloudWatch: what is failing, and for whom', done: watched, show: inApp('monitor', 'error-rate') },
        { id: 'rollback', text: 'Roll back your release', done: prod?.sha !== s.incident!.sha, hint: 'The incident runbook in Confluence explains why.', show: inApp('monitor', 'rollback', 'rollback-code') },
        { id: 'wait', text: 'Wait for the 401 rate to drop under 5%', done: false, show: inApp('monitor', 'error-rate') },
        ...daniel(fire, true), ...replies(),
      ],
    }
  }

  // ---------- after an incident ----------
  if (s.incident?.resolvedAt != null && (!fixed || !pmDone)) {
    return {
      phase: 'after:' + s.incident.id, title: 'Service is back', sub: fixed ? 'Close out the incident.' : 'Close out the incident, then fix LED-214 for real.',
      steps: [
        { id: 'update', text: 'Tell #incidents that service is restored', done: saidIn('incidents', lastAlert('ok')), show: inChat('incidents') },
        ...daniel(lastAlert('fire')),
        ...(pm ? [{ id: 'pm', text: 'Send Priya a short postmortem', done: pmDone, hint: 'Reply to her email, or write it as a page in Confluence. The template is there too.', show: inMail(pm, true) }] : []),
        ...(fixed ? [] : ship(true)),
        ...replies().filter(x => !x.done),
      ],
    }
  }

  // ---------- LED-214 is fixed ----------
  if (fixed) {
    const out = lastAlert('info')
    return {
      phase: 'done', title: 'LED-214 is shipped', sub: 'SSO users stay signed in. Finish the way a good engineer would.',
      steps: [
        watch('Watch the 401 rate in CloudWatch for a few minutes'),
        { id: 'tell', text: 'Tell Priya it is out', done: saidIn('priya', out), show: inChat('priya') },
        { id: 'end', text: 'End your shift when you’re ready', done: false, hint: 'You get a recap of the day and a note from Daniel.', show: () => sim.spotlight(['end-shift']) },
      ],
    }
  }

  // ---------- deployed, but the ticket is still open ----------
  if (s.deploys.some(d => d.by === 'maya' && d.kind === 'deploy')) {
    return {
      phase: 'retry:' + n, title: 'Your deploy is live', sub: 'Jira still shows LED-214 as open. See what production says.',
      steps: [watch('Watch the 401 rate in CloudWatch'), ...daniel(lastAlert('info')), ...ship(true)],
    }
  }

  // ---------- the ticket ----------
  const e1 = s.emails.find(e => e.id === 'e1')
  const warning = s.chats.team.find(m => m.who === 'daniel' && m.id > NEW)
  const leo = s.chats.leo.find(m => m.who === 'leo' && m.id > NEW && m.text.includes('auth tests'))
  const priya = s.chats.priya.findLast(m => m.who === 'priya' && m.id > NEW && /^(How’s|Any update on) LED-214/.test(m.text))
  const status = s.tickets.find(t => t.id === 'LED-214')?.status
  return {
    phase: 'ticket', title: 'Fix LED-214', sub: 'SSO users get logged out after about an hour. Priya wants it fixed before the 3:00 PM demo.',
    steps: [
      ...(e1 ? [
        { id: 'read', text: 'Read Priya’s email about LED-214', done: e1.read, show: inMail(e1) },
        { id: 'ack', text: 'Reply to Priya so she knows you’ve picked it up', done: e1.thread.length > 0, show: () => { sim.openMail(e1.id); sim.spotlight(['mail-reply'], 'dock:mail') } },
      ] : []),
      { id: 'ticket', text: 'Move LED-214 to In progress in Jira', done: !!status && status !== 'todo', hint: 'Change Status on the ticket, or drag the card.', show: () => { sim.openTicket('LED-214'); sim.spotlight(['ticket-status', 'ticket:LED-214'], 'dock:tracker') } },
      { id: 'team', text: 'Read Daniel’s heads-up in #team', done: !!warning && !s.unread.team, show: inChat('team') },
      ...(s.level === 'newgrad' ? [
        { id: 'wiki', text: 'Read “Auth service: login paths” in Confluence', done: s.seen.includes('doc:auth'), show: inApp('docs', 'doc:auth') },
        { id: 'password', text: 'Open passwordLogin.ts and see what it sends', done: s.seen.includes('file:' + PASSWORD), show: inCode('files', 'file:' + PASSWORD) },
      ] : []),
      { id: 'open', text: 'Open verifySession.ts in VS Code', done: s.seen.includes('file:' + VERIFY) || s.code.changes.length > 0, show: inCode('files', 'file:' + VERIFY) },
      ...ship(false),
      ...(leo ? [{ id: 'leo', text: 'Leo asked you something in Teams', done: saidIn('leo', leo.id), side: true, show: inChat('leo') }] : []),
      ...(priya ? [{ id: 'priya', text: 'Priya wants an update in Teams', done: saidIn('priya', priya.id), side: true, show: inChat('priya') }] : []),
    ],
  }
}
