import { useEffect, useLayoutEffect, useMemo } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AccountContext, authClient, useAuthConfig } from './sim/auth.ts'
import { sim, useSim } from './sim/store.ts'
import { Onboarding } from './ui/Onboarding.tsx'
import { SimBar } from './ui/SimBar.tsx'
import { Desktop } from './ui/Desktop.tsx'
import { Post } from './ui/Post.tsx'
import { SignIn } from './ui/SignIn.tsx'

export default function App() {
  const theme = useSim(s => s.theme)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const config = useAuthConfig()
  if (!config) return null
  return config.enabled ? <Gate /> : <Shift accounts={false} />
}

function Gate() {
  const { data, isPending } = authClient.useSession()
  const user = data?.user
  const account = useMemo(() => user && {
    name: user.isAnonymous ? 'Guest' : user.name,
    signOut: async () => { await authClient.signOut(); sim.replay() },
  }, [user])
  if (isPending) return null
  if (!account) return <div className="screen"><SignIn /></div>
  return <AccountContext value={account}><Shift key={user!.id} accounts /></AccountContext>
}

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
