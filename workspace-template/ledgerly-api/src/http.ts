// The small slice of the HTTP layer that the auth code depends on.
export interface Request {
  headers: Record<string, string | undefined>
  cookies: Record<string, string | undefined>
  body: Record<string, unknown>
}

export interface CookieOptions { httpOnly?: boolean; sameSite?: 'lax' | 'strict' | 'none'; maxAge?: number }

export interface Response {
  status(code: number): Response
  json(body: unknown): Response
  cookie(name: string, value: string, options?: CookieOptions): Response
}
