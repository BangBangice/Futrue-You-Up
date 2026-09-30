import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Eye, FileText, Info, Lightbulb, Pencil, Plus, Search, TriangleAlert } from 'lucide-react'
import type { Doc } from '../../../shared/types.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, Company, EASE, LOGOS, SPRING } from '../bits.tsx'
import { linkify } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const CALLOUT = { NOTE: ['info', Info], WARNING: ['warn', TriangleAlert], TIP: ['tip', Lightbulb] } as const
const OURS = /^(code|jira|doc|chan):/
const follow = (href: string) => {
  const [kind, target] = [href.slice(0, href.indexOf(':')), href.slice(href.indexOf(':') + 1)]
  if (kind === 'code') void sim.openCode(target)
  else if (kind === 'jira') sim.openTicket(target)
  else if (kind === 'doc') sim.openDoc(target)
  else sim.openChat(target)
}
const textOf = (node: ReactNode): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' && 'props' in node ? textOf((node.props as { children?: ReactNode }).children) : '')

/** Renders wiki Markdown. Links into the sim open the right app; callouts use the `> [!WARNING] Title` form. */
export function Page({ body }: { body: string }) {
  const files = useSim(s => s.files)
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={url => (OURS.test(url) ? url : defaultUrlTransform(url))}
      components={{
        a: ({ href = '', children }) => (OURS.test(href) ? <button type="button" className={'link' + (href.startsWith('code:') ? ' mono' : '')} onClick={() => follow(href)}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>),
        blockquote: ({ children }) => {
          const m = /^\s*\[!(NOTE|WARNING|TIP)\]\s*([^\n]*)\n?/.exec(textOf(children))
          if (!m) return <blockquote>{children}</blockquote>
          const [tone, Icon] = CALLOUT[m[1] as keyof typeof CALLOUT]
          return <div className={'cf-note ' + tone}><Icon size={17} strokeWidth={2} /><div><b>{m[2]}</b><p>{textOf(children).slice(m[0].length).trim()}</p></div></div>
        },
      }}
    >{linkify(body, files)}</Markdown>
  )
}

function Editor({ doc, onDone }: { doc: Doc | null; onDone: () => void }) {
  const [title, setTitle] = useState(doc?.title ?? '')
  const [group, setGroup] = useState(doc?.group ?? 'Incidents')
  const [body, setBody] = useState(doc?.body ?? '## Summary\n\n\n## Impact\n\n\n## Cause\n\n\n## Fix\n\n\n## What we’ll change\n\n')
  const [preview, setPreview] = useState(false)
  const groups = [...new Set(useSim(s => s.docs).map(d => d.group).concat('Incidents', 'Notes'))]
  const save = async () => { if (await sim.saveDoc(doc?.id, { title: title.trim(), group, body })) onDone() }
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <div className="cf-editbar">
        <select className="select" value={group} onChange={e => setGroup(e.target.value)} aria-label="Section">{groups.map(g => <option key={g}>{g}</option>)}</select>
        <div className="grow" />
        <button className="btn btn-chip sm" onClick={() => setPreview(p => !p)}>{preview ? <><Pencil size={13} />Write</> : <><Eye size={13} />Preview</>}</button>
        <button className="btn btn-chip sm" onClick={onDone}>Cancel</button>
        <button className="btn btn-accent sm" disabled={!title.trim()} onClick={save}>{doc ? 'Update' : 'Publish'}</button>
      </div>
      <input className="cf-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Give this page a title" aria-label="Page title" autoFocus={!doc} />
      {preview ? <div className="cf-body"><Page body={body} /></div>
        : <textarea className="cf-source" value={body} onChange={e => setBody(e.target.value)} aria-label="Page content" spellCheck placeholder="Write in Markdown. File names, ticket ids and #channels become links." />}
      {!preview && <div className="sub small">Markdown: ## heading, **bold**, - list, | table |, ``` code. Callouts: &gt; [!WARNING] Title</div>}
    </motion.article>
  )
}

export function Docs() {
  const docs = useSim(s => s.docs)
  const page = useSim(s => s.docPage)
  const cast = useSim(s => s.cast), company = useSim(s => s.company)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'read' | 'edit' | 'new'>('read')
  const doc = docs.find(d => d.id === page) ?? docs[0]
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); setMode('read'); if (page) sim.seen('doc:' + page) }, [page])

  const q = query.trim().toLowerCase()
  const hits = docs.filter(d => !q || (d.title + d.body).toLowerCase().includes(q))
  const groups = [...new Set(hits.map(d => d.group))]
  if (!doc) return <div className="app" />

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo" src={LOGOS.docs} alt="" />
        <div className="stack title"><b>Confluence</b><span>{company} · Engineering</span></div>
        <div className="grow" />
        <label className="search"><Search size={13} strokeWidth={2.4} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pages" aria-label="Search pages" /></label>
        <button className="btn btn-accent sm" onClick={() => { setMode('new'); sim.dive('docs') }}><Plus size={14} strokeWidth={2.6} />Create</button>
      </DragBar>
      <div className="app-body">
        <nav className="sidebar cf-side">
          <div className="cf-space"><Company size={30} /><div className="stack"><b>Engineering</b><span>Space · {docs.length} pages</span></div></div>
          <div className="side-scroll">
            {groups.map(g => (
              <div key={g}>
                <div className="side-label">{g}</div>
                {hits.filter(d => d.group === g).map(d => (
                  <button key={d.id} data-guide={'doc:' + d.id} className={'side-item' + (page === d.id ? ' on' : '')} onClick={() => sim.openDoc(d.id)}>
                    {page === d.id && <motion.i layoutId="page" className="side-pill" transition={SPRING} />}
                    <FileText size={14} strokeWidth={1.9} className="sub" />
                    <span className="grow ellipsis">{d.title}</span>
                  </button>
                ))}
              </div>
            ))}
            {!hits.length && <div className="empty">No pages match “{query.trim()}”</div>}
          </div>
        </nav>
        <div className="cf-page" ref={scroller}>
          {mode !== 'read' ? <Editor key={mode + doc.id} doc={mode === 'edit' ? doc : null} onDone={() => setMode('read')} /> : (
            <motion.article key={doc.id + doc.version} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="cf-crumbs">Engineering<span>/</span>{doc.group}<div className="grow" /><button className="btn btn-chip sm" onClick={() => setMode('edit')}><Pencil size={13} strokeWidth={2.2} />Edit</button></div>
              <h1>{doc.title}</h1>
              <div className="cf-byline">
                <Avatar who={doc.owner} size={26} />
                <div className="stack"><b>Owned by {cast[doc.owner].name}</b><span>Last updated {doc.updated} · version {doc.version} · {Math.max(1, Math.round(doc.body.split(/\s+/).length / 200))} min read</span></div>
              </div>
              <div className="cf-body"><Page body={doc.body} /></div>
            </motion.article>
          )}
        </div>
      </div>
    </div>
  )
}
