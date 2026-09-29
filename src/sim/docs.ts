// Ledgerly's engineering wiki, shown in Confluence. Content only.
// Facts here must agree with the scenario in engine.ts and the code in data.ts.
import type { FileId, PersonId } from './data.ts'

export type DocId = 'home' | 'auth' | 'sessions' | 'deploy' | 'incident' | 'postmortem' | 'tests' | 'northwind'

/** Text supports `inline code`, and file names, ticket ids and #channels become links. */
export type Block =
  | { h: string }
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { code: string }
  | { note: string; tone: 'info' | 'warn' | 'tip'; title: string }
  | { table: string[][] } // first row is the header
  | { files: FileId[] }
  | { pages: DocId[] }

export interface Doc { id: DocId; title: string; group: string; owner: PersonId; updated: string; blocks: Block[] }

export const DOCS: Record<DocId, Doc> = {
  home: {
    id: 'home', title: 'Engineering home', group: 'Overview', owner: 'priya', updated: 'Sep 22',
    blocks: [
      { p: 'Everything the backend team has written down. If something here is wrong or missing, fix it: the wiki is part of the codebase.' },
      { h: 'Start here' },
      { pages: ['auth', 'deploy', 'incident', 'tests'] },
      { h: 'How we work' },
      { list: ['Small changes, shipped early in the day.', 'Shared code gets a second pair of eyes, even if it is only a message in #team.', 'When prod breaks, restore service first and investigate after.', 'Every incident gets a blameless postmortem the same day.'] },
      { note: 'New this week? Your go-to for anything auth is Daniel Okafor. For customers, Sam Whitfield.', tone: 'tip', title: 'Who to ask' },
    ],
  },
  auth: {
    id: 'auth', title: 'Auth service: login paths', group: 'Auth', owner: 'daniel', updated: 'Sep 18',
    blocks: [
      { p: '`auth-api` decides who you are on every request. There are three ways to log in to Ledgerly, and all three end in one function: `verifySession`. A change there reaches every customer.' },
      { h: 'The three paths' },
      { table: [
        ['Path', 'How the client sends the token', 'Entry point'],
        ['SSO', '`Authorization: Bearer` header, refreshed every 55 minutes', 'src/sso/refresh.ts'],
        ['Email + password', '`ldg_session` cookie (httpOnly). No header is ever sent.', 'src/auth/passwordLogin.ts'],
        ['API keys', '`x-api-key` header. Dashboard users without a key fall through to `verifySession`.', 'src/auth/apiKeyAuth.ts'],
      ] },
      { note: 'Before you change how `verifySession` reads the token, check what each of the three paths actually sends. The test suite mostly covers bearer tokens.', tone: 'warn', title: 'Shared by every login path' },
      { h: 'Source' },
      { files: ['vs', 'pw', 'key', 'sso', 'test'] },
      { h: 'Related' },
      { pages: ['sessions', 'deploy'] },
    ],
  },
  sessions: {
    id: 'sessions', title: 'Sessions and token expiry', group: 'Auth', owner: 'daniel', updated: 'Sep 11',
    blocks: [
      { p: 'Sessions are JWTs. How long one lives depends on how the user logged in.' },
      { table: [
        ['Login', 'Lifetime', 'Renewal'],
        ['Email + password', '12 hours', 'User signs in again'],
        ['SSO', '1 hour', 'Web app calls the refresh endpoint at 55 minutes and gets a new bearer token'],
      ] },
      { h: 'Known issue' },
      { p: 'SSO users are bounced to the login page after about an hour. The refresh endpoint hands back a new bearer token, but `verifySession` keeps reading the old session cookie. Tracked as LED-214.' },
      { h: 'Clock skew' },
      { p: 'Identity providers and our pods drift by a few seconds. Expiry checks should allow a small skew instead of rejecting a token that is one second old.' },
      { code: 'isExpired(claims, { skewSec: 60 })' },
    ],
  },
  deploy: {
    id: 'deploy', title: 'Deploy and rollback', group: 'Runbooks', owner: 'daniel', updated: 'Sep 24',
    blocks: [
      { p: 'You have prod access from day one. Both commands below post to #incidents so the team can see what changed and when.' },
      { h: 'Deploy' },
      { code: 'ldg deploy auth-api --env prod' },
      { steps: ['Run the tests for what you touched.', 'Deploy to one pod and watch the 401 rate in CloudWatch for five minutes.', 'Roll out to the remaining pods.', 'Stay at your desk for ten minutes after a deploy.'] },
      { h: 'Rollback' },
      { code: 'ldg rollback auth-api --to <sha>' },
      { p: 'A rollback is one command and puts known-good code back in about a minute. It is always allowed and never needs approval.' },
      { note: 'Avoid prod deploys in the two hours before a customer demo. Check #team for anything scheduled.', tone: 'info', title: 'Quiet hours' },
    ],
  },
  incident: {
    id: 'incident', title: 'Incident response', group: 'Runbooks', owner: 'priya', updated: 'Sep 15',
    blocks: [
      { p: 'An incident is anything customers can feel. The author of the most recent deploy owns it until someone else explicitly takes over.' },
      { h: 'What to do' },
      { steps: ['Acknowledge in #incidents within two minutes. “Investigating, likely my deploy” is enough.', 'Restore service first. If a deploy lines up with the alert, roll back.', 'Post an update every ten minutes, even if nothing changed.', 'Tell affected customers what broke and what happens next. Copy the account owner.', 'Send a postmortem the same day.'] },
      { note: 'Patching forward puts new, untested code into prod during an outage. Roll back unless rolling back is impossible.', tone: 'warn', title: 'Revert or patch?' },
      { h: 'Related' },
      { pages: ['deploy', 'postmortem'] },
    ],
  },
  postmortem: {
    id: 'postmortem', title: 'Postmortem template', group: 'Runbooks', owner: 'priya', updated: 'Aug 30',
    blocks: [
      { p: 'Blameless and short. Ten minutes of writing while it is fresh. Reply to the request email or post it in #incidents.' },
      { table: [
        ['Heading', 'What goes in it'],
        ['Summary', 'What happened, from when to when, in two sentences'],
        ['Impact', 'Who was affected, how many users, for how long'],
        ['Cause', 'The change that caused it and why it had that effect'],
        ['Fix', 'What restored service'],
        ['What we’ll change', 'Tests, process or tooling that would have caught it'],
      ] },
      { note: 'Write “the change did X”, not “I broke X”. We fix systems, not people.', tone: 'tip', title: 'Blameless' },
    ],
  },
  tests: {
    id: 'tests', title: 'Running tests locally', group: 'Local development', owner: 'leo', updated: 'Sep 26',
    blocks: [
      { p: 'The full suite takes about nine minutes on a laptop. You almost never need all of it.' },
      { h: 'Run one area' },
      { code: 'npm test -- src/auth' },
      { p: 'Add `--watch` to re-run on save while you work.' },
      { code: 'npm test -- src/auth --watch' },
      { note: 'A green suite tells you the paths it covers still work. Ask what it does not cover before you trust it.', tone: 'info', title: 'Passing is not the same as safe' },
    ],
  },
  northwind: {
    id: 'northwind', title: 'Account: Northwind Freight', group: 'Customers', owner: 'sam', updated: 'Sep 28',
    blocks: [
      { table: [
        ['', ''],
        ['ARR', '$84k'],
        ['Seats', '60: 38 on SSO, 22 finance contractors on email + password'],
        ['Main contact', 'Marta Lindqvist, Head of Finance Ops'],
        ['Account owner', 'Sam Whitfield'],
      ] },
      { h: 'Renewal' },
      { p: 'Renewal demo is Tuesday, Sep 29 at 3:00 PM. Marta is presenting the new invoice run to their CFO.' },
      { p: 'Their main complaint this quarter has been getting logged out in the middle of an invoice run.' },
      { note: 'If anything is flaky on the day, tell Sam before 2:30 so he can plan around it.', tone: 'warn', title: 'Demo day' },
    ],
  },
}

export const DOC_IDS = Object.keys(DOCS) as DocId[]
