// Scenario content and types for the Day 2 shift at Ledgerly. No logic here.
import type { DocId } from './docs.ts'

export type AppId = 'mail' | 'chat' | 'code' | 'tracker' | 'docs' | 'monitor'
export type PersonId = 'maya' | 'priya' | 'daniel' | 'leo' | 'sam' | 'hana' | 'marta' | 'people' | 'cloudwatch'
export type ChanId = 'team' | 'incidents' | 'priya' | 'daniel' | 'leo'
export type FileId = 'vs' | 'pw' | 'key' | 'test' | 'sso'
export type Level = 'newgrad' | 'bootcamp' | 'switcher'
export type Phase = 'calm' | 'deployed' | 'incident' | 'patching' | 'recovering' | 'resolved'
export type Stage = 'onboard' | 'sim' | 'debrief' | 'report'
export type Theme = 'light' | 'dark'
export type MeterId = 'trust' | 'rep' | 'rel'
export type Folder = 'inbox' | 'alerts' | 'sent' | 'archive' | 'deleted'
export type CodeStage = 'draft' | 'deployed' | 'reverted' | 'patched'
export type TicketStatus = 'todo' | 'progress' | 'review' | 'done'
export type Tone = 'dim' | 'accent' | 'bad' | 'good' | 'out'
export type Tag = 'Missed signal' | 'Root cause' | 'Strong' | 'Could improve'

/** Something attached to an email or chat message. Everything except an upload opens inside the sim. */
export type Attachment =
  | { kind: 'code'; file: FileId }
  | { kind: 'doc'; doc: DocId }
  | { kind: 'ticket'; id: string }
  | { kind: 'link'; label: string; app: AppId; chan?: ChanId }
  | { kind: 'upload'; name: string; size: number; url: string }
export interface Compose { mode: 'reply' | 'new' | 'forward'; to: string; subject: string }
export interface Email {
  id: string; folder: Folder; who: PersonId; toName?: string; subject: string; time: string; read: boolean
  kind?: 'assign' | 'support' | 'client' | 'sam' | 'pm'
  flagged?: boolean; body: string[]; files: Attachment[]; thread: { time: string; text: string; files: Attachment[] }[]
}
export interface ChatMsg { id: number; who: PersonId; time: string; text: string; alert?: 'fire' | 'ok' | 'info'; files?: Attachment[] }
export interface Ticket {
  id: string; title: string; status: TicketStatus; who: PersonId | null
  pri: 'Urgent' | 'High' | 'Medium'; pts: number | null; desc: string; reopened?: boolean
}
export interface TermLine { c: 'cmd' | 'ok' | 'err' | 'dim' | 'out'; t: string }
export interface TimelineEv { time: string; text: string; tone: Tone }
export interface Win { open: boolean; min: boolean; max: boolean; x: number; y: number; w: number; h: number; z: number }
export interface Toast { id: number; app: AppId; title: string; body: string; go: () => void }

/** Everything the player did (or didn't), stamped with the sim minute it happened. Drives the debrief. */
export interface Flags {
  leoAsked?: boolean; leoAskedAt?: number; leo?: 'helped' | 'deferred'; leoAt?: number
  readTeam?: number; viewPwd?: number; ranTests?: number; deploy?: number; assignAck?: number
  incident?: number; ack?: number; ackText?: string; danielAsked?: number
  clientMailAt?: number; client?: number; clientText?: string; support?: number; samReply?: number
  choice?: 'revert' | 'patch'; choiceAt?: number; resolved?: number; demoHit?: boolean
  pm?: number; pmText?: string
}

export interface SimState {
  stage: Stage; level: Level; theme: Theme; simMin: number; phase: Phase
  meters: Record<MeterId, number>; flash: Partial<Record<MeterId, { d: number; id: number } | null>>
  wins: Record<AppId, Win>; topZ: number; focus: AppId | null; toasts: Toast[]; desk: { W: number; H: number }
  emails: Email[]; mailFolder: Folder; mailSel: string; mailDraft: string; mailFiles: Attachment[]; compose: Compose | null
  chats: Record<ChanId, ChatMsg[]>; chan: ChanId; chatDraft: string; chatFiles: Attachment[]
  typing: { chan: ChanId; who: PersonId } | null; unreadChat: Record<ChanId, number>
  tickets: Ticket[]; ticketSel: string; trackerNew: number; monitorSeen: boolean; docPage: DocId
  codeFile: FileId; codeStage: CodeStage; term: TermLine[]; testsBusy: boolean; deployBusy: boolean
  timeline: TimelineEv[]; f: Flags
}

export const START = 790 // 1:10 PM, in minutes since midnight
export const DEMO = 900 // 3:00 PM
export const RATE = 41 // revenue exposed per incident minute
export const LIVE: Phase[] = ['incident', 'patching', 'recovering']
export const HINT: Record<Level, number> = { newgrad: 7, bootcamp: 10, switcher: 13 }
export const START_METERS: Record<MeterId, number> = { trust: 64, rep: 58, rel: 71 }

export const clock = (m: number) => {
  const h24 = Math.floor(m / 60) % 24, mm = m % 60, h = ((h24 + 11) % 12) + 1
  return h + ':' + String(mm).padStart(2, '0') + ' ' + (h24 >= 12 ? 'PM' : 'AM')
}
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
export const dur = (n: number) => (n >= 60 ? Math.floor(n / 60) + 'h ' + (n % 60) + 'm' : n + 'm')

export const PEOPLE: Record<PersonId, { name: string; init: string; color: string; email: string }> = {
  maya: { name: 'Maya Chen', init: 'MC', color: '#2f6fde', email: 'maya.chen@ledgerly.io' },
  priya: { name: 'Priya Raman', init: 'PR', color: '#c2542d', email: 'priya@ledgerly.io' },
  daniel: { name: 'Daniel Okafor', init: 'DO', color: '#1f7a6d', email: 'daniel@ledgerly.io' },
  leo: { name: 'Leo Martins', init: 'LM', color: '#7a4fd6', email: 'leo@ledgerly.io' },
  sam: { name: 'Sam Whitfield', init: 'SW', color: '#a86a12', email: 'sam@ledgerly.io' },
  hana: { name: 'Hana Ito', init: 'HI', color: '#b83a78', email: 'hana@ledgerly.io' },
  marta: { name: 'Marta Lindqvist', init: 'ML', color: '#3d4a5c', email: 'marta.lindqvist@northwindfreight.com' },
  people: { name: 'People Ops', init: 'PO', color: '#6b7280', email: 'people@ledgerly.io' },
  cloudwatch: { name: 'CloudWatch', init: 'CW', color: '#e2661b', email: 'alarms@cloudwatch.ledgerly.io' },
}

export const CHANS: Record<ChanId, { label: string; topic: string; dm?: boolean }> = {
  team: { label: '# team', topic: 'Backend team · 6 members' },
  incidents: { label: '# incidents', topic: 'Production alerts and incident comms' },
  priya: { label: 'Priya Raman', dm: true, topic: 'Engineering Manager' },
  daniel: { label: 'Daniel Okafor', dm: true, topic: 'Senior Engineer · in design reviews until 2:30' },
  leo: { label: 'Leo Martins', dm: true, topic: 'Engineer' },
}

export const APP_IDS: AppId[] = ['mail', 'chat', 'code', 'tracker', 'docs', 'monitor']
export const APP_NAMES: Record<AppId, string> = {
  mail: 'Outlook', chat: 'Teams', code: 'VS Code', tracker: 'Jira', docs: 'Confluence', monitor: 'CloudWatch',
}

export const WALL: Record<string, Record<Theme, string>> = {
  Dusk: {
    light: 'radial-gradient(90% 70% at 15% 15%, #f6c7a4 0%, rgba(246,199,164,0) 60%), radial-gradient(80% 70% at 85% 25%, #c3b2ee 0%, rgba(195,178,238,0) 60%), radial-gradient(90% 80% at 60% 100%, #5b5fae 0%, rgba(91,95,174,0) 70%), linear-gradient(160deg, #e9b99f, #8a7cc0 55%, #3f4486)',
    dark: 'radial-gradient(90% 70% at 15% 15%, #6d4234 0%, rgba(109,66,52,0) 60%), radial-gradient(80% 70% at 85% 25%, #3a3070 0%, rgba(58,48,112,0) 60%), linear-gradient(160deg, #35262f, #1d1d3a 55%, #0c0d1a)',
  },
  Graphite: {
    light: 'radial-gradient(100% 80% at 30% 0%, #d2d6dd 0%, rgba(210,214,221,0) 60%), linear-gradient(170deg, #a9b1bc, #5b6470)',
    dark: 'radial-gradient(100% 80% at 30% 0%, #3a3f47 0%, rgba(58,63,71,0) 60%), linear-gradient(170deg, #24272d, #0e1013)',
  },
  Tide: {
    light: 'radial-gradient(90% 70% at 80% 10%, #c4e6e8 0%, rgba(196,230,232,0) 60%), radial-gradient(90% 80% at 10% 90%, #2f6f8f 0%, rgba(47,111,143,0) 70%), linear-gradient(165deg, #9fd0d6, #3d7fa0 55%, #1e3f5e)',
    dark: 'radial-gradient(90% 70% at 80% 10%, #1d4852 0%, rgba(29,72,82,0) 60%), linear-gradient(165deg, #15313a, #0b1a27 60%, #060c14)',
  },
}

export const FILES: Record<FileId, { name: string; path: string }> = {
  vs: { name: 'verifySession.ts', path: 'src/auth/verifySession.ts' },
  pw: { name: 'passwordLogin.ts', path: 'src/auth/passwordLogin.ts' },
  key: { name: 'apiKeyAuth.ts', path: 'src/auth/apiKeyAuth.ts' },
  test: { name: 'verifySession.test.ts', path: 'src/auth/verifySession.test.ts' },
  sso: { name: 'refresh.ts', path: 'src/sso/refresh.ts' },
}

// Source lines: first character is the diff sign (' ', '+', '-'), the rest is the code.
const VS_HEAD = [" import { decodeJwt, isExpired } from './jwt'", " import type { Request } from '../http'", ' ', ' // Used by every authenticated route', ' export async function verifySession(req: Request) {']
const VS_TAIL_NEW = ["   if (!token) return { ok: false, reason: 'missing_token' }", ' ', '   const claims = decodeJwt(token)', '-  if (isExpired(claims, { skewSec: 0 })) {', '+  if (isExpired(claims, { skewSec: 60 })) {', "     return { ok: false, reason: 'expired' }", '   }', '+  // SSO refresh returns a new bearer token every 55 min', '   return { ok: true, userId: claims.sub, org: claims.org }', ' }']
export const CODE: Record<'vs_draft' | 'vs_reverted' | 'vs_patched' | Exclude<FileId, 'vs'>, string[]> = {
  vs_draft: [...VS_HEAD, "-  const token = req.cookies['ldg_session']", "+  const header = req.headers['authorization'] ?? ''", "+  const token = header.replace(/^Bearer\\s+/i, '')", ...VS_TAIL_NEW],
  vs_reverted: [...VS_HEAD, "   const token = req.cookies['ldg_session']", "   if (!token) return { ok: false, reason: 'missing_token' }", ' ', '   const claims = decodeJwt(token)', '   if (isExpired(claims, { skewSec: 0 })) {', "     return { ok: false, reason: 'expired' }", '   }', '   return { ok: true, userId: claims.sub, org: claims.org }', ' }'],
  vs_patched: [...VS_HEAD, "   const header = req.headers['authorization'] ?? ''", "-  const token = header.replace(/^Bearer\\s+/i, '')", "+  const bearer = header.replace(/^Bearer\\s+/i, '')", "+  const token = bearer || req.cookies['ldg_session']", ...VS_TAIL_NEW.filter(l => l[0] !== '-').map(l => ' ' + l.slice(1))],
  pw: [" import { checkPassword } from './passwords'", " import { signJwt } from './jwt'", ' ', ' export async function passwordLogin(req, res) {', '   const user = await checkPassword(req.body.email, req.body.password)', "   if (!user) return res.status(401).json({ error: 'invalid_credentials' })", ' ', "   const token = signJwt({ sub: user.id, org: user.orgId }, { ttl: '12h' })", "   res.cookie('ldg_session', token, { httpOnly: true, sameSite: 'lax' })", '   return res.json({ ok: true })', ' }'],
  key: [" import { verifySession } from './verifySession'", " import { lookupKey } from '../keys'", ' ', ' export async function apiKeyAuth(req) {', "   const key = req.headers['x-api-key']", '   if (!key) return verifySession(req)   // dashboard users fall through', '   const record = await lookupKey(key)', "   return record ? { ok: true, org: record.orgId } : { ok: false, reason: 'bad_key' }", ' }'],
  sso: [' export async function refreshSso(req, res) {', '   const session = await idp.refresh(req.body.refreshToken)', "   const token = signJwt({ sub: session.userId, org: session.orgId }, { ttl: '1h' })", '   // the web app stores this and sends it as `Authorization: Bearer …`', '   return res.json({ accessToken: token, expiresIn: 3600 })', ' }'],
  test: [" import { verifySession } from './verifySession'", " import { mockReq, validJwt, expiredJwt } from '../test/helpers'", ' ', " describe('verifySession', () => {", "   it('accepts a valid bearer token', async () => {", '     const req = mockReq({ headers: { authorization: `Bearer ${validJwt()}` } })', '     expect((await verifySession(req)).ok).toBe(true)', '   })', "   it('rejects an expired bearer token', async () => { … })", "   it('allows 60s clock skew on SSO refresh', async () => { … })", "   it('rejects a missing token', async () => { … })", ' })'],
}

export const CUSTOMERS = [
  { name: 'Northwind Freight', arr: '$84k', base: 22, note: 'Renewal demo 3:00 PM' },
  { name: 'Osprey Logistics', arr: '$31k', base: 67, note: '' },
  { name: 'Brightline Dental', arr: '$18k', base: 41, note: '' },
  { name: 'Juniper & Co.', arr: '$9k', base: 19, note: '' },
]

export const METERS: [MeterId, string, string][] = [
  ['trust', 'Manager trust', 'Trust'],
  ['rep', 'Team reputation', 'Team rep'],
  ['rel', 'Reliability', 'Reliability'],
]

export const LEVELS: [Level, string, string][] = [
  ['newgrad', 'New grad', 'Colleagues check in sooner and hints arrive earlier.'],
  ['bootcamp', 'Bootcamp grad', 'Standard pacing. Hints arrive once you’ve had a real go.'],
  ['switcher', 'Career switcher', 'More autonomy, later hints, higher expectations on communication.'],
]

export const COLS: [TicketStatus, string][] = [['todo', 'To do'], ['progress', 'In progress'], ['review', 'In review'], ['done', 'Done']]

export function initialEmails(): Email[] {
  return [
    {
      id: 'e1', folder: 'inbox', who: 'priya', subject: 'LED-214: SSO users logged out after ~1 hour', time: '1:10 PM', read: false, kind: 'assign',
      body: ['Hi Maya,', 'Handing you a real one today. Customers on SSO, Northwind included, get bounced to the login page after about an hour. Support has logged six tickets since Monday.', 'Northwind’s renewal demo is at 3:00 PM and Sam wants SSO stable before then. Can you take a look, get a fix out, and keep me posted?', 'Daniel knows the auth code best, but he’s in design reviews most of the afternoon.', 'Priya'],
      files: [{ kind: 'ticket', id: 'LED-214' }, { kind: 'code', file: 'vs' }], thread: [],
    },
    {
      id: 'e2', folder: 'inbox', who: 'sam', subject: 'Northwind renewal demo, 3:00 PM today', time: '11:48 AM', read: true, files: [{ kind: 'doc', doc: 'northwind' }], thread: [],
      body: ['Hi team,', 'Northwind Freight’s renewal demo is today at 3:00 PM. $84k ARR, 60 seats: 38 on SSO, 22 finance contractors on email + password.', 'Marta Lindqvist (Head of Finance Ops) is running it for their CFO. Their main complaint this quarter has been getting logged out mid-invoice run.', 'If anything’s flaky, tell me before 2:30 so I can plan around it.', 'Sam'],
    },
    {
      id: 'e3', folder: 'inbox', who: 'people', subject: 'Your Day 2 schedule', time: '9:02 AM', read: true, files: [], thread: [],
      body: ['Morning Maya,', 'Day 2: 9:30 standup, 12:00 lunch, afternoon is yours for LED tickets. Your 1:1 with Priya is Thursday.', 'People Ops'],
    },
    {
      id: 'e4', folder: 'inbox', who: 'priya', subject: 'Welcome to Ledgerly', time: 'Mon', read: true, files: [{ kind: 'doc', doc: 'home' }, { kind: 'doc', doc: 'deploy' }], thread: [],
      body: ['Welcome, Maya!', 'Your laptop is set up and you have prod deploy access for auth-api and billing-api. Daniel is your go-to for anything auth.', 'Deploys go out with ldg deploy, rollbacks with ldg rollback. Both post to #incidents.', 'Priya'],
    },
    {
      id: 'e5', folder: 'alerts', who: 'cloudwatch', subject: '[RESOLVED] billing-worker queue lag', time: 'Mon', read: true, files: [{ kind: 'link', label: 'CloudWatch dashboard', app: 'monitor' }], thread: [],
      body: ['billing-worker queue lag returned under threshold (30s).', 'Duration: 14 min · Acknowledged by Daniel Okafor'],
    },
  ]
}

export function initialChats(): Record<ChanId, ChatMsg[]> {
  return {
    team: [
      { id: 1, who: 'leo', time: '11:52 AM', text: 'lunch order closes in 5, anyone want tacos?' },
      { id: 2, who: 'daniel', time: '11:53 AM', text: 'two al pastor please' },
      { id: 3, who: 'priya', time: '12:30 PM', text: 'Reminder: Northwind renewal demo at 3:00. Let’s keep prod quiet this afternoon.' },
    ],
    incidents: [{ id: 4, who: 'cloudwatch', time: 'Mon 4:12 PM', text: '[RESOLVED] billing-worker · queue lag back under 30s · 14 min', alert: 'ok' }],
    priya: [{ id: 5, who: 'priya', time: 'Mon 5:40 PM', text: 'Great first day. Tomorrow I’ll hand you something real.' }],
    daniel: [{ id: 6, who: 'daniel', time: 'Mon 3:05 PM', text: 'Welcome aboard. My calendar is chaos, but ping me any time and I’ll answer between meetings.' }],
    leo: [{ id: 7, who: 'leo', time: 'Mon 2:20 PM', text: 'hey! I’m Leo, started 3 months ago. ask me anything about the local setup, it’s cursed' }],
  }
}

export function initialTickets(): Ticket[] {
  return [
    { id: 'LED-214', title: 'SSO users logged out after ~1 hour', status: 'todo', who: 'maya', pri: 'High', pts: 3, desc: 'SSO customers are redirected to the login page roughly 60 minutes after signing in. The SSO refresh endpoint returns a new bearer token, but verifySession keeps reading the old session cookie. Reported by Northwind Freight and Osprey Logistics.' },
    { id: 'LED-217', title: 'Audit log entry on SSO config change', status: 'todo', who: null, pri: 'Medium', pts: 2, desc: 'Record who changed an org’s SSO settings and when.' },
    { id: 'LED-209', title: 'Invoice PDF shows wrong symbol for CHF', status: 'progress', who: 'leo', pri: 'Medium', pts: 1, desc: 'Swiss franc invoices render with a $ prefix.' },
    { id: 'LED-211', title: 'Rate-limit /api/keys/rotate', status: 'review', who: 'daniel', pri: 'High', pts: 2, desc: 'Prevent key rotation from being called in a loop.' },
    { id: 'LED-205', title: 'Move session store to Redis 7', status: 'done', who: 'daniel', pri: 'Medium', pts: 5, desc: 'Completed last sprint.' },
    { id: 'LED-203', title: 'Webhook retries ignore 429', status: 'done', who: 'leo', pri: 'Medium', pts: 2, desc: 'Retries now back off on 429.' },
  ]
}

export const INITIAL_TERM: TermLine[] = [
  { c: 'dim', t: 'Last login: Tue Sep 29 09:14 on ttys002' },
  { c: 'cmd', t: 'git status' },
  { c: 'out', t: 'On branch maya/led-214-sso-expiry' },
  { c: 'out', t: 'Changes not staged for commit:' },
  { c: 'err', t: '        modified:   src/auth/verifySession.ts' },
]
