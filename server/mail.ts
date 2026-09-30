// Outgoing email: Resend when RESEND_API_KEY is set, else Mailpit (local), else the link goes to the console.
import { AsyncLocalStorage } from 'node:async_hooks'

export interface Mail { to: string; subject: string; text: string; html: string }

const FROM = process.env.EMAIL_FROM ?? 'LARP <no-reply@localhost>'
const escape = (s: string) => s.replace(/[&<>"]/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

export const mailer = () => (process.env.RESEND_API_KEY ? 'resend' : process.env.MAILPIT_URL ? 'mailpit' : 'console')
// With nowhere to send, production refuses rather than printing sign-in links into its logs.
export const mailReady = () => mailer() !== 'console' || process.env.NODE_ENV !== 'production'
/** One line for the startup log, so a missing key or a sender Resend will refuse shows up before anyone signs up. */
export function mailStatus() {
  const kind = mailer()
  if (kind === 'console') return mailReady() ? 'Email: none set up, sign-in links are printed here.' : 'Email: RESEND_API_KEY is not set, so email sign-up and password reset are hidden.'
  const from = FROM.match(/<(.+)>/)?.[1] ?? FROM
  const warn = kind === 'resend' && /@(localhost|example\.\w+)$/i.test(from) ? ' Resend will refuse this sender: set EMAIL_FROM to an address on your verified domain.' : ''
  return `Email: ${kind}, from ${from}.${warn}`
}

// Better Auth swallows errors from its email callbacks, so a failure is noted here and turned into an error response (auth.ts).
export const mailScope = new AsyncLocalStorage<{ failed?: boolean }>()

export function letter(to: string, subject: string, lines: string[], action: { label: string; url: string }): Mail {
  const text = [...lines, '', `${action.label}: ${action.url}`, '', 'If this wasn\'t you, ignore this email.'].join('\n')
  const html = `<div style="font:15px/1.5 -apple-system,system-ui,sans-serif;color:#1d1d1f;max-width:480px">${lines.map(l => `<p>${escape(l)}</p>`).join('')}`
    + `<p><a href="${escape(action.url)}" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#1d1d1f;color:#fff;text-decoration:none;font-weight:600">${escape(action.label)}</a></p>`
    + '<p style="color:#6e6e73;font-size:13px">If this wasn\'t you, ignore this email.</p></div>'
  return { to, subject, text, html }
}

async function deliver(m: Mail) {
  const kind = mailer()
  if (kind === 'console') {
    if (!mailReady()) throw new Error('no RESEND_API_KEY or MAILPIT_URL')
    console.log(`[mail] to ${m.to} · ${m.subject}\n${m.text}`)
    return
  }
  const res = kind === 'resend'
    ? await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    })
    : await fetch(new URL('/api/v1/send', process.env.MAILPIT_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ From: address(FROM), To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    })
  if (!res.ok) throw new Error(`${kind} answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

function address(s: string) {
  const m = s.match(/^\s*(.*?)\s*<(.+)>\s*$/)
  return m ? { Name: m[1], Email: m[2] } : { Email: s.trim() }
}

export async function send(m: Mail) {
  try {
    await deliver(m)
  } catch (e) {
    console.error(`[mail] could not send "${m.subject}": ${(e as Error).message}`)
    const scope = mailScope.getStore()
    if (scope) scope.failed = true
    else throw e
  }
}
