/* ==========================================================================
   src/wb/sales/Prospect.tsx — the prospect file, read as a briefing.

   The publisher stores this document as `application/json` because that is
   what it is on disk. Handing him the JSON on a phone two minutes before a
   call would be handing him a data structure and asking him to be the parser;
   what he needs is the four things the file actually holds — what is true
   about them, the numbers, how the call walks, and what to say in each phase.

   So the shape is READ here, once, into a view (`readProspect`), and the view
   is what the component draws. The parse is a pure function on purpose: it is
   the half that can be wrong (a key renamed on the Mac, a phase with only a
   `note`, a file half-written), and a pure function is the half a test can
   hold. The raw text stays reachable behind a closed disclosure, so a key this
   view does not know about is never silently lost — it is one tap away.

   Malformed JSON is a normal state, not a crash: the file is written by a
   generator on another machine and read here minutes later.
   ========================================================================== */
import { useState, type ReactNode } from 'react'
import { Chip, Icon, Table } from '../../ds'
import './pack.css'

export type ProspectPhase = {
  add?: string[]
  drop?: string[]
  skip?: string
  note?: string
  lines?: Record<string, string>
}

export type ProspectInsert = {
  name?: string
  after?: string
  minutes?: number
  lines?: string[]
  note?: string
}

export type ProspectView = {
  /** false when the body did not parse as JSON; the raw text is all there is. */
  ok: boolean
  raw: string
  error: string
  name: string
  when: string
  facts: string[]
  table: { title: string; head: string[]; rows: string[][] } | null
  tableNote: string
  walk: string
  /** In file order, because the file order is the order of the call. */
  phases: Array<[string, ProspectPhase]>
  inserts: ProspectInsert[]
  /** Every http(s) URL anywhere in the document, in the order they appear. */
  urls: string[]
}

const URL_RE = /https?:\/\/[^\s"'<>\\]+/g

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** `context_qualify` reads as "Context qualify" — the file's key, said out loud. */
export function prettify(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

/** The JSON→view mapping. Pure, total, and the thing `prospect.test.ts` drives. */
export function readProspect(json: string): ProspectView {
  const empty: ProspectView = {
    ok: false, raw: json, error: '', name: '', when: '', facts: [], table: null,
    tableNote: '', walk: '', phases: [], inserts: [], urls: [],
  }
  const urls = [...new Set(json.match(URL_RE) ?? [])]
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'It did not parse as JSON', urls }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ...empty, error: 'The document is not a JSON object', urls }
  }
  const d = data as Record<string, unknown>

  const rawTable = (d.table && typeof d.table === 'object' ? d.table : {}) as Record<string, unknown>
  const head = strings(rawTable.head)
  const rows = Array.isArray(rawTable.rows)
    ? rawTable.rows.map(r => strings(r)).filter(r => r.length > 0)
    : []

  const phases: Array<[string, ProspectPhase]> = []
  if (d.phases && typeof d.phases === 'object' && !Array.isArray(d.phases)) {
    for (const [k, v] of Object.entries(d.phases as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const p = v as Record<string, unknown>
      const lines: Record<string, string> = {}
      if (p.lines && typeof p.lines === 'object' && !Array.isArray(p.lines)) {
        for (const [lk, lv] of Object.entries(p.lines as Record<string, unknown>)) {
          if (typeof lv === 'string') lines[lk] = lv
        }
      }
      phases.push([k, {
        add: strings(p.add),
        drop: strings(p.drop),
        skip: str(p.skip),
        note: str(p.note),
        lines,
      }])
    }
  }

  const inserts: ProspectInsert[] = Array.isArray(d.insert)
    ? d.insert.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(x => {
      const o = x as Record<string, unknown>
      return {
        name: str(o.name),
        after: str(o.after),
        minutes: typeof o.minutes === 'number' ? o.minutes : undefined,
        lines: strings(o.lines),
        note: str(o.note),
      }
    })
    : []

  return {
    ok: true,
    raw: json,
    error: '',
    name: str(d.name),
    when: str(d.when),
    facts: strings(d.facts),
    table: head.length > 0 || rows.length > 0
      ? { title: str(rawTable.title), head, rows }
      : null,
    tableNote: str(d.table_note),
    walk: str(d.walk),
    phases,
    inserts,
    urls,
  }
}

/**
 * The audit link, if this prospect has one. A URL qualifies on its HOST being
 * the proof domain, or on its PATH carrying `/shared/` or `audit` — the three
 * shapes a proof page has been published under. First match wins, in document
 * order; a URL that qualifies on none of them is somebody else's website.
 */
export function auditUrl(view: ProspectView): string | null {
  for (const u of view.urls) {
    let parsed: URL
    try { parsed = new URL(u) } catch { continue }
    const path = parsed.pathname.toLowerCase()
    if (parsed.hostname.toLowerCase().includes('inboundonsteroids.com')) return u
    if (path.includes('/shared/') || path.includes('audit')) return u
  }
  return null
}

/** The disclosure, in the shape the call and draft windows already use. */
function Fold({ title, tail, children }: { title: string; tail?: ReactNode; children: ReactNode }) {
  const [on, setOn] = useState(false)
  return (
    <div className="a-pk-fold" data-on={on ? '' : undefined}>
      <button type="button" className="a-pk-fold-b a-plain" onClick={() => setOn(v => !v)} aria-expanded={on}>
        <span className="a-title-t">{title}</span>
        {tail ? <span className="a-meta">{tail}</span> : null}
        <span className="a-pk-fold-c" aria-hidden="true"><Icon name="forward" size={16} /></span>
      </button>
      {on ? <div className="a-pk-fold-body">{children}</div> : null}
    </div>
  )
}

function Section({ head, tail, children }: { head: string; tail?: ReactNode; children: ReactNode }) {
  return (
    <section className="a-pk-sec">
      <div className="a-pk-sec-h">
        <span className="a-eyebrow">{head}</span>
        {tail ? <span className="a-meta">{tail}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * The prospect file is written for the CARD, which is HTML, so a fact reads
 * `<b>Their Name</b>, Founder &amp; Chief …`. Rendered as text that is
 * tag soup on the phone; rendered with `dangerouslySetInnerHTML` it would be a
 * document from another machine executing inside the app. So the small
 * vocabulary the generator actually uses is TOKENISED and rebuilt as React
 * nodes — bold, italic, line break, the five entities — and every other tag is
 * dropped rather than escaped, because a stray `<span style=…>` is noise, not
 * content. Pure and exported so the mapping is testable without a DOM.
 */
export type RichToken = { t: 'text'; s: string; b?: boolean; i?: boolean } | { t: 'br' }

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
}

export function richTokens(src: string): RichToken[] {
  const out: RichToken[] = []
  let b = 0, i = 0, buf = ''
  const flush = () => { if (buf) { out.push({ t: 'text', s: buf, b: b > 0 || undefined, i: i > 0 || undefined }); buf = '' } }
  const rx = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>|&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g
  let last = 0, m: RegExpExecArray | null
  while ((m = rx.exec(src))) {
    buf += src.slice(last, m.index)
    last = m.index + m[0].length
    if (m[1]) {
      const tag = m[1].toLowerCase(), close = m[0][1] === '/'
      if (tag === 'br') { flush(); out.push({ t: 'br' }) }
      else if (tag === 'b' || tag === 'strong') { flush(); b += close ? -1 : 1; if (b < 0) b = 0 }
      else if (tag === 'i' || tag === 'em') { flush(); i += close ? -1 : 1; if (i < 0) i = 0 }
      // every other tag is dropped, its text kept
    } else if (m[2]) {
      const e = m[2]
      buf += e[0] === '#'
        ? String.fromCodePoint(Number(e[1] === 'x' || e[1] === 'X' ? `0${e.slice(1)}` : e.slice(1)) || 63)
        : ENTITIES[e.toLowerCase()] ?? `&${e};`
    }
  }
  buf += src.slice(last)
  flush()
  return out
}

/** The tokens as nodes. `<Rich s={fact} />` wherever the file's prose lands. */
export function Rich({ s }: { s: string }) {
  return (
    <>
      {richTokens(s).map((tk, n) => tk.t === 'br'
        ? <br key={n} />
        : tk.b
          ? <strong key={n}>{tk.i ? <em>{tk.s}</em> : tk.s}</strong>
          : tk.i ? <em key={n}>{tk.s}</em> : <span key={n}>{tk.s}</span>)}
    </>
  )
}

function Phase({ name, phase }: { name: string; phase: ProspectPhase }) {
  const lines = Object.entries(phase.lines ?? {})
  return (
    <Section head={prettify(name)}>
      {(phase.add ?? []).map((line, i) => (
        <blockquote key={`a${i}`} className="a-quote a-pk-quote"><Rich s={line} /></blockquote>
      ))}
      {lines.length > 0 && (
        <dl className="a-kv a-pk-lines">
          {lines.map(([k, v]) => (
            <span key={k} style={{ display: 'contents' }}><dt>{prettify(k)}</dt><dd><Rich s={v} /></dd></span>
          ))}
        </dl>
      )}
      {(phase.drop ?? []).length > 0 && (
        <div className="a-wrapline a-pk-drop">
          {(phase.drop ?? []).map((d, i) => <Chip key={i} tone="quiet">{d}</Chip>)}
        </div>
      )}
      {phase.skip ? <div className="a-body-t a-dim">Skip: <Rich s={phase.skip} /></div> : null}
      {phase.note ? <div className="a-meta"><Rich s={phase.note} /></div> : null}
    </Section>
  )
}

export function Prospect({ json }: { json: string }) {
  const v = readProspect(json)

  if (!v.ok) {
    return (
      <div className="a-pk-md">
        <div className="a-meta a-sev-urgent">This prospect file could not be read: {v.error}</div>
        <pre className="a-pre a-mono a-pk-pre">{v.raw}</pre>
      </div>
    )
  }

  const columns = (v.table?.head ?? []).map((h, i) => ({
    id: `c${i}`,
    header: h,
    cell: (row: string[]) => <span className="a-pre"><Rich s={row[i] ?? ''} /></span>,
  }))

  return (
    <div className="a-pk-md">
      {v.facts.length > 0 && (
        <Section head="Facts" tail={`${v.facts.length}`}>
          <ul className="a-pk-facts">
            {v.facts.map((f, i) => <li key={i} className="a-body-t"><Rich s={f} /></li>)}
          </ul>
        </Section>
      )}

      {v.table && columns.length > 0 && (
        <Section head={v.table.title || 'The numbers'}>
          <Table
            className="a-pk-table"
            columns={columns}
            rows={v.table.rows}
            rowKey={row => row.join('|')}
            label={v.table.title || 'The numbers'}
          />
          {v.tableNote ? <div className="a-meta"><Rich s={v.tableNote} /></div> : null}
        </Section>
      )}

      {v.walk ? (
        <Section head="How the call walks">
          <p className="a-body-t a-pre"><Rich s={v.walk} /></p>
        </Section>
      ) : null}

      {v.phases.map(([k, p]) => <Phase key={k} name={k} phase={p} />)}

      {v.inserts.length > 0 && (
        <Section head={v.inserts.length === 1 ? 'One insert' : `${v.inserts.length} inserts`}>
          {v.inserts.map((ins, i) => (
            <div key={i} className="a-pk-ins">
              <div className="a-wrapline">
                <span className="a-title-t">{ins.name || 'Insert'}</span>
                {typeof ins.minutes === 'number' && <Chip tone="quiet">{ins.minutes} min</Chip>}
                {ins.after ? <span className="a-meta">after {prettify(ins.after)}</span> : null}
              </div>
              {(ins.lines ?? []).map((line, j) => (
                <blockquote key={j} className="a-quote a-pk-quote"><Rich s={line} /></blockquote>
              ))}
              {ins.note ? <div className="a-meta"><Rich s={ins.note} /></div> : null}
            </div>
          ))}
        </Section>
      )}

      <Fold title="Raw JSON" tail={`${v.raw.length} characters`}>
        <pre className="a-pre a-mono a-pk-pre">{v.raw}</pre>
      </Fold>
    </div>
  )
}
