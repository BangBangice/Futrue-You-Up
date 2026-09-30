import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, LoaderCircle, MailCheck } from 'lucide-react'
import { authClient } from '../sim/auth.ts'
import type { AuthConfig } from '../sim/auth.ts'
import { Brand, ThemeToggle, rise, stagger } from './bits.tsx'

type Mode = 'signin' | 'register' | 'inbox' | 'forgot' | 'sent' | 'reset'
interface Problem { code?: string; message?: string; status?: number }

const LINK_ERRORS: Record<string, string> = {
  INVALID_TOKEN: 'That link is invalid or has already been used.',
  TOKEN_EXPIRED: 'That link has expired. Sign in and we will send a new one.',
  USER_NOT_FOUND: 'That link is for an account that no longer exists.',
}
const say = (e: Problem) => (e.status === 429 ? 'Too many tries. Wait a minute, then try again.' : e.message || 'Something went wrong. Try again.')

// Links from emails and Google can land on the app with an error. Read once, then tidied from the URL so a reload doesn't replay it.
// (A reset link has its own route, /reset-password, in App.tsx.)
function fromUrl() {
  const code = new URLSearchParams(location.search).get('error')
  if (code) history.replaceState(null, '', '/')
  return code ? LINK_ERRORS[code] ?? `Sign-in didn't work (${code.replace(/_/g, ' ')}). Try again or use another way in.` : ''
}
let arrival = fromUrl()
export const arrivedByLink = !!arrival

/** `token` comes from a password reset link and opens the reset form. */
export function SignIn({ config, start, guest: asGuest, token = '', onDone, onBack }: { config: AuthConfig; start?: Mode; guest?: boolean; token?: string; onDone: () => void; onBack?: () => void }) {
  const [landed] = useState(arrival)
  useEffect(() => { arrival = '' }, [])
  const [mode, setMode] = useState<Mode>(token ? 'reset' : start ?? (config.email ? 'signin' : 'register'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(landed)
  const [note, setNote] = useState('')
  const go = (m: Mode) => { setMode(m); setError(''); setNote('') }
  const saving = !!onBack && start === 'register'

  const run = async (e: FormEvent | null, work: () => Promise<{ error: Problem | null }>, then: () => void) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    setNote('')
    const { error } = await work()
    setBusy(false)
    if (!error) return then()
    if (error.code === 'EMAIL_NOT_VERIFIED') return setMode('inbox')
    setError(say(error))
  }
  const signIn = (e: FormEvent) => run(e, () => authClient.signIn.email({ email, password, callbackURL: '/' }), onDone)
  const register = (e: FormEvent) => run(e, () => authClient.signUp.email({ name: name.trim(), email, password, callbackURL: '/' }), () => setMode('inbox'))
  const resend = () => run(null, () => authClient.sendVerificationEmail({ email, callbackURL: '/' }), () => setNote('Sent again. It can take a minute to arrive.'))
  const forgot = (e: FormEvent) => run(e, () => authClient.requestPasswordReset({ email, redirectTo: '/reset-password' }), () => setMode('sent'))
  const reset = (e: FormEvent) => run(e, () => authClient.resetPassword({ newPassword: password, token }), () => {
    setPassword('')
    go('signin')
    setNote('Password changed. Sign in with your new password.')
  })
  const google = () => run(null, () => authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/' }), () => {})
  const guest = () => run(null, () => authClient.signIn.anonymous(), onDone)

  const submit = (label: string, doing: string) => (
    <button className="cta" type="submit" disabled={busy}>
      {busy ? <><LoaderCircle size={17} className="spin" />{doing}</> : <>{label} <ArrowRight size={17} strokeWidth={2.4} /></>}
    </button>
  )
  const emailField = <input className="input" type="email" required autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
  const passwordField = (fresh: boolean) => (
    <input className="input" type="password" required minLength={fresh ? 8 : undefined} maxLength={128} autoComplete={fresh ? 'new-password' : 'current-password'}
      placeholder={fresh ? 'Password (8 characters or more)' : 'Password'} value={password} onChange={e => setPassword(e.target.value)} />
  )
  const others = (mode === 'signin' || mode === 'register') && (config.google || (config.guest && !onBack)) && (
    <div className="signin-others">
      {config.email && <div className="signin-or"><span>or</span></div>}
      {config.google && <button className="btn btn-chip signin-alt" disabled={busy} onClick={google}>Continue with Google</button>}
      {config.google && asGuest && <div className="level-note">Your lessons come with you to a Google account that's new here, not to one you have already used.</div>}
      {config.guest && !onBack && <button className="btn btn-chip signin-alt" disabled={busy} onClick={guest}>Continue as guest</button>}
      {config.guest && !onBack && <div className="level-note">As a guest, your lessons stay with this browser. Create an account any time to keep them.</div>}
    </div>
  )

  return (
    <div className="page">
      <header className="topbar">
        <Brand home={!onBack} />
        <div className="topbar-right"><ThemeToggle /></div>
      </header>
      <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
        <section className="hero">
          <motion.div variants={rise} className="eyebrow">WORKPLACE SIMULATOR</motion.div>
          <motion.h1 variants={rise}>Get it wrong here, with someone to correct you.</motion.h1>
          <motion.p variants={rise} className="lede">Sign in to start a lesson. Your progress is kept with your account, so you can pick up where you left off.</motion.p>
        </section>
        <motion.section variants={rise} className="card setup signin">
          {onBack && <button className="link signin-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>}
          {config.email && mode === 'signin' && (
            <form className="field" onSubmit={signIn}>
              <div className="field-label">Sign in</div>
              {asGuest && <div className="level-note">Signing in to an account you already have starts it without this guest's lessons, and they are deleted. To keep them, create a new account.</div>}
              {emailField}
              {passwordField(false)}
              {submit('Sign in', 'Signing you in')}
              <div className="signin-links">
                <button type="button" className="link" onClick={() => go('forgot')}>Forgot password?</button>
                <button type="button" className="link" onClick={() => go('register')}>Create an account</button>
              </div>
            </form>
          )}
          {config.email && mode === 'register' && (
            <form className="field" onSubmit={register}>
              <div className="field-label">{saving ? 'Save your progress' : 'Create an account'}</div>
              {saving && <div className="level-note">Your lessons so far move to the new account once you confirm your email.</div>}
              <input className="input" required maxLength={80} autoComplete="name" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
              {emailField}
              {passwordField(true)}
              {submit('Create account', 'Creating your account')}
              <div className="signin-links"><button type="button" className="link" onClick={() => go('signin')}>I already have an account</button></div>
            </form>
          )}
          {mode === 'inbox' && (
            <div className="field">
              <div className="field-label signin-head"><MailCheck size={18} /> Check your inbox</div>
              <div className="level-note">We sent a link to <b>{email}</b>. Open it to confirm your email and you're in.{onBack ? ' Your lessons come with you.' : ''}</div>
              <div className="level-note">Nothing after a few minutes? Check your spam folder. If this address already has an account, from Google say, the email tells you how to sign in instead.</div>
              <div className="signin-links">
                <button className="link" disabled={busy} onClick={resend}>Send it again</button>
                <button className="link" onClick={() => go('signin')}>Back to sign in</button>
              </div>
            </div>
          )}
          {mode === 'forgot' && (
            <form className="field" onSubmit={forgot}>
              <div className="field-label">Reset your password</div>
              <div className="level-note">We'll email you a link to choose a new one.</div>
              {emailField}
              {submit('Send reset link', 'Sending')}
              <div className="signin-links"><button type="button" className="link" onClick={() => go('signin')}>Back to sign in</button></div>
            </form>
          )}
          {mode === 'sent' && (
            <div className="field">
              <div className="field-label signin-head"><MailCheck size={18} /> Check your inbox</div>
              <div className="level-note">If <b>{email}</b> has an account, a reset link is on its way. It works for an hour.</div>
              <div className="signin-links"><button className="link" onClick={() => go('signin')}>Back to sign in</button></div>
            </div>
          )}
          {mode === 'reset' && (
            <form className="field" onSubmit={reset}>
              <div className="field-label">Choose a new password</div>
              {passwordField(true)}
              {submit('Set new password', 'Saving')}
            </form>
          )}
          {error ? <div className="cta-note bad" role="alert">{error}</div> : note && <div className="cta-note">{note}</div>}
          {others}
        </motion.section>
      </motion.main>
    </div>
  )
}
