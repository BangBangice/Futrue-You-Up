import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AccountContext, authClient, useAuthConfig } from './sim/auth.ts'
import type { AuthConfig } from './sim/auth.ts'
import { sim, useSim } from './sim/store.ts'
import { Onboarding } from './ui/Onboarding.tsx'
import { SimBar } from './ui/SimBar.tsx'
import { Desktop } from './ui/Desktop.tsx'
import { Post } from './ui/Post.tsx'
import { SignIn, arrivedByLink } from './ui/SignIn.tsx'

export default function App() {
  const theme = useSim(s => s.theme)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const config = useAuthConfig()
  if (!config) return null
  return config.enabled ? <Gate config={config} /> : <Shift accounts={false} />
}

// A reset link or a failed sign-in shows the sign-in page even to a signed-in guest.
function Gate({ config }: { config: AuthConfig }) {
  const { data, isPending, isRefetching } = authClient.useSession()
  const [signing, setSigning] = useState<false | 'landing' | 'save'>(arrivedByLink && 'landing')
  const user = data?.user
  const account = useMemo(() => user && {
    name: user.name,
    isAnonymous: !!user.isAnonymous,
    signOut: async () => { await authClient.signOut(); sim.replay() },
    save: config.email || config.google ? () => setSigning('save') : undefined,
  }, [user, config])
  // Signed out, every refetch (after sign-up, say) is pending too; only the first load waits, so the sign-in page keeps its state.
  if (isPending && !isRefetching) return null
  if (!account || signing) {
    const done = () => setSigning(false)
    return <div className="screen"><SignIn config={config} start={signing === 'save' ? 'register' : undefined} onDone={done} onBack={account ? done : undefined} /></div>
  }
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
