// The scenario's opening steps and when each counts as done. Pure: the browser ticks steps with it, the server can report progress with it.
// Only facts the browser already has. The schema is in shared/scenario.ts.
import type { ChanId, Level, PersonId, TicketStatus, World } from './types.ts'

/** Chat messages posted during the shift have ids above this; seed messages stay below it. */
export const NEW = 100

/** Exactly one key. */
export interface Done {
  all?: Done[]; any?: Done[]; not?: Done
  mailRead?: string
  /** The player has answered this email. */
  mailReplied?: string
  /** The ticket has one of these statuses. */
  ticket?: { id: string; status: TicketStatus[] }
  /** `who` has posted in `chan` since the shift started. */
  posted?: { chan: ChanId; who: PersonId }
  /** Nothing unread in the channel. */
  channelRead?: ChanId
  openedDoc?: string
  openedFile?: string
  /** changed: saved edits not yet committed. tested: tests run since the last deploy. committed: a commit not yet in production. */
  code?: 'changed' | 'tested' | 'committed'
  /** Whether the player has deployed (a rollback does not count). */
  deployed?: boolean
}
export const DONE_KEYS = ['all', 'any', 'not', 'mailRead', 'mailReplied', 'ticket', 'posted', 'channelRead', 'openedDoc', 'openedFile', 'code', 'deployed'] as const

/** Where "Show me" points. Exactly one key. */
export interface ShowMe {
  /** The message in the mail list. */
  mail?: string
  /** Opens the email and points at Reply. */
  reply?: string
  ticket?: string
  chat?: ChanId
  /** The page in Confluence's sidebar. */
  doc?: string
  /** The file in VS Code's explorer. */
  file?: string
  /** Opens the file in the editor. */
  edit?: string
  vscode?: 'run-tests' | 'commit' | 'deploy'
}
export const SHOW_KEYS = ['mail', 'reply', 'ticket', 'chat', 'doc', 'file', 'edit', 'vscode'] as const

export interface GuideStep { id: string; text: string; hint?: string; levels?: Level[]; doneWhen: Done; showMe?: ShowMe }

export type Facts = Pick<World, 'emails' | 'tickets' | 'chats' | 'unread' | 'code' | 'deploys' | 'player'> & { seen: string[] }

export function done(s: Facts, c: Done): boolean {
  if (c.all) return c.all.every(x => done(s, x))
  if (c.any) return c.any.some(x => done(s, x))
  if (c.not) return !done(s, c.not)
  if (c.mailRead) return !!s.emails.find(e => e.id === c.mailRead)?.read
  if (c.mailReplied) return !!s.emails.find(e => e.id === c.mailReplied)?.thread.length
  if (c.ticket) { const t = s.tickets.find(x => x.id === c.ticket!.id); return !!t && c.ticket.status.includes(t.status) }
  if (c.posted) { const { chan, who } = c.posted; return !!s.chats[chan]?.some(m => m.who === who && m.id > NEW) }
  if (c.channelRead) return !s.unread[c.channelRead]
  if (c.openedDoc) return s.seen.includes('doc:' + c.openedDoc)
  if (c.openedFile) return s.seen.includes('file:' + c.openedFile)
  if (c.code === 'changed') return s.code.changes.length > 0
  if (c.code === 'tested') return s.seen.includes('tested@' + s.deploys.length)
  if (c.code === 'committed') return !!s.code.head && !s.deploys.some(d => d.sha === s.code.head)
  return s.deploys.some(d => d.by === s.player && d.kind === 'deploy') === c.deployed
}

export const stepsFor = (steps: GuideStep[], level: Level) => steps.filter(x => !x.levels || x.levels.includes(level))
