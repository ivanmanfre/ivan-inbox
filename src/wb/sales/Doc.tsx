/* ==========================================================================
   src/wb/sales/Doc.tsx — one document, on its OWN browser tab.

   THE SURFACE THIS HAS TO BEAT is a phone browser with four tabs open on four
   files, and the first build lost to it: the pack opened as a window INSIDE
   the inbox, so every document he wanted next to another on a call was the
   same one address, one at a time. Ivan, 2026-09-07: "i wanted the links on
   html to oopen in new tabs of call sheet, audience audit like i usually do
   for other calls, asset ideas, the compare page... this is all embedded which
   is annoying."

   So a document is a PAGE now, not a window:

     #doc?slug=<prospect>&doc=<card|call_sheet|audience_audit|asset_ideas|prospect|compare>

   `App.tsx` routes that hash BEFORE the experiment gate, so the tab paints
   this and nothing else — no rail, no phone chrome, no shell. The chips on the
   week's rows are anchors at `target="_blank"`, which is what buys back the
   middle click, the cmd-click and the browser's own "open in new tab": four
   documents, four tabs, cmd-1 to cmd-4 on the call. The session lives in
   localStorage, so a fresh tab is already signed in and RLS still pins the
   rows to his uid.

   Four things this file is deliberate about.

   1. THE TAB IS NAMED AFTER WHAT IS IN IT. `document.title` becomes
      "<person> · <company> — Audience audit". With four tabs open the title is
      the only thing telling them apart, and a row of tabs that all read the
      same is the annoyance he is complaining about in another form.

   2. THE CARD FILLS THE VIEWPORT. The shell exports `HtmlPreview`, which
      MEASURES its content and grows to it (160-1200px). That is right for a
      3 KB draft preview and wrong here: the cards are 40-50 KB of generated
      HTML. This frame is pinned to the viewport and scrolls INSIDE itself.
      Same sandbox — `allow-same-origin` with no `allow-scripts`, so nothing in
      a published card can execute — and no postMessage, because the sandbox
      forbids it.

   3. A BODY IS FETCHED WHEN ITS DOCUMENT IS OPENED, AND CACHED BY ITS STAMP.
      The cache key is `kind:updated_at`, so a republish from the Mac
      invalidates exactly one document and refetches it, with no reload and no
      polling.

   4. COMPARE IS A DOCUMENT WITH NO ROW. It is two links, and the first of them
      always resolves, so it is never a dead end. The audit link is read out of
      the prospect file, which is why opening `compare` loads the prospect
      body: the URL lives in his document, not in a column.

   Nothing here writes. The page has no control that changes a pack.
   ========================================================================== */
import { useEffect, useState, type MouseEvent } from 'react'
import { Icon, Skeleton, type IconName } from '../../ds'
import { relAge, Sep } from '../kit'
import {
  COMPARE_URL, PACK_KINDS, fetchPackBody, fetchPackIndex, subscribePacks,
  type PackKind, type SalesPack, type SalesPackBody,
} from '../../lib/salesPacks'
import { Markdown } from './Markdown'
import { Prospect, auditUrl, prettify, readProspect } from './Prospect'
import './pack.css'

/** The five published kinds, plus the virtual link document. */
export type PackDoc = PackKind | 'compare'

export const DOC_LABEL: Record<PackDoc, string> = {
  card: 'Card',
  call_sheet: 'Call sheet',
  audience_audit: 'Audience audit',
  asset_ideas: 'Asset ideas',
  prospect: 'Prospect',
  extra: 'Extra',
  compare: 'Compare',
}

const DOCS: PackDoc[] = [...PACK_KINDS, 'compare']

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

/** `#doc?slug=<s>&doc=<d>` — a whole page, and therefore a real link. */
export function docHref(slug: string, doc: PackDoc): string {
  return `#doc?slug=${encodeURIComponent(slug)}&doc=${doc}`
}

/**
 * Is this hash a document page? Read by `App.tsx` before the experiment gate,
 * which is why it is a plain string test: the doc route must not drag the
 * workbench shell's router into the decision that bypasses it.
 */
export function isDocHash(hash: string): boolean {
  return /^#doc(\?|$)/.test(hash)
}

export function readDocHash(hash: string): { slug: string; doc: PackDoc } | null {
  if (!isDocHash(hash)) return null
  const at = hash.indexOf('?')
  if (at === -1) return null
  const q = new URLSearchParams(hash.slice(at + 1))
  const slug = q.get('slug')
  if (!slug) return null
  const doc = q.get('doc') ?? 'card'
  return { slug, doc: (DOCS as string[]).includes(doc) ? doc as PackDoc : 'card' }
}

/** Back to the week. The experiment gate is read at MOUNT, so a hash write
 *  alone would leave this page on screen at the week's address — hence a
 *  deliberate reload on the way out. */
const SALES_HREF = '#exp/brain-b/sales'

function basename(path: string | null): string {
  const p = (path ?? '').split('/').filter(Boolean).pop()
  return p ?? ''
}

/**
 * `Mon 7 Sep · 13:00 Warsaw · 11:00 UTC`. Both zones on one line because he
 * books in one and lives in the other, and a single time on a call row is the
 * one that gets read as the wrong one. Intl only; no date library in this app.
 */
export function whenLine(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw',
  }).format(d)
  const at = (tz: string) => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  }).format(d)
  return `${day} · ${at('Europe/Warsaw')} Warsaw · ${at('UTC')} UTC`
}

/** One row of the compare document. The whole card is the link, and it is 44px tall. */
function LinkCard({ icon, title, url, off }: {
  icon: IconName; title: string; url: string | null; off?: string
}) {
  if (!url) {
    return (
      <div className="a-pk-card" data-off="">
        <Icon name={icon} size={20} />
        <span className="a-pk-card-t">
          <span className="a-title-t">{title}</span>
          <span className="a-meta">{off ?? 'not on file'}</span>
        </span>
      </div>
    )
  }
  return (
    <a className="a-pk-card" href={url} target="_blank" rel="noopener noreferrer">
      <Icon name={icon} size={20} />
      <span className="a-pk-card-t">
        <span className="a-title-t">{title}</span>
        <span className="a-meta a-pk-url">{url}</span>
      </span>
      <Icon name="external" size={16} />
    </a>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function SalesDoc() {
  const [route, setRoute] = useState(() => readDocHash(location.hash))
  const [index, setIndex] = useState<SalesPack[]>([])
  const [cache, setCache] = useState<Record<string, SalesPackBody>>({})
  const [error, setError] = useState('')

  // The strip at the top navigates WITHIN this tab — he already has the tab he
  // asked for, and a sibling is one hash away. A cmd-click on it still opens
  // that sibling in a tab of its own, because it is an anchor and not a button.
  useEffect(() => {
    const onHash = () => setRoute(readDocHash(location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // The index names the person and says which documents exist. It is small
  // (every column except `body`) and it re-reads on a republish, so a document
  // published while the tab is open appears on the strip without a reload.
  useEffect(() => {
    let alive = true
    const load = () => {
      fetchPackIndex()
        .then(rows => { if (alive) setIndex(rows) })
        .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    }
    load()
    const off = subscribePacks(load)
    return () => { alive = false; off() }
  }, [])

  const slug = route?.slug ?? ''
  const doc: PackDoc = route?.doc ?? 'card'
  const rows = index.filter(r => r.prospect_slug === slug)
  const byKind = (k: PackKind) => rows.find(r => r.kind === k) ?? null

  // Compare has no row of its own: what it needs is the prospect file, because
  // the audit URL is written inside the document and not into a column.
  const want: PackKind = doc === 'compare' ? 'prospect' : doc
  const row = byKind(want)
  const stamp = row ? `${want}:${row.updated_at}` : ''
  const have = stamp ? cache[stamp] : undefined
  const loading = Boolean(stamp) && !have && error === ''

  useEffect(() => {
    if (!slug || !stamp || have) return
    let alive = true
    setError('')
    fetchPackBody(slug, want)
      .then(b => {
        if (!alive) return
        if (b) setCache(m => ({ ...m, [stamp]: b }))
        else setError('This document is not published yet.')
      })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'It could not be read.') })
    return () => { alive = false }
  }, [slug, want, stamp, have])

  // The page's name is the person and the company, the way the prospect file
  // writes it. The prettified slug is the floor, so an unpublished prospect row
  // never leaves the header blank.
  const prospectRow = byKind('prospect')
  const named = [prospectRow?.meta.name, prospectRow?.meta.company].filter(Boolean).join(' · ')
  const label = named || prettify(slug.replace(/-/g, ' '))
  const sub = whenLine(row?.call_at ?? prospectRow?.call_at ?? null)
    || row?.meta.when || prospectRow?.meta.when
    || rows.find(r => r.meta.when)?.meta.when || ''

  // FOUR TABS, FOUR NAMES. This is most of what the browser tab buys over the
  // window it replaced, so it is rewritten on every route change.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = slug ? `${label} — ${DOC_LABEL[doc]}` : 'Sales'
  }, [label, doc, slug])

  const newest = rows.reduce<string | null>(
    (a, r) => (a && a > r.updated_at ? a : r.updated_at), null,
  )
  const footStamp = doc === 'compare' ? newest : (row?.updated_at ?? newest)

  const backToWeek = (e: MouseEvent) => {
    e.preventDefault()
    location.hash = SALES_HREF
    location.reload()
  }

  if (!route) {
    return (
      <div className="a-root ds-body" data-surface="sales-doc">
        <div className="a-head">
          <div className="a-head-t"><h2 className="a-head-title">No document named</h2></div>
        </div>
        <div className="a-body">
          <div className="a-meta">
            This address carries no prospect.{' '}
            <a href={SALES_HREF} onClick={backToWeek}>Back to the week</a>.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="a-root ds-body" data-surface="sales-doc" data-doc={doc} data-slug={slug}>
      <div className="a-head">
        <div className="a-head-t">
          <h2 className="a-head-title">
            <span className="a-eyebrow a-sl-eb">{DOC_LABEL[doc]}</span>
            {label}
          </h2>
          {sub ? <div className="a-head-sub a-mono">{sub}</div> : null}
        </div>
        <div className="a-head-tail">
          <a className="a-meta" href={SALES_HREF} onClick={backToWeek}>The week</a>
        </div>
      </div>

      <div className="a-body a-pk">
        <div className="a-pk-tabs" role="tablist" aria-label="This pack">
          {DOCS.map(d => {
            const missing = d !== 'compare' && !byKind(d)
            return missing
              ? (
                <span key={d} className="ds-tabs-item" data-missing="" title="not published yet">
                  {DOC_LABEL[d]}
                </span>
              )
              : (
                <a
                  key={d}
                  role="tab"
                  className="ds-tabs-item"
                  aria-selected={d === doc}
                  data-active={d === doc}
                  href={docHref(slug, d)}
                >{DOC_LABEL[d]}</a>
              )
          })}
        </div>

        <div className="a-pk-doc">
          {doc === 'compare' ? (
            <div className="a-pk-cards">
              <LinkCard icon="layers" title="Compare page" url={COMPARE_URL} />
              <LinkCard
                icon="chart"
                title="Audit"
                url={have ? auditUrl(readProspect(have.body)) : null}
                off={have ? 'no audit on file' : 'reading the prospect file'}
              />
            </div>
          ) : loading ? (
            <div className="a-pk-load" role="status" aria-label="Opening the document">
              <Skeleton shape="title" width="40%" />
              <Skeleton shape="line" />
              <Skeleton shape="line" width="80%" />
              <Skeleton shape="block" />
            </div>
          ) : error ? (
            <div className="a-meta a-sev-urgent">{error}</div>
          ) : !have ? (
            <div className="a-meta">This document is not published yet.</div>
          ) : doc === 'card' ? (
            <>
              <div className="a-meta a-pk-stamp" data-pack-updated={have.updated_at}>
                <span>
                  {basename(have.source_path) || have.title}
                  <Sep />{Math.max(1, Math.round((have.meta.bytes ?? have.body.length) / 1024))} KB
                  <Sep />published {relAge(have.updated_at)}
                </span>
                <span className="a-dim">sandboxed, scripts off</span>
              </div>
              <iframe
                className="a-pk-frame"
                title={`${label} call card`}
                sandbox="allow-same-origin"
                srcDoc={have.body}
              />
            </>
          ) : doc === 'prospect' ? (
            <Prospect json={have.body} />
          ) : (
            <Markdown src={have.body} label={DOC_LABEL[doc]} />
          )}
        </div>

        <div className="a-meta a-pk-foot">
          published from the Mac<Sep />{footStamp ? relAge(footStamp) : 'never'}
        </div>
      </div>
    </div>
  )
}

export default SalesDoc
