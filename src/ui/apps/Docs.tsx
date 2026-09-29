import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { FileText, Info, Lightbulb, Search, TriangleAlert } from 'lucide-react'
import { PEOPLE } from '../../sim/data.ts'
import { DOCS, DOC_IDS } from '../../sim/docs.ts'
import type { Block } from '../../sim/docs.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, Company, EASE, LOGOS, SPRING } from '../bits.tsx'
import { FileCard, Rich } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const NOTE = { info: Info, warn: TriangleAlert, tip: Lightbulb }
const words = (blocks: Block[]) => JSON.stringify(blocks).split(/\s+/).length

function BlockView({ b }: { b: Block }) {
  if ('h' in b) return <h2>{b.h}</h2>
  if ('p' in b) return <p><Rich text={b.p} /></p>
  if ('list' in b) return <ul>{b.list.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul>
  if ('steps' in b) return <ol>{b.steps.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ol>
  if ('code' in b) return <pre>{b.code}</pre>
  if ('files' in b) return <div className="files">{b.files.map(f => <FileCard key={f} a={{ kind: 'code', file: f }} />)}</div>
  if ('pages' in b) return <div className="files">{b.pages.map(d => <FileCard key={d} a={{ kind: 'doc', doc: d }} />)}</div>
  if ('note' in b) {
    const Icon = NOTE[b.tone]
    return <div className={'cf-note ' + b.tone}><Icon size={17} strokeWidth={2} /><div><b>{b.title}</b><p><Rich text={b.note} /></p></div></div>
  }
  const [head, ...rows] = b.table
  return (
    <table>
      {head.some(Boolean) && <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row"><Rich text={c} /></th> : <td key={j}><Rich text={c} /></td>))}</tr>)}</tbody>
    </table>
  )
}

export function Docs() {
  const page = useSim(s => s.docPage)
  const [query, setQuery] = useState('')
  const doc = DOCS[page]
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [page])

  const q = query.trim().toLowerCase()
  const hits = DOC_IDS.filter(id => !q || (DOCS[id].title + JSON.stringify(DOCS[id].blocks)).toLowerCase().includes(q))
  const groups = [...new Set(hits.map(id => DOCS[id].group))]

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo" src={LOGOS.docs} alt="" />
        <div className="stack title"><b>Confluence</b><span>Ledgerly · Engineering</span></div>
        <div className="grow" />
        <label className="search"><Search size={13} strokeWidth={2.4} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pages" aria-label="Search pages" /></label>
      </DragBar>
      <div className="app-body">
        <nav className="sidebar cf-side">
          <div className="cf-space"><Company size={30} /><div className="stack"><b>Engineering</b><span>Space · {DOC_IDS.length} pages</span></div></div>
          <div className="side-scroll">
            {groups.map(g => (
              <div key={g} className="cf-group">
                <div className="side-label">{g}</div>
                {hits.filter(id => DOCS[id].group === g).map(id => (
                  <button key={id} className={'side-item' + (page === id ? ' on' : '')} onClick={() => sim.openDoc(id)}>
                    {page === id && <motion.i layoutId="page" className="side-pill" transition={SPRING} />}
                    <FileText size={14} strokeWidth={1.9} className="sub" />
                    <span className="grow ellipsis">{DOCS[id].title}</span>
                  </button>
                ))}
              </div>
            ))}
            {!hits.length && <div className="empty">No pages match “{query.trim()}”</div>}
          </div>
        </nav>
        <div className="cf-page" ref={scroller}>
          <motion.article key={doc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <div className="cf-crumbs">Engineering<span>/</span>{doc.group}</div>
            <h1>{doc.title}</h1>
            <div className="cf-byline">
              <Avatar who={doc.owner} size={26} />
              <div className="stack"><b>Owned by {PEOPLE[doc.owner].name}</b><span>Last updated {doc.updated} · {Math.max(1, Math.round(words(doc.blocks) / 200))} min read</span></div>
            </div>
            <div className="cf-body">{doc.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
          </motion.article>
        </div>
      </div>
    </div>
  )
}
