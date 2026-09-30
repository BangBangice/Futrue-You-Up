# Futrue-You-Up
Team Future, You Up?

## LARP

A workplace simulator for the people whose first rung has been automated away.

You get a work computer, a real codebase and a real ticket. Colleagues message you, a client escalates, and what you ship decides what happens next. When it goes wrong, a senior engineer steps in on Teams, shows you who it affected, and helps you put it right. There is no score.

### Tech stack

| Layer | What |
|---|---|
| Runtime | Node 22.15+, running TypeScript directly with `--experimental-strip-types` (no build step for the server) |
| Browser app | React 19, React Router 7, Vite 8, Monaco editor (VS Code), Motion, lucide-react icons, react-markdown with remark-gfm |
| Server | Express 5, Server-Sent Events for the live world stream, Zod 4 for validating requests and scenario files |
| AI | Perplexity's Agent API (OpenAI-style tool calls), default model `openai/gpt-6-luna`; scripted fallback when it is off or down |
| Database (optional) | PostgreSQL 17 through Drizzle ORM and drizzle-kit migrations, `pg` driver |
| Accounts (with a database) | Better Auth: email and password, Google, guests, JWT/JWKS for other services |
| Email | Resend in production, Mailpit locally, console otherwise |
| Player code sandbox | A guarded local child process, or an [E2B](https://e2b.dev) cloud sandbox when `E2B_API_KEY` is set |
| Files attached from the player's computer | This server's disk by default, or any S3-compatible bucket (Railway's storage bucket, MinIO locally) |
| Language | TypeScript 7 throughout (`shared/` is used by both sides) |
| Ops | Docker (`node:26-slim`), docker compose for local Postgres, Mailpit and a bucket, Railway for hosting, GitHub Actions CI |

### Run it

Needs Node 22.15 or newer (CI and the Docker image use Node 26) and git.

```
npm install
cp .env.example .env      # then paste your Perplexity API key into .env
npm run dev
```

Open http://localhost:5183.

No key? It still runs. Colleagues fall back to scripted lines and no network is needed. You can force that with `LLM=stub npm run dev`.

| Command | What it does |
|---|---|
| `npm run dev` | The app and its API on one port |
| `npm run lint` | Lints the whole codebase with [oxlint](https://oxc.rs) (no warnings allowed) |
| `npm run check` | Plays a whole shift without a browser or the AI model and checks the outcome, then checks attached files |
| `npm run check:uploads` | Attached files: stored, served back, kept out of other shifts, and thrown away. Add the bucket's `STORAGE=s3 S3_*` to run it against one |
| `npm run llm:smoke` | One real call to the AI model, to check the key works |
| `npm run build` then `npm start` | Type-check and production build, served by the same server |
| `npm run check:db` | Against a running database: run round trip, lesson library, authoring and moderation |
| `npm run check:auth` | Against a running database: sign-in, ownership, email confirmation, guest upgrades, password reset |
| `npm run check:e2b` | One live run in an E2B sandbox (passes without a key) |
| `npm run db:migrate` / `db:seed-scenarios` / `db:generate` / `db:studio` | Apply migrations, publish changed scenario files, generate a migration from `server/db/schema.ts`, browse the database |

#### Configuration

Everything is read from `.env` (see `.env.example`) or the environment. The account variables are listed under [Accounts](#accounts).

| Variable | |
|---|---|
| `PERPLEXITY_API_KEY` | The AI model. Without it colleagues use scripted lines |
| `PERPLEXITY_MODEL` | Any model from `GET https://api.perplexity.ai/v1/models`. Default `openai/gpt-6-luna` |
| `PERPLEXITY_BASE_URL` | Override the API address. Default `https://api.perplexity.ai/v1` |
| `LLM` | `stub` for scripted replies and no network, `live` otherwise |
| `PORT` | Default `5183` |
| `APP_PASSWORD` | Without a database, when hosted: HTTP Basic Auth with this password (any username) instead of this-machine-only |
| `PUBLIC_ACCESS` | `1` lets anyone in with no login. Takes priority over `APP_PASSWORD` |
| `DATABASE_URL` | Postgres. Turns on accounts, lesson authoring and moderation |
| `E2B_API_KEY` | Runs player code in E2B cloud sandboxes. Set it when hosting |
| `SANDBOX` | `local` forces the local process even with an E2B key |
| `STORAGE` | Where attached files go: `disk` (default, `.data/uploads`) or `s3`. See [Attached files](#attached-files) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | The bucket, if it is not `disk`. Railway's own `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `ENDPOINT` and `REGION` are read too |
| `S3_VIRTUAL_HOST` | `1` for `<bucket>.<endpoint>` addressing. MinIO and Railway both answer path style, the default |
| `UPLOAD_MAX_BYTES` | The largest single attachment. Default 5 MB |

**Never commit `.env`.** This repository is public. `.env` and `.data/` are git-ignored.

#### Database

Optional. Without `DATABASE_URL`, shifts are kept in `.data/` as before. With it, the server migrates on startup and each shift's state and event log live in `runs` and `run_events`, pinned to the published scenario version it started on (the file is published if none is); only the player's git workspace stays in `.data/`. `npm run check:db` checks the round trip against a running database.

```
docker compose up db              # Postgres 17 on localhost:5432 (DB_PORT=... to move it)
# in .env: DATABASE_URL=postgres://larp:larp@localhost:5432/larp
npm run db:migrate
npm run db:seed-scenarios         # publishes scenarios/*.json that changed
```

`docker compose up` runs the database and the app together on http://localhost:5183, with scripted colleagues unless `LLM=live`. After changing `server/db/schema.ts`, run `npm run db:generate` and commit the new migration.

On Railway, `railway.json` runs `db:migrate` and `db:seed-scenarios` before each deploy, so edited scenario files reach new shifts without a manual step.

#### Attached files

The paperclip in Outlook and Teams takes a file from the player's own computer. The bytes are sent to the server as they are chosen — not when the message is sent — and what the shift keeps is only the id that comes back, with the name and size. Opening one fetches it again through `/api/sessions/:id/files/:file`, so the shift's own route is the whole permission check: a file is looked up under the run that stored it and nowhere else. Whatever was uploaded is served with `X-Content-Type-Options: nosniff`, a sandbox CSP, and a `Content-Disposition` of `attachment` unless it is an image or a PDF, so an uploaded `.svg` or `.html` can never run its script on our origin. `npm run check:uploads` checks all of that.

There are two places to keep the bytes (`server/uploads.ts`):

- **`STORAGE=disk`** (the default) writes them to `.data/uploads/<run>/<file>`, beside the shifts, on the same volume. Nothing else to run, and all a single instance needs locally.
- **`STORAGE=s3`** puts them in any S3-compatible bucket. A host needs this: Railway's filesystem is thrown away on every deploy, so files kept on it do not survive the next push.

Locally, the same kind of bucket can run alongside everything else. It is behind a compose profile, so the default `docker compose up` stays as small as it was:

```
docker compose --profile s3 up          # bucket on http://localhost:9000, console on http://localhost:9001
# in .env: STORAGE=s3, S3_ENDPOINT=http://localhost:9000, S3_BUCKET=larp, S3_ACCESS_KEY_ID=larp, S3_SECRET_ACCESS_KEY=larp-secret
npm run check:uploads                   # the same check, against the bucket this time
```

Running the server inside compose as well, leave `S3_ENDPOINT` out: compose points the app at `http://minio:9000` itself. (MinIO pulled its public images in 2025, so the compose file uses Pigsty's maintained mirror of the same server; any S3-compatible bucket works the same way.)

On Railway, create a **Bucket** on the project canvas and reference its variables onto the service — `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `ENDPOINT`, `REGION`, or the S3-prefixed names above. Buckets are private, billed at $0.015 per GB-month with free egress, and every API operation is free. Without `STORAGE=s3` the startup log says the files are staying on this disk; a bucket that is only half configured is refused at startup instead, rather than quietly falling back to a disk the next deploy throws away.

A run's files are deleted with the account that owns it (`discard` in `server/world.ts`). Nothing sweeps them on their own, so a long-lived bucket wants a lifecycle rule, or the same habit as `.data/`: it is safe to empty.

#### Accounts

Only with a database. Without `DATABASE_URL` there are no accounts and the old gate applies (this machine only, `APP_PASSWORD` or `PUBLIC_ACCESS=1`). With it, [Better Auth](https://www.better-auth.com) (`server/auth.ts`, mounted at `/api/auth`) replaces that gate: players sign in with email and password, with Google, or as a guest, and each shift belongs to whoever started it. Someone else's shift answers 404.

Email accounts confirm their address before they can sign in; the link signs them in. A guest who creates an account, by email or with Google, keeps their shifts: they move to the new account on its first sign-in, even when the confirmation link is opened in another browser. Shifts never move into an account that already existed: a guest who signs in to one starts it without them, and the guest and its shifts are deleted. Password reset links work for an hour and sign the account out everywhere.

| Variable | |
|---|---|
| `BETTER_AUTH_SECRET` | Signs sessions and encrypts the JWT signing keys. Required in production (`openssl rand -base64 32`). Changing it breaks the stored keys: clear the `jwks` table when you do |
| `BETTER_AUTH_URL` | The address players use, e.g. `https://larp.owsome.org`. Links in emails point here, and only this origin may sign in |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sends email through [Resend](https://resend.com), from e.g. `LARP <no-reply@larp.owsome.org>` (a domain verified in Resend) |
| `MAILPIT_URL` | Without Resend, sends email to [Mailpit](https://mailpit.axllent.org) instead. `docker compose up` runs one; read the mail at http://localhost:8025. Running the server outside Docker, set `MAILPIT_URL=http://localhost:8025` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Offers "Continue with Google" when both are set. The OAuth client (web application) needs the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google` |

With neither Resend nor Mailpit, the server prints each email, link included, to its console. In production (`NODE_ENV=production`) it refuses instead and hides email sign-up, so links never end up in logs. In production Better Auth rate-limits sign-in, sign-up and email requests per client IP, read from Cloudflare's `cf-connecting-ip`, else `x-forwarded-for`.

Other services can check a player with a JWT from `GET /api/auth/token` against the keys at `GET /api/auth/jwks`. Admins are promoted by hand: `update users set role = 'admin' where email = '...'`. `npm run check:auth` checks sign-in, ownership, email confirmation, guest upgrades and password reset against a running database.

#### Lessons: library, authoring and moderation

A lesson is a scenario: the story, cast and starting content a shift plays. The built-in one is `scenarios/ledgerly-day2.json`.

- **Library** (`/`, `server/lessons.ts`). Every public, published lesson, searchable by text and tag, readable without signing in. Each has a page (`/lessons/:id`, from `GET /api/lessons/:id`) with a Start button, which also opens an unlisted lesson by its link and an author's own private one. Without a database it lists the built-ins.
- **Writing lessons** (`/my/lessons`, `server/authoring.ts`, `server/generate.ts`). Needs a database and a confirmed email account (not a guest). Describe a lesson and the AI writes the draft, or revises it on request, up to 10 generations a day per author (reset at midnight UTC). Power users can edit the JSON directly. Every lesson still plays on the one codebase (`workspace-template/ledgerly-api`), so the AI may rewrite the story but not the parts tied to the code: the checks, the customers' figures, the bug's ticket and the ids the engine uses. To publish, the author must first finish a shift on that exact draft with every check passing. Lessons are `private`, `unlisted` or `public`; each publish is a new version, and running shifts stay pinned to the version they started on. Up to 20 lessons per author.
- **Moderation** (`/admin`, `server/moderation.ts`). Signed-in players can report a lesson. Admins see the queue, unpublish or restore lessons, and ban or unban authors (a ban signs them out and hides their lessons). Anyone else gets a 404. There is no content editing here.

### What you can do in a shift

Before a shift you pick your background (new grad, bootcamp, career switcher) and can describe it in a sentence; the mentor pitches explanations to it. The clock runs at an adjustable pace, and the shift ends when you press End shift. Afterwards a debrief page shows what happened, what you put right, and what to practise next.

| App | What is real |
|---|---|
| VS Code | A real editor on real files. A terminal that runs real `git` and real tests. Source control with diffs |
| Outlook | Send, reply, forward, attach, file and search. Colleagues and clients answer |
| Teams | Channels and direct messages. Colleagues answer. Your mentor steps in here |
| Jira | Create and edit issues, change status by dragging, comment. Changes by others arrive as email |
| Confluence | Read, create and edit pages in Markdown |
| CloudWatch | Error rates and incidents that follow from the code you deployed |

The step list in the top-left corner shows what to do next and ticks steps off as you do them. It is lesson data: each lesson lists its phases in road-map order (for the incident shift: fix the ticket, the deploy is live, production is down, service is back, shipped), and you are in the last one whose condition holds. **Show me** brings the right window forward and flashes where to click. The steps say what to do and where, never what the bug is. New grads also get the checks a senior engineer would make first.

Useful terminal commands: `help`, `npm test -- src/auth`, `git status`, `git commit -am "..."`, `ldg deploy auth-api --env prod`, `ldg rollback auth-api`, `ldg status`, `ldg logs`.

### Architecture overview

One Node process on one port serves the API and the browser app (through Vite middleware in development, from `dist/` once built).

```
 Browser (React)                            Server (Express, one process)
 ┌──────────────────────────┐   REST /api   ┌────────────────────────────────────────────┐
 │ Library, My lessons,     │ ────────────► │ routes.ts  validates every request         │
 │ Admin, Sign in           │               │  ├─ auth.ts (Better Auth, /api/auth)       │
 │                          │               │  ├─ lessons, authoring, generate, moderation│
 │ Desktop (the shift)      │  POST /act    │  └─ director.ts  clock, triggers, outcomes │
 │  src/sim/store.ts ───────┼─────────────► │      ├─ world.ts    live shift + stream    │
 │  copy of the world,      │  SSE /events  │      ├─ ai/  personas, mentor → llm.ts ────┼──► Perplexity
 │  windows, drafts ◄───────┼────────────── │      ├─ sandbox.ts  git, files, code ──────┼──► E2B (optional)
 │  apps: VS Code, Outlook, │               │      │    └─ acceptance.ts  hidden checks  │
 │  Teams, Jira, Confluence,│               │      └─ runs.ts     state + event log      │
 │  CloudWatch              │               └─────────────────────┬──────────────────────┘
 └──────────────────────────┘                                     │
                                      .data/ (files)  or  PostgreSQL (Drizzle) + .data/ workspaces
```

**A shift, end to end**

1. `POST /api/sessions` picks the lesson (the author's latest draft, or the latest published version), copies `workspace-template/ledgerly-api` into a fresh git workspace, and starts the director.
2. The browser opens `GET /api/sessions/:id/events`, a Server-Sent Events stream: a full snapshot first, then each change. The clock only runs while someone is watching.
3. Every player action (a chat, an email, a ticket, a terminal command, a commit, a file save) is a request that `routes.ts` validates before it reaches `director.ts`. Long-running ones (`exec`, `commit`) answer over the stream.
4. `ldg deploy` runs `server/acceptance.ts` against what the player actually wrote. Failing checks become an incident: CloudWatch alarms, customer figures, an angry client. Scripted scenario triggers (`server/triggers.ts`) fire on the clock and on events.
5. Colleagues (`server/ai/personas.ts`) each see only the facts they could know and act through a fixed set of validated tools. The mentor (`server/ai/mentor.ts`) opens from facts at once and escalates how much it gives away after each bad deploy. All model calls go through `server/ai/llm.ts`, which queues, rate-limits, times out and never throws; `null` means use the scripted line.
6. State and the event log are saved through `server/runs.ts`: to `.data/` without a database, to `runs`, `run_events` and `run_workspaces` with one. `world.ts` is only a cache of live shifts.

**Database tables** (`server/db/schema.ts`): `scenarios` and `scenario_versions` (lessons and their versions), `lesson_generations` (the daily AI quota), `runs`, `run_events`, `run_workspaces`, `lesson_reports`, and Better Auth's `users`, `sessions`, `accounts`, `verifications`, `jwks`.

**Pages** (`src/App.tsx`): `/` library, `/lessons/:id` lesson, `/play` the shift, `/my/lessons` and `/my/lessons/:id` authoring, `/admin` moderation, `/reset-password`.

### Where things live

| Folder | Contents |
|---|---|
| `src/` | The browser app (React, TypeScript). Holds a read-only copy of the world and what only the browser knows, such as window positions |
| `server/` | Express. Owns the world, runs the clock, decides consequences, talks to the AI model |
| `server/director.ts` | Runs the shift: clock, scheduled events, consequences. No model calls |
| `server/world.ts`, `server/runs.ts` | The live shift and its stream; where shifts are stored (files or Postgres) |
| `server/routes.ts`, `server/auth.ts` | The API and its validation; accounts |
| `server/uploads.ts` | Files attached from the player's computer: this disk, or an S3-compatible bucket |
| `server/lessons.ts`, `server/authoring.ts`, `server/generate.ts`, `server/moderation.ts` | Library, lesson writing, AI generation, moderation |
| `server/db/` | Drizzle schema, migrations, migrate and seed scripts |
| `server/check*.ts` | The `npm run check*` scripts |
| `server/sandbox.ts` | The only code that touches disk or starts a process for the player |
| `server/e2b.ts` | Runs the player's code in an E2B cloud sandbox when `E2B_API_KEY` is set |
| `server/acceptance.ts` | Hidden production checks run against the player's code on every deploy |
| `server/ai/` | The model client, the colleagues, and the mentor |
| `shared/` | Types, pure helpers, the scenario schema, the step list (a lesson's phases and when each step is done) and tag rules, used by both sides |
| `scenarios/` | Scenario content as data: the cast, the chat channels, and the inbox, chats, tickets and wiki the shift starts with. Checked against the schema at startup |
| `workspace-template/ledgerly-api/` | The codebase the player works on. Copied fresh for each shift |
| `.data/` | Running shifts: state, event log, and each player's workspace. Safe to delete |
| `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `railway.json` | Image, local stack, volume permissions, Railway pre-deploy |
| `.github/workflows/ci.yml` | CI |

Three rules the design follows:

1. **The code decides what happens.** Deploying runs hidden checks against what the player actually wrote. Nothing is scripted to fail.
2. **Nothing the player is waiting on waits for the AI.** The mentor's first message is built from facts and arrives at once. The AI writes the coaching that follows, and starts on it when the player commits.
3. **The AI chooses words, not facts.** What broke and who it affected come from the checks. Colleagues can only act through a fixed set of tools, and every argument is validated.

### CI and deploy

GitHub Actions runs on every pull request and push to `main`: lint (`npm run lint`, oxlint), type-check and build, `npm run check` (stubbed model, no secrets), and a Docker image build. Railway deploys `main`; turn on "Wait for CI" there so a red run blocks the deploy. The image runs the server as the unprivileged `node` user; the entrypoint only uses root to hand a mounted `/app/.data` volume to it.

### Limits

- **Without `E2B_API_KEY`, run it on your own machine only.** The player's code runs as your user. It cannot read outside its workspace, write files, start processes or reach the network (the last on macOS only), but those are guard rails, not a security boundary. Hosted, set `E2B_API_KEY` so it runs in an E2B cloud sandbox instead (`server/e2b.ts`); `npm run check:e2b` tries that live.
- One role and one day are playable.
- Colleagues answer in a few seconds. The model is `openai/gpt-6-luna` through Perplexity; any model from `GET https://api.perplexity.ai/v1/models` works, set with `PERPLEXITY_MODEL`.
- Files attached from your computer are kept, up to 5 MB each (`UPLOAD_MAX_BYTES`), wherever [the storage setting](#attached-files) points. Colleagues read their names, not their contents.
