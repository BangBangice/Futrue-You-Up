# ledgerly-api

The Ledgerly backend: authentication, SSO and invoicing. Deployed as `auth-api` and `billing-api`.

## Run the tests

```
npm test                # everything, about nine minutes on a laptop in the real repo
npm test -- src/auth    # one area
```

## Ship it

```
git commit -am "fix(auth): what you changed (LED-123)"
ldg deploy auth-api --env prod
ldg rollback auth-api   # puts the previous release back, takes about a minute
ldg status              # what is live right now
```

Both deploy and rollback post to #incidents. See the wiki page "Deploy and rollback" for the checklist.

## Layout

| Path | What lives there |
|---|---|
| `src/auth/` | Sessions, password login, API keys |
| `src/sso/` | SSO sign-in and token refresh |
| `src/routes/` | HTTP routes that need a signed-in user |
| `src/test/` | Helpers shared by the tests |

## Who to ask

Auth: Daniel Okafor. Customers: Sam Whitfield.
