import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, CalendarDays, CircleCheck, CircleHelp, Flame, Footprints, Hash, Lightbulb, MessageSquareText, Radius, Phone, Rocket, Search, SendHorizontal, Users } from 'lucide-react'
import { CHANS, PEOPLE } from '../../../shared/types.ts'
import type { ChanId, ChatMsg, Coaching } from '../../../shared/types.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, EASE, LOGOS, SPRING } from '../bits.tsx'
import { AttachButton, FileCard, Rich } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const ALERTS = { fire: ['FIRING', Flame], ok: ['RESOLVED', CircleCheck], info: ['DEPLOY', Rocket] } as const
const RAIL = [['Activity', Bell], ['Chat', MessageSquareText], ['Teams', Users], ['Calendar', CalendarDays], ['Calls', Phone]] as const
const COACH: [keyof Coaching, string, typeof Flame][] = [['blast', 'Who it affected', Radius], ['why', 'Why it happened', Lightbulb], ['question', 'Ask yourself', CircleHelp], ['next', 'Next step', Footprints]]
const label = (k: ChanId) => (CHANS[k].dm ? CHANS[k].label : CHANS[k].label.slice(2))

function Message({ x }: { x: ChatMsg }) {
  const alert = x.alert && ALERTS[x.alert]
  const Icon = alert?.[1]
  const mine = x.who === 'maya'
  return (
    <motion.div className={'msg' + (mine ? ' mine' : '')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE }}>
      {!mine && <Avatar who={x.who} size={32} />}
      <div className="msg-main">
        <div className="msg-head">{!mine && <b>{PEOPLE[x.who].name}</b>}<time>{x.time}</time></div>
        {alert && Icon
          ? <div className={'alert ' + x.alert}><div className="alert-label"><Icon size={11} strokeWidth={2.6} />{alert[0]}</div>{x.text}</div>
          : x.text && <div className="bubble">{x.text.split('\n\n').map((p, i) => <p key={i}><Rich text={p} /></p>)}</div>}
        {x.coach && (
          <motion.div className="coach" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4, ease: EASE }}>
            {COACH.filter(([k]) => x.coach![k]).map(([k, title, Icon]) => (
              <div key={k} className={'coach-row ' + k}><Icon size={15} strokeWidth={2} /><div><b>{title}</b><p><Rich text={x.coach![k]} /></p></div></div>
            ))}
          </motion.div>
        )}
        {!!x.files?.length && <div className="files">{x.files.map((a, i) => <FileCard key={i} a={a} />)}</div>}
      </div>
    </motion.div>
  )
}

export function Chat() {
  const chan = useSim(s => s.chan)
  const chats = useSim(s => s.chats)
  const unread = useSim(s => s.unread)
  const typing = useSim(s => s.typing)
  const draft = useSim(s => s.chatDraft)
  const files = useSim(s => s.chatFiles)
  const shown = useSim(s => s.wins.chat.open && !s.wins.chat.min)
  const [query, setQuery] = useState('')
  const meta = CHANS[chan], msgs = chats[chan]
  const typers = typing.filter(t => t.chan === chan)
  const typingHere = typers.length > 0

  // Keep the newest message in view: glide for new messages, jump when switching chat or reopening.
  const scroller = useRef<HTMLDivElement>(null)
  const last = useRef('')
  useEffect(() => {
    const el = scroller.current
    if (!el || !shown) { last.current = ''; return }
    el.scrollTo({ top: el.scrollHeight, behavior: last.current === chan ? 'smooth' : 'auto' })
    last.current = chan
  }, [msgs, chan, typingHere, shown])

  const q = query.trim().toLowerCase()
  const item = (k: ChanId) => {
    const n = unread[k] || 0, latest = chats[k].at(-1)
    if (q && !label(k).toLowerCase().includes(q)) return null
    return (
      <button key={k} data-guide={'chan:' + k} className={'side-item tm-item' + (chan === k ? ' on' : '') + (n ? ' bold' : '')} onClick={() => sim.openChat(k)}>
        {chan === k && <motion.i layoutId="chan" className="side-pill" transition={SPRING} />}
        {CHANS[k].dm ? <span className="presence"><Avatar who={k as 'priya'} size={32} /><i className={k === 'daniel' ? 'away' : ''} /></span> : <span className="chan-icon"><Hash size={15} strokeWidth={2.3} /></span>}
        <span className="tm-item-text">
          <span className="tm-item-top"><b className="ellipsis">{label(k)}</b>{latest && <time>{latest.time.replace(/^Mon .*/, 'Mon')}</time>}</span>
          <span className="tm-preview ellipsis">{latest ? (latest.who === 'maya' ? 'You: ' : '') + (latest.text || 'Sent a file') : CHANS[k].topic}</span>
        </span>
        <AnimatePresence>{n > 0 && <motion.span className="pip" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>{n}</motion.span>}</AnimatePresence>
      </button>
    )
  }

  return (
    <div className="app teams">
      <DragBar className="brandbar">
        <Lights />
        <div className="brandbar-name"><img src={LOGOS.chat} alt="" />Teams</div>
        <label className="brandbar-search"><Search size={14} strokeWidth={2.2} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search chats" /></label>
        <div className="brandbar-me"><span className="presence"><Avatar who="maya" size={28} /><i /></span></div>
      </DragBar>
      <div className="app-body">
        <div className="tm-rail">
          {RAIL.map(([name, Icon]) => <div key={name} className={name === 'Chat' ? 'on' : ''}><Icon size={20} strokeWidth={1.8} /><span>{name}</span></div>)}
        </div>
        <nav className="sidebar tm-list">
          <div className="tm-list-head">Chat</div>
          <div className="side-scroll">
            <div className="side-label">Ledgerly</div>
            {(['team', 'incidents'] as const).map(item)}
            <div className="side-label">Chats</div>
            {(['priya', 'daniel', 'leo'] as const).map(item)}
          </div>
        </nav>
        <div className="chat-main">
          <div className="chat-head">
            {meta.dm ? <Avatar who={chan as 'priya'} size={30} /> : <div className="chan-icon"><Hash size={15} strokeWidth={2.4} /></div>}
            <div className="stack"><b>{label(chan)}</b><span>{meta.topic}</span></div>
          </div>
          <div className="chat-scroll" ref={scroller}>
            <motion.div key={chan} className="chat-msgs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <AnimatePresence initial={false}>{msgs.map(x => <Message key={x.id} x={x} />)}</AnimatePresence>
            </motion.div>
            <AnimatePresence>
              {typingHere && (
                <motion.div className="typing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <span className="dots"><i /><i /><i /></span>{typers.map(t => PEOPLE[t.who].name.split(' ')[0]).join(' and ')} {typers.length > 1 ? 'are' : 'is'} typing
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <form className="tm-compose" onSubmit={e => { e.preventDefault(); sim.sendChat() }}>
            {files.length > 0 && <div className="files">{files.map((a, i) => <FileCard key={i} a={a} onRemove={() => sim.set(s => ({ chatFiles: s.chatFiles.filter((_, j) => j !== i) }))} />)}</div>}
            <input data-guide="chat-input" value={draft} onChange={e => sim.set({ chatDraft: e.target.value })} placeholder="Type a message" aria-label={'Message ' + label(chan)} />
            <div className="tm-compose-bar">
              <AttachButton onPick={a => sim.set(s => ({ chatFiles: [...s.chatFiles, a] }))} />
              <div className="grow" />
              <button className="send" disabled={!draft.trim() && !files.length} aria-label="Send message"><SendHorizontal size={16} strokeWidth={2.2} /></button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
