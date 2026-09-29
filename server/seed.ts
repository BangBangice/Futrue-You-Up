// What the world looks like at 1:10 PM on Day 2, before the player has touched anything. Content only.
import type { ChanId, ChatMsg, Doc, Email, Ticket } from '../shared/types.ts'

const code = (path: string) => ({ kind: 'code' as const, path })
const doc = (id: string) => ({ kind: 'doc' as const, doc: id })

export function initialEmails(): Email[] {
  return [
    {
      id: 'e1', folder: 'inbox', who: 'priya', subject: 'LED-214: SSO users logged out after ~1 hour', time: '1:10 PM', read: false, kind: 'assign',
      body: ['Hi Maya,', 'Handing you a real one today. Customers on SSO, Northwind included, get bounced to the login page after about an hour. Support has logged six tickets since Monday.', 'Northwind’s renewal demo is at 3:00 PM and Sam wants SSO stable before then. Can you take a look, get a fix out, and keep me posted?', 'Daniel knows the auth code best. He is your mentor this week, so lean on him.', 'Priya'],
      files: [{ kind: 'ticket', id: 'LED-214' }, code('src/auth/verifySession.ts')], thread: [],
    },
    {
      id: 'e2', folder: 'inbox', who: 'sam', subject: 'Northwind renewal demo, 3:00 PM today', time: '11:48 AM', read: true, files: [doc('northwind')], thread: [],
      body: ['Hi team,', 'Northwind Freight’s renewal demo is today at 3:00 PM. $84k ARR, 60 seats: 38 on SSO, 22 finance contractors on email + password.', 'Marta Lindqvist (Head of Finance Ops) is running it for their CFO. Their main complaint this quarter has been getting logged out mid-invoice run.', 'If anything’s flaky, tell me before 2:30 so I can plan around it.', 'Sam'],
    },
    {
      id: 'e3', folder: 'inbox', who: 'people', subject: 'Your Day 2 schedule', time: '9:02 AM', read: true, files: [], thread: [],
      body: ['Morning Maya,', 'Day 2: 9:30 standup, 12:00 lunch, afternoon is yours for LED tickets. Your 1:1 with Priya is Thursday.', 'People Ops'],
    },
    {
      id: 'e4', folder: 'inbox', who: 'priya', subject: 'Welcome to Ledgerly', time: 'Mon', read: true, files: [doc('home'), doc('deploy')], thread: [],
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
    daniel: [{ id: 6, who: 'daniel', time: 'Mon 3:05 PM', text: 'Welcome aboard. I’m your mentor this week. Ask me anything, and expect me to ask you things back.' }],
    leo: [{ id: 7, who: 'leo', time: 'Mon 2:20 PM', text: 'hey! I’m Leo, started 3 months ago. ask me anything about the local setup, it’s cursed' }],
  }
}

const ticket = (t: Omit<Ticket, 'comments' | 'activity'>): Ticket => ({ ...t, comments: [], activity: [] })
export function initialTickets(): Ticket[] {
  return [
    { ...ticket({ id: 'LED-214', title: 'SSO users logged out after ~1 hour', status: 'todo', who: 'maya', pri: 'High', pts: 3, desc: 'SSO customers are redirected to the login page roughly 60 minutes after signing in. The SSO refresh endpoint returns a new bearer token, but src/auth/verifySession.ts keeps reading the old session cookie. Reported by Northwind Freight and Osprey Logistics.' }),
      comments: [{ who: 'hana', time: 'Mon 3:40 PM', text: 'Six tickets so far, all SSO. Users say it happens "about an hour in", usually mid invoice run.' }, { who: 'priya', time: '1:09 PM', text: 'Assigning to Maya. Daniel to mentor.' }],
      activity: [{ time: 'Mon 3:31 PM', text: 'Hana Ito: created the issue' }, { time: '1:09 PM', text: 'Priya Raman: assignee → Maya Chen' }] },
    ticket({ id: 'LED-217', title: 'Audit log entry on SSO config change', status: 'todo', who: null, pri: 'Medium', pts: 2, desc: 'Record who changed an org’s SSO settings and when.' }),
    ticket({ id: 'LED-209', title: 'Invoice PDF shows wrong symbol for CHF', status: 'progress', who: 'leo', pri: 'Medium', pts: 1, desc: 'Swiss franc invoices render with a $ prefix.' }),
    ticket({ id: 'LED-211', title: 'Rate-limit /api/keys/rotate', status: 'review', who: 'daniel', pri: 'High', pts: 2, desc: 'Prevent key rotation from being called in a loop.' }),
    ticket({ id: 'LED-205', title: 'Move session store to Redis 7', status: 'done', who: 'daniel', pri: 'Medium', pts: 5, desc: 'Completed last sprint.' }),
    ticket({ id: 'LED-203', title: 'Webhook retries ignore 429', status: 'done', who: 'leo', pri: 'Medium', pts: 2, desc: 'Retries now back off on 429.' }),
  ]
}

const page = (d: Omit<Doc, 'version' | 'body'>, body: string): Doc => ({ ...d, version: 1, body: body.trim() })
/** The engineering wiki. Facts here must agree with workspace-template/ledgerly-api and with the scenario. */
export function initialDocs(): Doc[] {
  return [
    page({ id: 'home', title: 'Engineering home', group: 'Overview', owner: 'priya', updated: 'Sep 22' }, `
Everything the backend team has written down. If something here is wrong or missing, fix it: the wiki is part of the codebase.

## Start here

- [Auth service: login paths](doc:auth)
- [Deploy and rollback](doc:deploy)
- [Incident response](doc:incident)
- [Running tests locally](doc:tests)

## How we work

- Small changes, shipped early in the day.
- Shared code gets a second pair of eyes, even if it is only a message in #team.
- When prod breaks, restore service first and investigate after.
- Every incident gets a blameless postmortem the same day.

> [!TIP] Who to ask
> New this week? Your mentor is Daniel Okafor. For customers, Sam Whitfield.
`),
    page({ id: 'auth', title: 'Auth service: login paths', group: 'Auth', owner: 'daniel', updated: 'Sep 18' }, `
\`auth-api\` decides who you are on every request. There are three ways to log in to Ledgerly, and all three end in one function: \`verifySession\`. A change there reaches every customer.

## The three paths

| Path | How the client sends the token | Entry point |
|---|---|---|
| SSO | \`Authorization: Bearer\` header, refreshed every 55 minutes | src/sso/refresh.ts |
| Email + password | \`ldg_session\` cookie (httpOnly). No header is ever sent. | src/auth/passwordLogin.ts |
| API keys | \`x-api-key\` header. Dashboard users without a key fall through to \`verifySession\`. | src/auth/apiKeyAuth.ts |

> [!WARNING] Shared by every login path
> Before you change how \`verifySession\` reads the token, check what each of the three paths actually sends. The test helper sends the token both ways, so a green run does not prove every path works.

## Source

- src/auth/verifySession.ts
- src/auth/passwordLogin.ts
- src/auth/apiKeyAuth.ts
- src/sso/refresh.ts
- src/test/helpers.ts

## Related

- [Sessions and token expiry](doc:sessions)
- [Deploy and rollback](doc:deploy)
`),
    page({ id: 'sessions', title: 'Sessions and token expiry', group: 'Auth', owner: 'daniel', updated: 'Sep 11' }, `
Sessions are JWTs. How long one lives depends on how the user logged in.

| Login | Lifetime | Renewal |
|---|---|---|
| Email + password | 12 hours | User signs in again |
| SSO | 1 hour | Web app calls the refresh endpoint at 55 minutes and gets a new bearer token |

## Known issue

SSO users are bounced to the login page after about an hour. The refresh endpoint hands back a new bearer token, but \`verifySession\` keeps reading the old session cookie. Tracked as LED-214.

## Clock skew

Identity providers and our pods drift by a few seconds. Expiry checks should allow a small skew instead of rejecting a token that is one second old.

\`\`\`ts
isExpired(claims, { skewSec: 60 })
\`\`\`
`),
    page({ id: 'deploy', title: 'Deploy and rollback', group: 'Runbooks', owner: 'daniel', updated: 'Sep 24' }, `
You have prod access from day one. Both commands below post to #incidents so the team can see what changed and when.

## Deploy

\`\`\`
git commit -am "fix(auth): what you changed (LED-123)"
ldg deploy auth-api --env prod
\`\`\`

1. Run the tests for what you touched.
2. Ask yourself what the tests do not cover.
3. Deploy, then watch the 401 rate in CloudWatch for five minutes.
4. Stay at your desk for ten minutes after a deploy.

## Rollback

\`\`\`
ldg rollback auth-api
\`\`\`

A rollback is one command and puts known-good code back in about a minute. It is always allowed and never needs approval.

> [!NOTE] Quiet hours
> Avoid prod deploys in the two hours before a customer demo. Check #team for anything scheduled.
`),
    page({ id: 'incident', title: 'Incident response', group: 'Runbooks', owner: 'priya', updated: 'Sep 15' }, `
An incident is anything customers can feel. The author of the most recent deploy owns it until someone else explicitly takes over.

## What to do

1. Acknowledge in #incidents within two minutes. "Investigating, likely my deploy" is enough.
2. Restore service first. If a deploy lines up with the alert, roll back.
3. Post an update every ten minutes, even if nothing changed.
4. Tell affected customers what broke and what happens next. Copy the account owner.
5. Send a postmortem the same day.

> [!WARNING] Revert or patch?
> Patching forward puts new, untested code into prod during an outage. Roll back unless rolling back is impossible.

## Related

- [Deploy and rollback](doc:deploy)
- [Postmortem template](doc:postmortem)
`),
    page({ id: 'postmortem', title: 'Postmortem template', group: 'Runbooks', owner: 'priya', updated: 'Aug 30' }, `
Blameless and short. Ten minutes of writing while it is fresh. Create a page in this space, or reply to the request email.

| Heading | What goes in it |
|---|---|
| Summary | What happened, from when to when, in two sentences |
| Impact | Who was affected, how many users, for how long |
| Cause | The change that caused it and why it had that effect |
| Fix | What restored service |
| What we’ll change | Tests, process or tooling that would have caught it |

> [!TIP] Blameless
> Write "the change did X", not "I broke X". We fix systems, not people.
`),
    page({ id: 'tests', title: 'Running tests locally', group: 'Local development', owner: 'leo', updated: 'Sep 26' }, `
The full suite takes about nine minutes on a laptop. You almost never need all of it.

## Run one area

\`\`\`
npm test -- src/auth
\`\`\`

## Run one file

\`\`\`
npm test -- src/auth/verifySession.test.ts
\`\`\`

> [!NOTE] Passing is not the same as safe
> A green suite tells you the paths it covers still work. Ask what it does not cover before you trust it.
`),
    page({ id: 'northwind', title: 'Account: Northwind Freight', group: 'Customers', owner: 'sam', updated: 'Sep 28' }, `
| | |
|---|---|
| ARR | $84k |
| Seats | 60: 38 on SSO, 22 finance contractors on email + password |
| Main contact | Marta Lindqvist, Head of Finance Ops |
| Account owner | Sam Whitfield |

## Renewal

Renewal demo is Tuesday, Sep 29 at 3:00 PM. Marta is presenting the new invoice run to their CFO.

Their main complaint this quarter has been getting logged out in the middle of an invoice run.

> [!WARNING] Demo day
> If anything is flaky on the day, tell Sam before 2:30 so he can plan around it.
`),
  ]
}
