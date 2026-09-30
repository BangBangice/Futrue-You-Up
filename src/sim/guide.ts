// The step list in the top-left corner: what to do next, worked out from the state of the shift.
// Steps say what to do and where. They never say what the bug is: finding that out is the lesson.
// The lesson's phases and steps are scenario data, which shared/guide.ts evaluates; this only adds where "Show me" points.
import { plan } from '../../shared/guide.ts'
import type { Plan, ShowMe } from '../../shared/guide.ts'
import { APP_IDS } from '../../shared/types.ts'
import type { AppId, ChanId, Email } from '../../shared/types.ts'
import { sim } from './store.ts'
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
/** `phase` is the current phase's id; `map` is every phase in road-map order, with where the player is. `ready`: the lesson can end. */
export interface Guide { phase: string; title: string; sub: string; steps: Step[]; ready: boolean; map: Plan['map'] }

// ---------- where "Show me" points ----------
// Each also picks the pane a phone has to be on for the target to be on screen (sim.dive); wider screens show both.
const inApp = (app: AppId, ...keys: string[]) => () => { sim.open(app); sim.dive(app, false); sim.spotlight(keys, 'dock:' + app) }
const inCode = (side: 'files' | 'git', ...keys: string[]) => () => { sim.set({ side }); sim.open('code'); sim.dive('code', !keys.some(k => k === 'commit' || k.startsWith('file:'))); sim.spotlight(keys, 'dock:code') }
const inChat = (chan: ChanId) => () => {
  const s = sim.state, here = s.chan === chan && s.wins.chat.open && !s.wins.chat.min
  sim.dive('chat', here)
  sim.open('chat')
  sim.spotlight(here ? ['chat-input'] : ['chan:' + chan], 'dock:chat')
}
/** Points at the message in the list, or at Reply once it is the one being read. */
const inMail = (e: Email, reply = false) => () => {
  const s = sim.state, reading = s.mailSel === e.id && s.mailFolder === e.folder && s.wins.mail.open && !s.wins.mail.min
  sim.set({ mailFolder: e.folder })
  sim.dive('mail', reply && reading)
  sim.open('mail')
  sim.spotlight(reply && reading ? ['mail-reply'] : ['mail:' + e.id], 'dock:mail')
}
const inEditor = (path: string) => () => { void sim.openCode(path); sim.spotlight(['editor'], 'dock:code') }
/** Where a step's "Show me" goes. */
function target(s: State, m: ShowMe): () => void {
  const mail = s.emails.find(e => e.id === m.mail)
  if (mail) return inMail(mail)
  if (m.reply) return () => { sim.openMail(m.reply!); sim.spotlight(['mail-reply'], 'dock:mail') }
  if (m.ticket) return () => { sim.openTicket(m.ticket!); sim.spotlight(['ticket-status', 'ticket:' + m.ticket], 'dock:tracker') }
  if (m.chat) return inChat(m.chat)
  if (m.doc) return inApp('docs', 'doc:' + m.doc)
  if (m.file) return inCode('files', 'file:' + m.file)
  if (m.edit) return inEditor(m.edit)
  if (m.vscode) return inCode(m.vscode === 'commit' ? 'git' : 'files', m.vscode)
  if (m.monitor) return m.monitor === 'rollback' ? inApp('monitor', 'rollback', 'rollback-code') : inApp('monitor', 'error-rate')
  if (m.finish) return () => sim.spotlight(['end-shift'])
  return () => {}
}

export function guide(s: State): Guide {
  // What is on screen counts as looked at: CloudWatch open since before the deploy still watches it.
  const looking = APP_IDS.filter(a => s.wins[a].open && !s.wins[a].min)
  const p = plan({ ...s, looking }, s.phases, s.level)
  return { ...p, steps: p.steps.map(x => ({ id: x.id, text: x.text, hint: x.hint, done: x.done, side: x.side || undefined, show: target(s, x.showMe) })) }
}
