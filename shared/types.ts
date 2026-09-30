// Types, constants and pure helpers used by both the server and the browser. No I/O here.

export type AppId = 'mail' | 'chat' | 'code' | 'tracker' | 'docs' | 'monitor'
export type PersonId = 'maya' | 'priya' | 'daniel' | 'leo' | 'sam' | 'hana' | 'marta' | 'people' | 'cloudwatch' | 'jira'
export type ChanId = 'team' | 'incidents' | 'priya' | 'daniel' | 'leo'
export type Level = 'newgrad' | 'bootcamp' | 'switcher'
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
  | { kind: 'upload'; name: string; size: number; url: string }

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
export type CheckId = 'password_login' | 'dashboard_fallthrough' | 'sso_after_refresh' | 'api_key' | 'rejects_expired' | 'rejects_missing' | 'rejects_tampered'
export interface Check { id: CheckId; ok: boolean; reason: string }
export interface Deploy { sha: string; at: number; by: PersonId; kind: 'deploy' | 'rollback'; checks: Check[] }
export interface Incident { id: string; sha: string; startedAt: number; resolvedAt: number | null; failing: CheckId[] }
export interface GitFile { path: string; status: string }
export interface CodeState {
  branch: string; head: string; subject: string; changes: GitFile[]
  /** What the terminal is busy with, if anything. */
  busy: string | null
}
export interface Recap { ready: boolean; happened: string[]; corrected: string[]; next: string[]; note: string }

/** Everything the server owns. The browser holds a read-only copy kept current by patches. */
export interface World {
  id: string; stage: 'sim' | 'recap'; level: Level; background: string; ai: 'live' | 'stub'
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

export const START = 790 // 1:10 PM, in minutes since midnight
export const DEMO = 900 // 3:00 PM
export const RATE = 41 // revenue exposed per incident minute
export const ALARM = 5 // 401 rate (%) that fires the alarm
export const PACES: [number, string][] = [[2, 'Relaxed'], [4, 'Normal'], [12, 'Demo']]

export const clock = (m: number) => {
  const h24 = Math.floor(m / 60) % 24, mm = m % 60, h = ((h24 + 11) % 12) + 1
  return h + ':' + String(mm).padStart(2, '0') + ' ' + (h24 >= 12 ? 'PM' : 'AM')
}
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const dur = (n: number) => (n >= 60 ? Math.floor(n / 60) + 'h ' + (n % 60) + 'm' : n + 'm')

export const PEOPLE: Record<PersonId, { name: string; init: string; color: string; email: string; title: string }> = {
  maya: { name: 'Maya Chen', init: 'MC', color: '#2f6fde', email: 'maya.chen@ledgerly.io', title: 'Junior Backend Developer' },
  priya: { name: 'Priya Raman', init: 'PR', color: '#c2542d', email: 'priya@ledgerly.io', title: 'Engineering Manager' },
  daniel: { name: 'Daniel Okafor', init: 'DO', color: '#1f7a6d', email: 'daniel@ledgerly.io', title: 'Senior Engineer' },
  leo: { name: 'Leo Martins', init: 'LM', color: '#7a4fd6', email: 'leo@ledgerly.io', title: 'Engineer' },
  sam: { name: 'Sam Whitfield', init: 'SW', color: '#a86a12', email: 'sam@ledgerly.io', title: 'Account Manager' },
  hana: { name: 'Hana Ito', init: 'HI', color: '#b83a78', email: 'hana@ledgerly.io', title: 'Support Lead' },
  marta: { name: 'Marta Lindqvist', init: 'ML', color: '#3d4a5c', email: 'marta.lindqvist@northwindfreight.com', title: 'Head of Finance Ops, Northwind Freight' },
  people: { name: 'People Ops', init: 'PO', color: '#6b7280', email: 'people@ledgerly.io', title: 'People Ops' },
  cloudwatch: { name: 'CloudWatch', init: 'CW', color: '#e2661b', email: 'alarms@cloudwatch.ledgerly.io', title: 'Monitoring' },
  jira: { name: 'Jira', init: 'J', color: '#0052cc', email: 'jira@ledgerly.atlassian.net', title: 'Issue tracker' },
}
export const personByName = (text: string) => {
  const t = text.trim().toLowerCase()
  return (Object.keys(PEOPLE) as PersonId[]).find(k => PEOPLE[k].name.toLowerCase() === t || PEOPLE[k].email === t)
}

export const CHANS: Record<ChanId, { label: string; topic: string; dm?: boolean }> = {
  team: { label: '# team', topic: 'Backend team · 6 members' },
  incidents: { label: '# incidents', topic: 'Production alerts and incident comms' },
  priya: { label: 'Priya Raman', dm: true, topic: 'Engineering Manager' },
  daniel: { label: 'Daniel Okafor', dm: true, topic: 'Senior Engineer · your mentor' },
  leo: { label: 'Leo Martins', dm: true, topic: 'Engineer' },
}
export const CHAN_IDS = Object.keys(CHANS) as ChanId[]

export const APP_IDS: AppId[] = ['mail', 'chat', 'code', 'tracker', 'docs', 'monitor']
export const APP_NAMES: Record<AppId, string> = {
  mail: 'Outlook', chat: 'Teams', code: 'VS Code', tracker: 'Jira', docs: 'Confluence', monitor: 'CloudWatch',
}
export const COLS: [TicketStatus, string][] = [['todo', 'To do'], ['progress', 'In progress'], ['review', 'In review'], ['done', 'Done']]
export const PRIORITIES: Priority[] = ['Urgent', 'High', 'Medium', 'Low']
export const LEVELS: [Level, string, string][] = [
  ['newgrad', 'New grad', 'Your mentor spells out the next step and checks in sooner.'],
  ['bootcamp', 'Bootcamp grad', 'Your mentor asks pointed questions before giving pointers.'],
  ['switcher', 'Career switcher', 'Your mentor builds on your past work and expects clear communication.'],
]

// ---------- who is hurt when a login path breaks ----------
/** Accounts by how their people sign in. `password` and `sso` are user counts. */
export const CUSTOMERS = [
  { name: 'Northwind Freight', arr: '$84k', password: 22, sso: 38, note: 'Renewal demo 3:00 PM' },
  { name: 'Osprey Logistics', arr: '$31k', password: 67, sso: 0, note: '' },
  { name: 'Brightline Dental', arr: '$18k', password: 41, sso: 12, note: '' },
  { name: 'Juniper & Co.', arr: '$9k', password: 19, sso: 0, note: '' },
]
export const OTHER_ACCOUNTS = 214
/** Share of auth-api traffic (%) that turns into 401s when a check fails. Security checks cost nothing here: that is the point. */
export const SHARE: Record<CheckId, number> = {
  password_login: 34, dashboard_fallthrough: 4, api_key: 7, sso_after_refresh: 1.5,
  rejects_expired: 0, rejects_missing: 0, rejects_tampered: 0,
}
export const CHECK_LABEL: Record<CheckId, string> = {
  password_login: 'Email + password login', dashboard_fallthrough: 'Dashboard users without an API key',
  sso_after_refresh: 'SSO session after token refresh', api_key: 'API key requests',
  rejects_expired: 'Expired tokens are rejected', rejects_missing: 'Requests without a token are rejected',
  rejects_tampered: 'Tampered tokens are rejected',
}
export const failing = (checks: Check[]) => checks.filter(c => !c.ok).map(c => c.id)
export const failRate = (checks: Check[]) => failing(checks).reduce((n, id) => n + SHARE[id], 0)
/** True when customers can feel it (as opposed to a silent security hole). */
export const isOutage = (checks: Check[]) => failRate(checks) > ALARM

/** The deploy that was live at sim minute m. */
export const liveAt = (deploys: Deploy[], m: number) => deploys.findLast(d => d.at <= m) ?? deploys[0]
/** 401 error rate (%) on auth-api at sim minute m: baseline noise plus whatever the live deploy breaks, eased in over the rollout. */
export function errAt(deploys: Deploy[], m: number) {
  const noise = 0.45 + 0.22 * Math.sin(m * 1.7) + 0.12 * Math.sin(m * 0.6)
  const i = deploys.findLastIndex(d => d.at <= m)
  if (i < 0) return Math.max(0.1, noise)
  const now = failRate(deploys[i].checks), before = i > 0 ? failRate(deploys[i - 1].checks) : now
  const k = Math.min(1, Math.max(0, (m - deploys[i].at) / 2.2))
  const level = before + (now - before) * k
  return Math.max(0.1, noise + level * (1 + 0.04 * Math.sin(m * 2.3)))
}
/** People who cannot sign in at sim minute m. Grows as sessions expire, up to everyone on the broken paths. */
export function lockedAt(deploys: Deploy[], m: number) {
  const d = liveAt(deploys, m)
  if (!d || !isOutage(d.checks)) return 0
  const broken = failing(d.checks)
  const perAccount = (c: { password: number; sso: number }) => (broken.includes('password_login') ? c.password : 0) + (broken.includes('sso_after_refresh') ? c.sso : 0)
  const cap = CUSTOMERS.reduce((n, c) => n + perAccount(c), 0) + (broken.includes('password_login') ? 1191 : 0)
  return Math.max(0, Math.min(cap, Math.round(46 * (m - d.at - 1))))
}
/** Users locked out per named customer, easing in with the same curve. */
export function lockedFor(deploys: Deploy[], m: number, c: { password: number; sso: number }) {
  const d = liveAt(deploys, m)
  if (!d || !isOutage(d.checks)) return 0
  const broken = failing(d.checks)
  const total = (broken.includes('password_login') ? c.password : 0) + (broken.includes('sso_after_refresh') ? c.sso : 0)
  return Math.round(total * Math.min(1, Math.max(0, (m - d.at) / 10)))
}
