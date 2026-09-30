# Futrue-You-Up
Team Future, You Up?

## LARP

A workplace simulator for the people whose first rung has been automated away.

You get a work computer, a real codebase and a real ticket. Colleagues message you, a client escalates, and what you ship decides what happens next. When it goes wrong, a senior engineer steps in on Teams, shows you who it affected, and helps you put it right. There is no score.

### Run it

Needs Node 22 or newer and git.

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
| `npm run check` | Plays a whole shift without a browser or the AI model and checks the outcome |
| `npm run llm:smoke` | One real call to the AI model, to check the key works |
| `npm run build` then `npm start` | Production build, served by the same server |

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

### What you can do in a shift

| App | What is real |
|---|---|
| VS Code | A real editor on real files. A terminal that runs real `git` and real tests. Source control with diffs |
| Outlook | Send, reply, forward, attach, file and search. Colleagues and clients answer |
| Teams | Channels and direct messages. Colleagues answer. Your mentor steps in here |
| Jira | Create and edit issues, change status by dragging, comment. Changes by others arrive as email |
| Confluence | Read, create and edit pages in Markdown |
| CloudWatch | Error rates and incidents that follow from the code you deployed |

The step list in the top-left corner shows what to do next and ticks steps off as you do them. **Show me** brings the right window forward and flashes where to click. The steps say what to do and where, never what the bug is. New grads also get the checks a senior engineer would make first.

Useful terminal commands: `help`, `npm test -- src/auth`, `git status`, `git commit -am "..."`, `ldg deploy auth-api --env prod`, `ldg rollback auth-api`, `ldg status`, `ldg logs`.

### How it works

| Folder | Contents |
|---|---|
| `src/` | The browser app (React, TypeScript). Holds a read-only copy of the world and what only the browser knows, such as window positions |
| `server/` | Express. Owns the world, runs the clock, decides consequences, talks to the AI model |
| `server/sandbox.ts` | The only code that touches disk or starts a process for the player |
| `server/e2b.ts` | Runs the player's code in an E2B cloud sandbox when `E2B_API_KEY` is set |
| `server/acceptance.ts` | Hidden production checks run against the player's code on every deploy |
| `server/ai/` | The model client, the colleagues, and the mentor |
| `shared/` | Types, pure helpers and the scenario schema, used by both sides |
| `scenarios/` | Scenario content as data: the cast, the chat channels, and the inbox, chats, tickets and wiki the shift starts with. Checked against the schema at startup |
| `workspace-template/ledgerly-api/` | The codebase the player works on. Copied fresh for each shift |
| `.data/` | Running shifts: state, event log, and each player's workspace. Safe to delete |

Three rules the design follows:

1. **The code decides what happens.** Deploying runs hidden checks against what the player actually wrote. Nothing is scripted to fail.
2. **Nothing the player is waiting on waits for the AI.** The mentor's first message is built from facts and arrives at once. The AI writes the coaching that follows, and starts on it when the player commits.
3. **The AI chooses words, not facts.** What broke and who it affected come from the checks. Colleagues can only act through a fixed set of tools, and every argument is validated.

### Limits

- **Without `E2B_API_KEY`, run it on your own machine only.** The player's code runs as your user. It cannot read outside its workspace, write files, start processes or reach the network (the last on macOS only), but those are guard rails, not a security boundary. Hosted, set `E2B_API_KEY` so it runs in an E2B cloud sandbox instead (`server/e2b.ts`); `npm run check:e2b` tries that live.
- One role and one day are playable.
- Colleagues answer in a few seconds. The model is `openai/gpt-6-luna` through Perplexity; any model from `GET https://api.perplexity.ai/v1/models` works, set with `PERPLEXITY_MODEL`.
- Files attached from your computer are not stored.
