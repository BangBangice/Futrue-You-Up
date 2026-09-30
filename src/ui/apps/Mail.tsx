import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, Bell, Flag, Forward, Inbox, Mail as Envelope, MailOpen, MailPlus, Paperclip, Reply, ReplyAll, Search, Send, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Email, PersonId } from '../../../shared/types.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, EASE, LOGOS, SPRING } from '../bits.tsx'
import { AttachButton, FileCard, Rich } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const FOLDERS = [['inbox', 'Inbox', Inbox], ['alerts', 'Alerts', Bell], ['sent', 'Sent Items', Send], ['archive', 'Archive', Archive], ['deleted', 'Deleted Items', Trash2]] as const
const SYSTEMS = ['cloudwatch', 'jira', 'people']

const Tool = ({ icon: Icon, label, onClick, disabled, guide }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; guide?: string }) => (
  <button className="ol-tool" data-guide={guide} title={label} disabled={disabled} onClick={onClick}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></button>
)

export function Mail() {
  const emails = useSim(s => s.emails)
  const folder = useSim(s => s.mailFolder)
  const selId = useSim(s => s.mailSel)
  const compose = useSim(s => s.compose)
  const cast = useSim(s => s.cast), me = useSim(s => s.player)
  const [query, setQuery] = useState('')
  const sender = (e: Email) => (e.who === me ? 'To: ' + e.toName : cast[e.who].name)

  const q = query.trim().toLowerCase()
  const list = emails.filter(e => e.folder === folder && (!q || (sender(e) + ' ' + e.subject + ' ' + e.body.join(' ')).toLowerCase().includes(q)))
  const sel = list.find(e => e.id === selId)
  const theirs = sel && sel.who !== me ? sel : undefined
  const groups = [['Today', list.filter(e => e.time.includes(':'))], ['Earlier this week', list.filter(e => !e.time.includes(':'))]] as const

  return (
    <div className="app outlook">
      <DragBar className="brandbar">
        <Lights />
        <div className="brandbar-name"><img src={LOGOS.mail} alt="" />Outlook</div>
        <label className="brandbar-search"><Search size={14} strokeWidth={2.2} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search mail" /></label>
        <div className="brandbar-me"><Avatar who={me} size={28} /></div>
      </DragBar>
      <div className="ol-ribbon">
        <button className="ol-new" onClick={sim.newMail}><MailPlus size={16} strokeWidth={2} />New mail</button>
        <i className="vsep" />
        <Tool icon={Trash2} label="Delete" disabled={!sel || folder === 'deleted'} onClick={() => sim.moveMail(sel!.id, 'deleted')} />
        <Tool icon={Archive} label="Archive" disabled={!sel || folder === 'archive'} onClick={() => sim.moveMail(sel!.id, 'archive')} />
        <i className="vsep" />
        <Tool icon={Reply} label="Reply" guide="mail-reply" disabled={!theirs} onClick={sim.reply} />
        <Tool icon={ReplyAll} label="Reply all" disabled={!theirs} onClick={sim.reply} />
        <Tool icon={Forward} label="Forward" disabled={!sel} onClick={sim.forward} />
        <i className="vsep" />
        <Tool icon={Flag} label={sel?.flagged ? 'Unflag' : 'Flag'} disabled={!sel} onClick={() => sim.patchMail(sel!.id, { flagged: !sel!.flagged })} />
        <Tool icon={sel?.read ? Envelope : MailOpen} label={sel?.read ? 'Mark unread' : 'Mark read'} disabled={!sel} onClick={() => sim.patchMail(sel!.id, { read: !sel!.read })} />
      </div>
      <div className="app-body">
        <nav className="sidebar" style={{ width: 186 }}>
          <div className="side-label">maya.chen@ledgerly.io</div>
          {FOLDERS.map(([k, label, Icon]) => {
            const unread = emails.filter(e => e.folder === k && !e.read).length
            return (
              <button key={k} className={'side-item' + (folder === k ? ' on' : '')} onClick={() => sim.set({ mailFolder: k })}>
                {folder === k && <motion.i layoutId="folder" className="side-pill" transition={SPRING} />}
                <Icon size={15} strokeWidth={1.9} />
                <span className="grow">{label}</span>
                {unread > 0 && <span className="count">{unread}</span>}
              </button>
            )
          })}
        </nav>

        <motion.div layoutScroll className="mail-list">
          <AnimatePresence initial={false}>
            {groups.flatMap(([title, rows]) => rows.length === 0 ? [] : [
              <motion.div layout key={title} className="mail-group">{title}</motion.div>,
              ...rows.map(e => (
                <motion.button layout key={e.id} data-guide={'mail:' + e.id} className={'mail-row' + (e.id === selId ? ' on' : '') + (e.read ? '' : ' unread')} initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} onClick={() => sim.openMail(e.id)}>
                  <div className="mail-row-top">
                    <b>{sender(e)}</b>
                    {e.files.length > 0 && <Paperclip size={12} strokeWidth={2.2} className="sub" />}
                    {e.flagged && <Flag size={12} strokeWidth={2.4} className="flagged" />}
                  </div>
                  <div className="mail-row-top"><span className="mail-subject">{e.subject}</span><time>{e.time}</time></div>
                  <div className="mail-preview">{e.body.slice(e.body.length > 1 ? 1 : 0).join(' ')}</div>
                </motion.button>
              )),
            ])}
          </AnimatePresence>
          {!list.length && <div className="empty">{q ? 'No results for “' + query.trim() + '”' : 'Nothing in ' + FOLDERS.find(f => f[0] === folder)![1]}</div>}
        </motion.div>

        <div className="reader">
          {compose && compose.mode !== 'reply' ? <Composer key={compose.mode} quoted={compose.mode === 'forward' ? sel : undefined} />
            : !sel ? <div className="empty-full"><MailOpen size={28} strokeWidth={1.5} />Select an item to read</div>
            : <Message key={sel.id} mail={sel} replying={!!compose} />}
        </div>
      </div>
    </div>
  )
}

function Message({ mail, replying }: { mail: Email; replying: boolean }) {
  const cast = useSim(s => s.cast), me = useSim(s => s.player)
  const from = cast[mail.who], mine = mail.who === me
  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <h2>{mail.subject}</h2>
      <div className="mail-card">
        <div className="mail-from">
          <Avatar who={mail.who} size={38} />
          <div className="grow">
            <div className="ellipsis"><b>{from.name}</b> <span className="sub small">&lt;{from.email}&gt;</span></div>
            <div className="sub small ellipsis">To: {mail.toName || cast[me].name}</div>
          </div>
          <div className="mail-quick">
            {!mine && <button className="icon-btn ghost" title="Reply" aria-label="Reply" onClick={sim.reply}><Reply size={16} strokeWidth={1.9} /></button>}
            <button className="icon-btn ghost" title="Forward" aria-label="Forward" onClick={sim.forward}><Forward size={16} strokeWidth={1.9} /></button>
            <time className="sub small">{mail.time}</time>
          </div>
        </div>
        {mail.files.length > 0 && <div className="files">{mail.files.map((a, i) => <FileCard key={i} a={a} />)}</div>}
        <div className="mail-body">{mail.body.map((p, i) => <p key={i}><Rich text={p} /></p>)}</div>
      </div>
      <AnimatePresence initial={false}>
        {mail.thread.map((r, i) => (
          <motion.div key={i} className="mail-card replied" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING}>
            <div className="mail-from">
              <Avatar who={me} size={30} />
              <div className="grow"><b>{cast[me].name}</b><div className="sub small">To: {from.name}</div></div>
              <time className="sub small">{r.time}</time>
            </div>
            {r.files.length > 0 && <div className="files">{r.files.map((a, j) => <FileCard key={j} a={a} />)}</div>}
            {r.text && <div className="pre"><Rich text={r.text} /></div>}
          </motion.div>
        ))}
      </AnimatePresence>
      {replying ? <Composer replyTo={mail.who} /> : (
        <div className="mail-next">
          {!mine && <button className="ol-pill" onClick={sim.reply}><Reply size={15} strokeWidth={1.9} />Reply</button>}
          <button className="ol-pill" onClick={sim.forward}><Forward size={15} strokeWidth={1.9} />Forward</button>
        </div>
      )}
    </motion.article>
  )
}

/** One editor for replies, new mail and forwards. A reply knows its recipient; the others ask for one. */
function Composer({ replyTo, quoted }: { replyTo?: PersonId; quoted?: Email }) {
  const compose = useSim(s => s.compose)
  const draft = useSim(s => s.mailDraft)
  const files = useSim(s => s.mailFiles)
  const cast = useSim(s => s.cast), me = useSim(s => s.player)
  if (!compose) return null
  const contacts = Object.keys(cast).filter(k => k !== me && !SYSTEMS.includes(k))
  const ready = (draft.trim() || files.length > 0) && (replyTo || compose.to.trim())
  const field = (patch: { to?: string; subject?: string }) => sim.set({ compose: { ...compose, ...patch } })

  return (
    <motion.div className={'composer' + (replyTo ? '' : ' full')} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease: EASE }}>
      <div className="composer-row">
        <span>To</span>
        {replyTo ? <span className="person"><Avatar who={replyTo} size={18} />{cast[replyTo].name}</span> : (
          <>
            <input list="ol-contacts" autoFocus value={compose.to} onChange={e => field({ to: e.target.value })} placeholder="Name or email" aria-label="To" />
            <datalist id="ol-contacts">{contacts.map(k => <option key={k} value={cast[k].name}>{cast[k].email}</option>)}</datalist>
          </>
        )}
      </div>
      {!replyTo && <div className="composer-row"><span>Subject</span><input value={compose.subject} onChange={e => field({ subject: e.target.value })} placeholder="Add a subject" aria-label="Subject" /></div>}
      {files.length > 0 && <div className="files">{files.map((a, i) => <FileCard key={i} a={a} onRemove={() => sim.set(s => ({ mailFiles: s.mailFiles.filter((_, j) => j !== i) }))} />)}</div>}
      <textarea autoFocus={!!replyTo} value={draft} onChange={e => sim.set({ mailDraft: e.target.value })} placeholder="Type your message" aria-label="Message" />
      {quoted && (
        <div className="quoted">
          <div className="sub small">Forwarded message · From {cast[quoted.who].name} · {quoted.time}</div>
          {quoted.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}
      <div className="composer-foot">
        <button className="btn btn-accent sm" disabled={!ready} onClick={sim.sendMail}><Send size={13} strokeWidth={2.2} />Send</button>
        <AttachButton onPick={a => sim.set(s => ({ mailFiles: [...s.mailFiles, a] }))} />
        <div className="grow" />
        <button className="icon-btn ghost" title="Discard" aria-label="Discard draft" onClick={sim.discardMail}><Trash2 size={15} strokeWidth={1.9} /></button>
      </div>
    </motion.div>
  )
}
