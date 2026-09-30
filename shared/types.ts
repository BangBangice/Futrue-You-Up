// Types, constants and pure helpers used by both the server and the browser. No I/O here.
import type { GuideStep } from './guide.ts'

export type AppId = 'mail' | 'chat' | 'code' | 'tracker' | 'docs' | 'monitor'
/** A key of the scenario's cast. The scenario schema checks references; the compiler cannot. */
export type PersonId = string
/** A key of the scenario's channels. A DM channel shares its id with the person on the other end. */
export type ChanId = string
export interface Person {
  name: string; init: string; color: string; email: string; title: string
  /** What colleagues call them, when not the first word of their name. */
  short?: string
  /** How the engine's own lines refer to them. They/their when not given. */
  pronouns?: 'she' | 'he' | 'they'
}
export interface Channel { label: string; topic: string; dm?: boolean }
export type Cast = Record<PersonId, Person>
/** What colleagues call someone: `short` if set, else the first word of their name. */
export const firstName = (p: Pick<Person, 'name' | 'short'>) => p.short ?? p.name.split(' ')[0]
const PRONOUNS = { she: ['she', 'her'], he: ['he', 'his'], they: ['they', 'their'] } as const
/** "she", "he" or "they", as the scenario gives them. */
export const they = (p: Pick<Person, 'pronouns'>) => PRONOUNS[p.pronouns ?? 'they'][0]
/** "her", "his" or "their", as the scenario gives them. */
export const their = (p: Pick<Person, 'pronouns'>) => PRONOUNS[p.pronouns ?? 'they'][1]
/** Up to two letters for an avatar: "Maya Chen" is MC. */
export const initials = (name: string) => name.trim().split(/\s+/).map(w => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
/** Their username on the work laptop and in branch names, like "maya". */
export const login = (p: Pick<Person, 'name' | 'short'>) => firstName(p).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '') || 'dev'
export type Channels = Record<ChanId, Channel>
export const LEVELS = ['newgrad', 'bootcamp', 'switcher'] as const
export type Level = typeof LEVELS[number]
export type Theme = 'light' | 'dark'
export const FOLDERS = ['inbox', 'alerts', 'sent', 'archive', 'deleted'] as const
export type Folder = typeof FOLDERS[number]
export type TicketStatus = 'todo' | 'progress' | 'review' | 'done'
export type Priority = 'Urgent' | 'High' | 'Medium' | 'Low'
export type Tone = 'dim' | 'accent' | 'bad' | 'good' | 'out'

/** Something attached to an email or chat message. Everything except an upload opens inside the sim. */
export type Attachment =
  | { kind: 'code'; path: string }
  | { kind: 'doc'; doc: string }
  | { kind: 'ticket'; id: string }
  | { kind: 'link'; label: string; app: AppId; chan?: ChanId }
  /** A file from the player's computer. Only the id is kept here; the bytes live in storage (server/uploads.ts). */
  | { kind: 'upload'; id: string; name: string; size: number }

export interface Reply { time: string; text: string; files: Attachment[] }
export interface Email {
  id: string; folder: Folder; who: PersonId; toName?: string; subject: string; time: string; read: boolean
  /** Marks scenario mail whose answer matters to the story. */
  kind?: 'assign' | 'support' | 'client' | 'sam' | 'pm'
  flagged?: boolean; body: string[]; files: Attachment[]; thread: Reply[]
}
/** The mentor's coaching, shown as a card under his message. */
export interface Coaching { blast: string; why: string; question: string; next: string }
export interface ChatMsg {
  id: number; who: PersonId; time: string; text: string
  alert?: 'fire' | 'ok' | 'info'; files?: Attachment[]; coach?: Coaching
  /** Set when the AI could not answer: why, so the player knows this line is scripted or that a reply is missing. */
  fallback?: string
}
export interface Comment { who: PersonId; time: string; text: string }
export interface Ticket {
  id: string; title: string; status: TicketStatus; who: PersonId | null; pri: Priority; pts: number | null; desc: string
  reopened?: boolean; comments: Comment[]; activity: { time: string; text: string }[]
}
export interface Doc { id: string; title: string; group: string; owner: PersonId; updated: string; body: string; version: number }
export interface TermLine { c: 'cmd' | 'ok' | 'err' | 'dim' | 'out'; t: string }
export interface TimelineEv { time: string; text: string; tone: Tone }

// ---------- production health ----------
/** An id from the scenario's checks. */
export type CheckId = string
export interface Check { id: CheckId; ok: boolean; reason: string }
export interface Deploy { sha: string; at: number; by: PersonId; kind: 'deploy' | 'rollback'; checks: Check[] }
export interface Incident { id: string; sha: string; startedAt: number; resolvedAt: number | null; failing: CheckId[] }
export interface GitFile { path: string; status: string }
export interface CodeState {
  branch: string; head: string; subject: string; changes: GitFile[]
  /** What the terminal is busy with, if anything. */
  busy: string | null
}
export interface Recap {
  ready: boolean; happened: string[]; corrected: string[]; next: string[]; note: string
  /** Whether the lesson's work was done when the shift ended, which is what testing a draft needs (see director.end). */
  finished?: boolean
}
/** The lesson being played. `mine` is set when its author is playing it, which is how a draft is tested. */
export interface Lesson { id: string; title: string; summary: string | null; mine?: boolean }

export interface Calendar { weekday: string; date: string; day: number; start: number }
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** "Tue", for the menu bar. A weekday that is not a day's name is shown whole. */
export const shortDay = (weekday: string) => WEEK.includes(weekday) ? weekday.slice(0, 3) : weekday
/** "Monday" when the shift is on a Tuesday; "yesterday" when the weekday is not a day's name. */
export const dayBefore = (weekday: string) => { const i = WEEK.indexOf(weekday); return i < 0 ? 'yesterday' : WEEK[(i + 6) % 7] }
/** Everything the server owns. The browser holds a read-only copy kept current by patches. */
export interface World {
  id: string; stage: 'sim' | 'recap'; level: Level; background: string; ai: 'live' | 'stub'
  /** Who is in this scenario and which cast member the player is. Fixed for the shift. */
  cast: Cast; channels: Channels; player: PersonId; mentor: PersonId
  /** Which lesson this is. */
  lesson: Lesson
  /** The company the player works at in this scenario. */
  company: string
  /** What the code workspace and the work laptop are called. */
  workspace: { repo: string; host: string }
  /** When the shift happens: "Tuesday", "Sep 29", which day of the placement, and the sim minute it starts. */
  calendar: Calendar
  /** When the demo is, in sim minutes, or null when the scenario has none. */
  deadline: number | null
  /** What failing checks cost. Only the checks customers can feel. */
  impact: Impact
  /** How each starting level is described on the start page. Empty until the scenario has loaded. */
  levels: Partial<Record<Level, { label: string; blurb: string }>>
  /** The scenario's opening steps, for the step guide. */
  guide: GuideStep[]
  /** Why AI calls are failing right now, or null while they work. */
  aiProblem: string | null
  /** Simulated minutes per real minute. */
  pace: number; simMin: number
  emails: Email[]; chats: Record<ChanId, ChatMsg[]>; unread: Record<ChanId, number>; typing: { chan: ChanId; who: PersonId }[]
  tickets: Ticket[]; docs: Doc[]
  files: string[]; code: CodeState; term: TermLine[]
  /** Oldest first. The last entry is what is live in production. */
  deploys: Deploy[]; incident: Incident | null; demo: 'pending' | 'held' | 'postponed'
  timeline: TimelineEv[]; recap: Recap | null
}
export type Patch = Partial<World>

export const PACES: [number, string][] = [[2, 'Relaxed'], [4, 'Normal'], [12, 'Demo']]

export const clock = (m: number, sec?: number) => {
  const h24 = Math.floor(m / 60) % 24, mm = m % 60, h = ((h24 + 11) % 12) + 1
  return h + ':' + String(mm).padStart(2, '0') + (sec === undefined ? '' : ':' + String(sec).padStart(2, '0')) + ' ' + (h24 >= 12 ? 'PM' : 'AM')
}
/** The inverse of clock: "1:10 PM" is 790. NaN for anything else. */
export const minutes = (t: string) => {
  const [, h, mm, ap] = /^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(t) ?? []
  return ap ? (Number(h) % 12) * 60 + Number(mm) + (ap === 'PM' ? 720 : 0) : NaN
}
export const dur = (n: number) => (n >= 60 ? Math.floor(n / 60) + 'h ' + (n % 60) + 'm' : n + 'm')

export const personByName = (cast: Cast, text: string) => {
  const t = text.trim().toLowerCase()
  return Object.keys(cast).find(k => cast[k].name.toLowerCase() === t || cast[k].email === t)
}

export const APP_IDS: AppId[] = ['mail', 'chat', 'code', 'tracker', 'docs', 'monitor']
export const APP_NAMES: Record<AppId, string> = {
  mail: 'Outlook', chat: 'Teams', code: 'VS Code', tracker: 'Jira', docs: 'Confluence', monitor: 'CloudWatch',
}
export const COLS: [TicketStatus, string][] = [['todo', 'To do'], ['progress', 'In progress'], ['review', 'In review'], ['done', 'Done']]
export const PRIORITIES: Priority[] = ['Urgent', 'High', 'Medium', 'Low']

// ---------- who is hurt when a login path breaks ----------
export interface CheckInfo {
  id: CheckId; label: string
  /** Share of auth-api traffic (%) that turns into 401s when it fails. Security checks cost nothing here: that is the point. */
  share: number
  /** Whose users are locked out when it fails. */
  locks?: 'password' | 'sso'
}
/** An account, by how its people sign in. `password` and `sso` are user counts. */
export interface Customer { name: string; short?: string; arr: string; password: number; sso: number; note: string }
/** The scenario's figures for what a broken deploy costs. The scenario itself fits, and so does the World's browser-safe copy. */
export interface Impact {
  /** 401 rate (%) that fires the alarm. */
  alarmPercent: number
  checks: CheckInfo[]
  customers: { named: Customer[]; otherAccounts: number; otherPasswordUsers: number }
}
/** The laptop's name as a terminal prompt shows it: "ledgerly-ws-02" is "ws-02". */
export const shortHost = (host: string) => host.replace(/^[a-z0-9]+-(?=[a-z0-9])/, '')
/** What the story and the production logs call a customer, like "Northwind". */
export const shortName = (c: Pick<Customer, 'name' | 'short'>) => c.short ?? c.name.split(' ')[0]
export const failing = (checks: Check[]) => checks.filter(c => !c.ok).map(c => c.id)
export const failRate = (imp: Impact, checks: Check[]) => failing(checks).reduce((n, id) => n + (imp.checks.find(c => c.id === id)?.share ?? 0), 0)
/** True when customers can feel it (as opposed to a silent security hole). */
export const isOutage = (imp: Impact, checks: Check[]) => failRate(imp, checks) > imp.alarmPercent
/** Users of an account locked out by these failing checks. */
const lost = (imp: Impact, broken: CheckId[]) => {
  const locks = new Set(imp.checks.filter(c => c.locks && broken.includes(c.id)).map(c => c.locks))
  return (c: Pick<Customer, 'password' | 'sso'>) => (locks.has('password') ? c.password : 0) + (locks.has('sso') ? c.sso : 0)
}
/** Everyone who signs in with a password, and on how many accounts. */
export const passwordUsers = ({ customers: c }: Impact) => ({ users: c.named.reduce((n, x) => n + x.password, 0) + c.otherPasswordUsers, accounts: c.named.filter(x => x.password).length + c.otherAccounts })

/** The deploy that was live at sim minute m. */
export const liveAt = (deploys: Deploy[], m: number) => deploys.findLast(d => d.at <= m) ?? deploys[0]
/** 401 error rate (%) on auth-api at sim minute m: baseline noise plus whatever the live deploy breaks, eased in over the rollout. */
export function errAt(imp: Impact, deploys: Deploy[], m: number) {
  const noise = 0.45 + 0.22 * Math.sin(m * 1.7) + 0.12 * Math.sin(m * 0.6)
  const i = deploys.findLastIndex(d => d.at <= m)
  if (i < 0) return Math.max(0.1, noise)
  const now = failRate(imp, deploys[i].checks), before = i > 0 ? failRate(imp, deploys[i - 1].checks) : now
  const k = Math.min(1, Math.max(0, (m - deploys[i].at) / 2.2))
  const level = before + (now - before) * k
  return Math.max(0.1, noise + level * (1 + 0.04 * Math.sin(m * 2.3)))
}
/** People who cannot sign in at sim minute m. Grows as sessions expire, up to everyone on the broken paths. */
export function lockedAt(imp: Impact, deploys: Deploy[], m: number) {
  const d = liveAt(deploys, m)
  if (!d || !isOutage(imp, d.checks)) return 0
  const per = lost(imp, failing(d.checks))
  const cap = imp.customers.named.reduce((n, c) => n + per(c), 0) + per({ password: imp.customers.otherPasswordUsers, sso: 0 })
  return Math.max(0, Math.min(cap, Math.round(46 * (m - d.at - 1))))
}
/** Users locked out per named customer, easing in with the same curve. */
export function lockedFor(imp: Impact, deploys: Deploy[], m: number, c: Pick<Customer, 'password' | 'sso'>) {
  const d = liveAt(deploys, m)
  if (!d || !isOutage(imp, d.checks)) return 0
  return Math.round(lost(imp, failing(d.checks))(c) * Math.min(1, Math.max(0, (m - d.at) / 10)))
}
