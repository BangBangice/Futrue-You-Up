// The step list: the lesson's phases, which one the player is in, and when each step counts as done. Pure: the browser ticks steps
// with it, the server reports progress and decides whether a lesson with a goal is finished with it.
// Only facts the browser already has. The schema is in shared/scenario.ts.
import { clock, firstName } from './types.ts'
import type { AppId, ChanId, ChatMsg, Email, Level, PersonId, TicketStatus, World } from './types.ts'

/** Chat messages posted during the shift have ids above this; seed messages stay below it. */
export const NEW = 100

/** The latest message during the shift that matches every field given: in `chan`, by `who`, an engine alert of this kind, text
 * matching `match` (a regular expression). */
export interface Msg { chan?: ChanId; who?: PersonId; alert?: NonNullable<ChatMsg['alert']>; match?: string }

/** Exactly one key. */
export interface Done {
  all?: Done[]; any?: Done[]; not?: Done
  mailRead?: string
  /** The player has answered this email. */
  mailReplied?: string
  /** The ticket has one of these statuses. */
  ticket?: { id: string; status: TicketStatus[] }
  /** The player has commented on this ticket. */
  commented?: string
  /** `who` has posted in `chan` during the shift: text matching `match` if given, and after the `after` message if given
   * (any post during the shift when there is no such message). With `who` the player, "the player has said something there". */
  posted?: { chan: ChanId; who: PersonId; match?: string; after?: Msg }
  /** Nothing unread in the channel. */
  channelRead?: ChanId
  openedDoc?: string
  openedFile?: string
  /** changed: saved edits not yet committed. tested: tests run since the last deploy. committed: a commit not yet in production. */
  code?: 'changed' | 'tested' | 'committed'
  /** Whether the player has deployed (a rollback does not count). */
  deployed?: boolean
  /** What is live is a deploy of the player's, and they had released before it (a deploy or a rollback): a second go. False
   * again once there is new work to ship, so a "deploy the new version" step waits for the next one. */
  redeployed?: boolean
  /** Git milestones, which stay done once reached. branched: a branch of their own exists (not main). staged: they have staged
   * a change (or committed one). committed: they have made a commit. pushed: they have pushed a branch of their own to origin. */
  git?: 'branched' | 'staged' | 'committed' | 'pushed'
  /** They have run this in the terminal: the command, or the command with more after it. "git diff" counts "git diff --staged". */
  ran?: string
  /** The latest incident. opened: there has been one. live: it is still firing. resolved: it is over. rolled-back: what is live
   * is no longer the release that caused it. */
  incident?: 'opened' | 'live' | 'resolved' | 'rolled-back'
  /** CloudWatch looked at since the latest deploy, or on screen now. */
  watched?: boolean
  /** The player has answered the postmortem request (an email of kind "pm"), or written a Confluence page called postmortem. */
  postmortem?: boolean
  /** The shift is over: what a finish step waits for, so it never ticks while it is on screen. */
  ended?: boolean
  /** Every step of this phase without an `if` is done. For a step's `if` (the finish step) and a phase's `subs`. */
  stepsDone?: boolean
}
export const DONE_KEYS = ['all', 'any', 'not', 'mailRead', 'mailReplied', 'ticket', 'commented', 'posted', 'channelRead', 'openedDoc', 'openedFile', 'code', 'deployed', 'redeployed', 'git', 'ran', 'incident', 'watched', 'postmortem', 'ended', 'stepsDone'] as const

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
  vscode?: 'run-tests' | 'commit' | 'deploy' | 'terminal'
  /** CloudWatch: the error-rate graph, or the rollback button. */
  monitor?: 'error-rate' | 'rollback'
  /** The Finish lesson button. */
  finish?: true
}
export const SHOW_KEYS = ['mail', 'reply', 'ticket', 'chat', 'doc', 'file', 'edit', 'vscode', 'monitor', 'finish'] as const

export const MAIL_KINDS = ['assign', 'support', 'client', 'sam', 'pm'] as const
/** A step that stands for several: one per email of these kinds (done when answered, Show me opens it at Reply), or one per
 * direct message waiting to be read (done once read). {{from}} in its text is the sender's first name. */
export type Each = { mail: NonNullable<Email['kind']>[] } | { dm: true }

export interface GuideStep {
  id: string; text: string; hint?: string; levels?: Level[]
  /** Shown only while this holds, like a message that has arrived. A step with one does not count towards finishing. */
  if?: Done
  /** Required, except in a step with `each`, which has its own. */
  doneWhen?: Done
  showMe?: ShowMe
  each?: Each
  /** Drops out of the list once done, rather than staying ticked. */
  hideDone?: boolean
}

/**
 * One stretch of the lesson, like "Fix LED-214" or "Production is down". A lesson lists them in the order of its road map, and the
 * player is in the LAST one whose `when` holds (a phase without `when` always does, so the first has none). A phase that may never
 * happen, like an incident, is `optional`, and its `happened` says whether it did, for the road map.
 */
export interface Phase {
  id: string; title: string; sub: string
  /** Replace `sub`: the first whose `when` holds. */
  subs?: { when: Done; sub: string }[]
  when?: Done
  optional?: boolean
  happened?: Done
  steps: GuideStep[]
  /** Things that arrived and are waiting on the player, beside the plan. */
  side?: GuideStep[]
}

export type Facts = Pick<World, 'emails' | 'tickets' | 'chats' | 'unread' | 'code' | 'deploys' | 'player'>
  & Partial<Pick<World, 'ran' | 'incident' | 'docs' | 'channels' | 'cast' | 'mentor' | 'deadline'>>
  & { stage?: string; seen: string[]; looking?: AppId[]; stepsDone?: boolean }

/** A terminal command as the guide compares it: single spaces, no quotes. */
export const normalize = (cmd: string) => cmd.trim().replace(/["']/g, '').replace(/\s+/g, ' ')
const own = (b: string) => b !== 'main' && b !== 'master'
const re = (p: string) => new RegExp(p, 'u')
/** The id of the latest message matching `q`, or NEW when there is none. */
function latest(s: Facts, q: Msg) {
  let id = NEW
  for (const [chan, msgs] of Object.entries(s.chats)) {
    if (q.chan && chan !== q.chan) continue
    for (const m of msgs) if (m.id > id && (!q.who || m.who === q.who) && (!q.alert || m.alert === q.alert) && (!q.match || re(q.match).test(m.text))) id = m.id
  }
  return id
}

export function done(s: Facts, c: Done): boolean {
  if (c.all) return c.all.every(x => done(s, x))
  if (c.any) return c.any.some(x => done(s, x))
  if (c.not) return !done(s, c.not)
  if (c.mailRead) return !!s.emails.find(e => e.id === c.mailRead)?.read
  if (c.mailReplied) return !!s.emails.find(e => e.id === c.mailReplied)?.thread.length
  if (c.ticket) { const t = s.tickets.find(x => x.id === c.ticket!.id); return !!t && c.ticket.status.includes(t.status) }
  if (c.commented) return !!s.tickets.find(x => x.id === c.commented)?.comments.some(m => m.who === s.player)
  if (c.posted) {
    const { chan, who, match, after } = c.posted, since = after ? latest(s, after) : NEW
    return !!s.chats[chan]?.some(m => m.who === who && m.id > since && (!match || re(match).test(m.text)))
  }
  if (c.channelRead) return !s.unread[c.channelRead]
  if (c.openedDoc) return s.seen.includes('doc:' + c.openedDoc)
  if (c.openedFile) return s.seen.includes('file:' + c.openedFile)
  if (c.code === 'changed') return s.code.changes.length > 0
  if (c.code === 'tested') return s.seen.includes('tested@' + s.deploys.length)
  if (c.code === 'committed') return !!s.code.head && !s.deploys.some(d => d.sha === s.code.head)
  if (c.git) {
    const g = s.code, mine = g.mine ?? 0
    if (c.git === 'branched') return (g.branches ?? [g.branch]).some(own)
    if (c.git === 'staged') return !!g.staged || mine > 0
    if (c.git === 'committed') return mine > 0
    return (g.remote ?? []).some(own)
  }
  if (c.ran) { const want = normalize(c.ran); return (s.ran ?? []).some(r => r === want || r.startsWith(want + ' ')) }
  if (c.redeployed !== undefined) {
    const mine = s.deploys.filter(d => d.by === s.player), live = s.deploys.at(-1)
    const again = mine.length > 1 && !!live && live === mine.at(-1) && live.kind === 'deploy' && !done(s, { code: 'changed' }) && !done(s, { code: 'committed' })
    return again === c.redeployed
  }
  if (c.incident) {
    const i = s.incident
    if (c.incident === 'opened') return !!i
    if (c.incident === 'live') return !!i && i.resolvedAt === null
    if (c.incident === 'resolved') return i?.resolvedAt != null
    return !!i && s.deploys.at(-1)?.sha !== i.sha
  }
  if (c.watched !== undefined) return (s.seen.includes('monitor@' + s.deploys.length) || !!s.looking?.includes('monitor')) === c.watched
  if (c.postmortem !== undefined) {
    const answered = s.emails.some(e => e.kind === 'pm' && e.thread.length) || !!s.docs?.some(d => d.owner === s.player && /post-?mortem/i.test(d.title))
    return answered === c.postmortem
  }
  if (c.ended !== undefined) return (s.stage === 'recap') === c.ended
  if (c.stepsDone !== undefined) return !!s.stepsDone === c.stepsDone
  return s.deploys.some(d => d.by === s.player && d.kind === 'deploy') === c.deployed
}

// ---------- phases ----------
/** Placeholders in step and phase text: {{mentor}}, {{deadline}} (the clock time of the deadline), {{from}} in a step with `each`,
 * and any cast id for that person's first name. {{player}} is filled in earlier, when the shift is cast (personalize). */
export const GUIDE_VARS = ['mentor', 'deadline', 'from', 'player'] as const
export function fill(s: Facts, text: string, from = ''): string {
  return text.replace(/\{\{(.*?)\}\}/g, (all, k: string) =>
    k === 'from' ? from
    : k === 'deadline' ? (s.deadline == null ? '' : clock(s.deadline))
    : k === 'mentor' ? (s.mentor && s.cast?.[s.mentor] ? firstName(s.cast[s.mentor]) : 'your mentor')
    : s.cast?.[k] ? firstName(s.cast[k]) : all)
}

/** A step as the player sees it: filled in, ticked or not, and where Show me goes. */
export interface Shown { id: string; text: string; hint?: string; done: boolean; side: boolean; showMe: ShowMe }

export const stepsFor = (steps: GuideStep[], level: Level) => steps.filter(x => !x.levels || x.levels.includes(level))

function expand(s: Facts, steps: GuideStep[], level: Level, side: boolean): Shown[] {
  const out: Shown[] = []
  for (const x of stepsFor(steps, level)) {
    if (x.if && !done(s, x.if)) continue
    const one = (id: string, from: string, ok: boolean, showMe: ShowMe) => {
      if (!(x.hideDone && ok)) out.push({ id, text: fill(s, x.text, from), hint: x.hint && fill(s, x.hint, from), done: ok, side, showMe })
    }
    const each = x.each
    if (!each) one(x.id, '', done(s, x.doneWhen!), x.showMe ?? {})
    else if ('mail' in each) {
      for (const e of s.emails) if (e.kind && each.mail.includes(e.kind)) one(`${x.id}:${e.id}`, s.cast?.[e.who] ? firstName(s.cast[e.who]) : e.who, x.doneWhen ? done(s, x.doneWhen) : !!e.thread.length, { reply: e.id })
    } else {
      for (const [id, ch] of Object.entries(s.channels ?? {})) if (ch.dm && s.cast?.[id] && s.unread[id]) one(`${x.id}:${id}`, firstName(s.cast[id]), x.doneWhen ? done(s, x.doneWhen) : false, { chat: id })
    }
  }
  return out
}

/** Where the player is: the last phase whose `when` holds. -1 only when there are no phases. */
export function current(s: Facts, phases: Phase[]) {
  return phases.findLastIndex(p => !p.when || done(s, p.when))
}

/** The steps of a phase, with the facts its `if`s and `subs` see (stepsDone). */
function stepsOf(s: Facts, p: Phase, level: Level) {
  const f = { ...s, stepsDone: expand(s, p.steps.filter(x => !x.if), level, false).every(x => x.done) }
  return { f, steps: [...expand(f, p.steps, level, false), ...expand(f, p.side ?? [], level, true)] }
}

export type PhaseState = 'past' | 'current' | 'upcoming' | 'skipped'
export interface Plan {
  phase: string; title: string; sub: string; steps: Shown[]
  /** A finish step is on the list: the lesson can end now. */
  ready: boolean
  /** Every phase, in road-map order. An optional phase before the current one is past if it happened, else skipped. */
  map: { id: string; title: string; optional: boolean; state: PhaseState }[]
}

export function plan(s: Facts, phases: Phase[], level: Level): Plan {
  const at = current(s, phases), p = phases[at]
  const map = phases.map((x, i) => ({
    id: x.id, title: fill(s, x.title), optional: !!x.optional,
    state: (i === at ? 'current' : i > at ? 'upcoming' : !x.optional || (x.happened && done(s, x.happened)) ? 'past' : 'skipped') as PhaseState,
  }))
  if (!p) return { phase: '', title: '', sub: '', steps: [], ready: false, map }
  const { f, steps } = stepsOf(s, p, level)
  const sub = p.subs?.find(x => done(f, x.when))?.sub ?? p.sub
  return { phase: p.id, title: fill(s, p.title), sub: fill(s, sub), steps, ready: steps.some(x => x.showMe.finish && !x.done), map }
}

/** A phase as the road map previews it, before or after the player is in it: its usual `sub`, and its steps filled in, without the
 * ones that wait on something happening (an `if`), and a step with `each` once, for whoever it turns out to be. No ticks, no side
 * steps. Null for a phase the lesson does not have. */
export function preview(s: Facts, phases: Phase[], level: Level, id: string): { sub: string; steps: { id: string; text: string }[] } | null {
  const p = phases.find(x => x.id === id)
  return p ? { sub: fill(s, p.sub), steps: stepsFor(p.steps, level).filter(x => !x.if).map(x => ({ id: x.id, text: fill(s, x.text, x.each ? 'someone' : '') })) } : null
}

/** The steps that decide whether a lesson with a goal is finished: every step without an `if`, in every phase that is not optional. */
export const required = (s: Facts, phases: Phase[], level: Level) => phases.filter(p => !p.optional).flatMap(p => expand(s, p.steps.filter(x => !x.if), level, false))
/** Every required step this level sees is done. What a lesson with a goal needs before it counts as finished. */
export const allDone = (s: Facts, phases: Phase[], level: Level) => required(s, phases, level).every(x => x.done)
