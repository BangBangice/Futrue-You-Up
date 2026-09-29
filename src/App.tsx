import { useLayoutEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useSim } from './sim/store.ts'
import { Onboarding } from './ui/Onboarding.tsx'
import { SimBar } from './ui/SimBar.tsx'
import { Desktop } from './ui/Desktop.tsx'
import { Post } from './ui/Post.tsx'

export default function App() {
  const stage = useSim(s => s.stage)
  const theme = useSim(s => s.theme)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
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
