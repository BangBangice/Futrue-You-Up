import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { authClient } from '../sim/auth.ts'
import { Brand, ThemeToggle, rise, stagger } from './bits.tsx'

export function SignIn() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const guest = async () => {
    setBusy(true)
    setError('')
    const { error } = await authClient.signIn.anonymous()
    // On success the session updates and this page goes away.
    if (error) { setError(error.message ?? 'Could not sign you in. Try again.'); setBusy(false) }
  }
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-right"><ThemeToggle /></div>
      </header>
      <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
        <section className="hero">
          <motion.div variants={rise} className="eyebrow">WORKPLACE SIMULATOR</motion.div>
          <motion.h1 variants={rise}>Get it wrong here, with someone to correct you.</motion.h1>
          <motion.p variants={rise} className="lede">Sign in to start a shift. Your shifts are kept with your account, so you can pick up where you left off.</motion.p>
        </section>
        <motion.section variants={rise} className="card setup signin">
          <div className="field">
            <div className="field-label">Sign in</div>
            <div className="level-note">No account needed. As a guest, your shifts stay with this browser; signing out leaves them behind.</div>
          </div>
          <button className="cta" disabled={busy} onClick={guest}>
            {busy ? <><LoaderCircle size={17} className="spin" />Signing you in</> : <>Continue as guest <ArrowRight size={17} strokeWidth={2.4} /></>}
          </button>
          {error && <div className="cta-note bad">{error}</div>}
        </motion.section>
      </motion.main>
    </div>
  )
}
