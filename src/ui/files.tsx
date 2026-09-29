// Attachments and in-text links, shared by Outlook, Teams, Jira and Confluence.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { File, FileCode2, FileText, Image, MonitorUp, Paperclip, X } from 'lucide-react'
import { APP_NAMES, FILES } from '../sim/data.ts'
import type { Attachment, ChanId, FileId } from '../sim/data.ts'
import { DOCS, DOC_IDS } from '../sim/docs.ts'
import { sim } from '../sim/store.ts'
import { LOGOS } from './bits.tsx'

const FILE_IDS = Object.keys(FILES) as FileId[]
const size = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB')

function describe(a: Attachment): { name: string; meta: string; icon: ReactNode } {
  switch (a.kind) {
    case 'code': return { name: FILES[a.file].name, meta: FILES[a.file].path, icon: <FileCode2 className="ic-ts" strokeWidth={1.8} /> }
    case 'doc': return { name: DOCS[a.doc].title, meta: 'Confluence page', icon: <img src={LOGOS.docs} alt="" /> }
    case 'ticket': return { name: a.id, meta: sim.state.tickets.find(t => t.id === a.id)?.title ?? 'Jira issue', icon: <img src={LOGOS.tracker} alt="" /> }
    case 'link': return { name: a.label, meta: APP_NAMES[a.app], icon: <img src={LOGOS[a.app]} alt="" /> }
    case 'upload': {
      const Icon = /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(a.name) ? Image : /\.(pdf|docx?|txt|md|rtf|pages)$/i.test(a.name) ? FileText : File
      return { name: a.name, meta: size(a.size), icon: <Icon className="sub" strokeWidth={1.8} /> }
    }
  }
}

export function FileCard({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const d = describe(a)
  const open = () => (a.kind === 'upload' ? window.open(a.url, '_blank', 'noopener') : sim.openAttachment(a))
  return (
    <div className="file">
      <button type="button" className="file-main" title={'Open ' + d.name} onClick={open}>
        {d.icon}
        <span className="file-text"><b>{d.name}</b><span>{d.meta}</span></span>
      </button>
      {onRemove && <button type="button" className="file-x" aria-label={'Remove ' + d.name} onClick={onRemove}><X size={12} strokeWidth={2.6} /></button>}
    </div>
  )
}

/** Paperclip with a menu: files from the workspace, wiki pages, or anything from the player's own computer. */
export function AttachButton({ onPick }: { onPick: (a: Attachment) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const pick = (a: Attachment) => { onPick(a); setOpen(false) }

  return (
    <div className="attach" ref={root}>
      <button type="button" className="icon-btn ghost" title="Attach" aria-label="Attach a file" aria-expanded={open} onClick={() => setOpen(o => !o)}><Paperclip size={16} strokeWidth={2} /></button>
      <AnimatePresence>
        {open && (
          <motion.div className="menu" role="menu" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}>
            <button type="button" role="menuitem" onClick={() => picker.current?.click()}><MonitorUp size={16} strokeWidth={1.9} className="sub" /><b>Browse this computer…</b></button>
            <div className="menu-label">ledgerly-api</div>
            {FILE_IDS.map(f => <button type="button" role="menuitem" key={f} onClick={() => pick({ kind: 'code', file: f })}><FileCode2 size={16} strokeWidth={1.8} className="ic-ts" /><span className="ellipsis">{FILES[f].name}</span></button>)}
            <div className="menu-label">Confluence</div>
            {DOC_IDS.map(d => <button type="button" role="menuitem" key={d} onClick={() => pick({ kind: 'doc', doc: d })}><img src={LOGOS.docs} alt="" /><span className="ellipsis">{DOCS[d].title}</span></button>)}
          </motion.div>
        )}
      </AnimatePresence>
      <input ref={picker} type="file" multiple hidden onChange={e => {
        for (const f of e.target.files ?? []) onPick({ kind: 'upload', name: f.name, size: f.size, url: URL.createObjectURL(f) })
        e.target.value = ''
        setOpen(false)
      }} />
    </div>
  )
}

// In running text: `code`, file names and paths, ticket ids, #channels and @maya.
const BY_TEXT = new Map(FILE_IDS.flatMap(k => [[FILES[k].path, k], [FILES[k].name, k]] as [string, FileId][]))
const escaped = [...BY_TEXT.keys()].sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
const LINKS = new RegExp('`([^`]+)`|(' + escaped.join('|') + ')|\\b((?:LED|INC)-\\d+)\\b|#(team|incidents)\\b|(@maya)\\b', 'g')

export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(LINKS)) {
    const [all, code, file, ticket, chan] = m
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push(
      code ? <code key={at} className="inline">{code}</code>
        : file ? <button key={at} type="button" className="link mono" onClick={() => sim.openCode(BY_TEXT.get(file))}>{file}</button>
        : ticket ? <button key={at} type="button" className="link" onClick={() => sim.openTicket(ticket)}>{ticket}</button>
        : chan ? <button key={at} type="button" className="link" onClick={() => sim.openChat(chan as ChanId)}>#{chan}</button>
        : <mark key={at}>{all}</mark>,
    )
    at = m.index + all.length
  }
  out.push(text.slice(at))
  return <>{out}</>
}
