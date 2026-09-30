// Accounts. The server says which sign-in methods it offers; with none, there are no accounts and anyone on the page can play.
import { createContext, useContext, useEffect, useState } from 'react'
import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'

export interface AuthConfig { enabled: boolean; guest: boolean; email: boolean; google: boolean }
export interface Account { name: string; isAnonymous: boolean; role: string; verified: boolean; signOut: () => Promise<void>; save?: () => void }

export const authClient = createAuthClient({ basePath: '/api/auth', plugins: [anonymousClient()] })

const OFF: AuthConfig = { enabled: false, guest: false, email: false, google: false }
const config = fetch('/api/auth-config').then(r => (r.ok ? r.json() as Promise<AuthConfig> : OFF), () => OFF)
export function useAuthConfig() {
  const [c, set] = useState<AuthConfig | null>(null)
  useEffect(() => { void config.then(set) }, [])
  return c
}

export const AccountContext = createContext<Account | null>(null)
export const useAccount = () => useContext(AccountContext)

/** Who is on the page, for the routes: signed in or not, and whether the first check is still out. Pages outside a shift don't need an account. */
export interface Who { config: AuthConfig; userId: string | null; loading: boolean }
export const WhoContext = createContext<Who>({ config: OFF, userId: null, loading: false })
export const useWho = () => useContext(WhoContext)
