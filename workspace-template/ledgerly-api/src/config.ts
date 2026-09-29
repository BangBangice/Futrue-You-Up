// Settings read once at start-up. In production these come from the secret store.
export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-ledgerly'
export const SESSION_COOKIE = 'ldg_session'

/** How long a session lasts, in seconds, by the way the user signed in. */
export const TTL = {
  password: 12 * 60 * 60,
  sso: 60 * 60,
}
/** The web app asks for a fresh SSO token this many seconds after the last one was issued. */
export const SSO_REFRESH_AFTER = 55 * 60
