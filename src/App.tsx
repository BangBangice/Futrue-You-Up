import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { AccountContext, WhoContext, authClient, useAuthConfig, useWho } from './sim/auth.ts'
import type { AuthConfig } from './sim/auth.ts'
import { sim, useSim } from './sim/store.ts'
import { Onboarding } from './ui/Onboarding.tsx'
import { SimBar } from './ui/SimBar.tsx'
import { Desktop } from './ui/Desktop.tsx'
import { Post } from './ui/Post.tsx'
import { SignIn, arrivedByLink } from './ui/SignIn.tsx'
import { LessonPage, Library } from './ui/Library.tsx'
import { Admin } from './ui/Admin.tsx'
import { LessonEditor, MyLessons } from './ui/MyLessons.tsx'

export default function App() {
  const theme = useSim(s => s.theme)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const config = useAuthConfig()
  if (!config) return null
  return (
    <BrowserRouter>
      {config.enabled ? <Accounts config={config}><Pages /></Accounts> : <WhoContext value={{ config, userId: null, loading: false }}><Pages /></WhoContext>}
    </BrowserRouter>
  )
}

// The library and lesson pages are open to anyone. Only playing needs an account, and a guest counts.
function Pages() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/lessons/:id" element={<LessonPage />} />
      <Route path="/my/lessons" element={<MyLessons />} />
      <Route path="/my/lessons/:id" element={<LessonEditor />} />
      <Route path="/play" element={<Play />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

// A failed sign-in, or a guest saving their progress, shows the sign-in page over whatever page is open.
function Accounts({ config, children }: { config: AuthConfig; children: ReactNode }) {
  const { data, isPending, isRefetching } = authClient.useSession()
  const [signing, setSigning] = useState<false | 'landing' | 'save'>(arrivedByLink && 'landing')
  const user = data?.user
  const account = useMemo(() => user && {
    name: user.name,
    isAnonymous: !!user.isAnonymous,
    role: (user as { role?: string }).role ?? 'learner',
    verified: !!user.emailVerified,
    signOut: async () => { await authClient.signOut(); sim.replay() },
    save: config.email || config.google ? () => setSigning('save') : undefined,
  }, [user, config])
  // Following a link (the logo, say) leaves the sign-in page.
  const { pathname } = useLocation()
  const was = useRef(pathname)
  useEffect(() => { if (was.current !== pathname) { was.current = pathname; setSigning(false) } }, [pathname])
  if (signing) {
    const done = () => setSigning(false)
    return <div className="screen"><SignIn config={config} start={signing === 'save' ? 'register' : undefined} guest={account?.isAnonymous} onDone={done} onBack={account ? done : undefined} /></div>
  }
  // Signed out, every refetch (after sign-up, say) is pending too; only the first load counts as loading, so the sign-in page keeps its state.
  const who = { config, userId: user?.id ?? null, loading: isPending && !isRefetching }
  return <WhoContext value={who}><AccountContext value={account || null}>{children}</AccountContext></WhoContext>
}

function Play() {
  const { config, userId, loading } = useWho()
  if (!config.enabled) return <Shift accounts={false} />
  if (loading) return null
  if (!userId) return <div className="screen"><SignIn config={config} onDone={() => {}} /></div>
  return <Shift key={userId} accounts />
}

// A reset link from an email. The token is read once, then tidied from the URL so a reload doesn't replay it.
// It shows the reset form even to someone signed in, as a guest say.
function ResetPassword() {
  const { config } = useWho()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const navigate = useNavigate()
  useEffect(() => { if (token) navigate('/reset-password', { replace: true }) }, [token, navigate])
  if (!token || !config.enabled) return <Navigate to="/" replace />
  return <div className="screen"><SignIn config={config} token={token} onDone={() => navigate('/')} /></div>
}

// The shift itself moves through its stages by state, not by URL, so a reload of /play resumes whatever stage the shift is at.
function Shift({ accounts }: { accounts: boolean }) {
  const stage = useSim(s => s.stage)
  useEffect(() => { void sim.resume(accounts) }, [accounts])
  const screen = stage === 'recap' ? 'post' : stage

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screen}
          className="screen"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.012 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {screen === 'onboard' ? <Onboarding /> : screen === 'sim' ? <><SimBar /><Desktop /></> : <Post />}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  )
}
