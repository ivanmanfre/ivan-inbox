/* ==========================================================================
   src/wb/sales/Pack.tsx — one prospect's pack, as a window he can read.

   THE SURFACE THIS HAS TO BEAT is a phone browser with four tabs open on four
   files. So the window is one document with a strip of six names across the
   top, and the strip never moves: the card, the call sheet, the audience
   audit, the asset ideas, the prospect file, and the two or three links that
   are worth having in his hand on the call.

   Three things this file is deliberate about.

   1. THE CARD FILLS THE VIEWPORT. The shell already exports `HtmlPreview`,
      which MEASURES its content and grows to it (160-1200px). That is right
      for a 3 KB draft preview and wrong here: the cards are 40-50 KB of
      generated HTML, so a measured iframe becomes a 6,000px element inside a
      scrolling column and the reader loses the sense of where he is. This
      frame is pinned to the viewport instead and scrolls INSIDE itself, which
      is what every other reader of a long document does. Same sandbox —
      `allow-same-origin` with no `allow-scripts`, so nothing in a published
      card can execute — and no postMessage, because the sandbox forbids it.

   2. A BODY IS FETCHED WHEN ITS TAB IS OPENED, AND CACHED BY ITS STAMP (D6).
      The cache key is `kind:updated_at`, so a republish from the Mac — which
      only changes `updated_at` on the row the parent re-passes — invalidates
      exactly one document and refetches it, with no reload and no polling.

   3. COMPARE IS A TAB WITH NO ROW. It is three links, and the first of them
      always resolves, so the tab is never a dead end. The audit link is read
      out of the prospect file, which is why opening `compare` loads the
      prospect body: the URL lives in his document, not in a column.

   Nothing here writes. The window has no control that changes a pack.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Button, Icon, Skeleton, type IconName } from '../../ds'
import { Takeover } from '../takeover'
import { relAge, Sep } from '../kit'
import {
  COMPARE_URL, PACK_KINDS, fetchPackBody,
  type PackKind, type SalesPack, type SalesPackBody, type WeekEvent,
} from '../../lib/salesPacks'
import { Markdown } from './Markdown'
import { Prospect, auditUrl, prettify, readProspect } from './Prospect'
import './pack.css'

/** The five published kinds, plus the virtual link tab. */
export type PackDoc = PackKind | 'compare'

const DOC_LABEL: Record<PackDoc, string> = {
  card: 'Card',
  call_sheet: 'Call sheet',
  audience_audit: 'Audience audit',
  asset_ideas: 'Asset ideas',
  prospect: 'Prospect',
  extra: 'Extra',
  compare: 'Compare',
}

const DOCS: PackDoc[] = [...PACK_KINDS, 'compare']

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

function basename(path: string | null): string {
  const p = (path ?? '').split('/').filter(Boolean).pop()
  return p ?? ''
}

/** One row of the compare tab. The whole card is the link, and it is 44px tall. */
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

export function Pack({ slug, doc, onDoc, onClose, mobile, index, event }: {
  slug: string
  doc: PackDoc
  onDoc: (d: PackDoc) => void
  onClose: () => void
  mobile: boolean
  index: SalesPack[]
  event: WeekEvent | null
}) {
  const rows = index.filter(r => r.prospect_slug === slug)
  const byKind = (k: PackKind) => rows.find(r => r.kind === k) ?? null

  // Compare has no row of its own: what it needs is the prospect file, because
  // the audit URL is written inside the document and not into a column.
  const want: PackKind = doc === 'compare' ? 'prospect' : doc
  const row = byKind(want)
  const stamp = row ? `${want}:${row.updated_at}` : ''

  const [cache, setCache] = useState<Record<string, SalesPackBody>>({})
  const [error, setError] = useState('')
  const have = stamp ? cache[stamp] : undefined
  const loading = Boolean(stamp) && !have && error === ''

  useEffect(() => {
    if (!stamp || have) return
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

  const prospectRow = byKind('prospect')
  const name = prospectRow?.meta.name ?? ''
  const label = name || prettify(slug.replace(/-/g, ' '))
  const sub = event
    ? whenLine(event.start_time)
    : (row?.meta.when ?? prospectRow?.meta.when ?? rows.find(r => r.meta.when)?.meta.when ?? '')

  const newest = rows.reduce<string | null>(
    (a, r) => (a && a > r.updated_at ? a : r.updated_at), null,
  )
  const footStamp = doc === 'compare' ? newest : (row?.updated_at ?? newest)

  const tail = event?.meeting_url
    ? (
      <Button
        size="sm"
        icon="external"
        onClick={() => window.open(event.meeting_url as string, '_blank', 'noopener,noreferrer')}
      >Join</Button>
    )
    : undefined

  return (
    <Takeover label={label} sub={sub || undefined} onClose={onClose} mobile={mobile} tail={tail} bodyClass="a-pk">
      <div className="a-pk-tabs" role="tablist" aria-label="This pack">
        {DOCS.map(d => {
          const missing = d !== 'compare' && !byKind(d)
          return (
            <button
              key={d}
              type="button"
              role="tab"
              className="ds-tabs-item"
              aria-selected={d === doc}
              data-active={d === doc}
              disabled={missing}
              title={missing ? 'not published yet' : undefined}
              onClick={() => onDoc(d)}
            >{DOC_LABEL[d]}</button>
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
            <LinkCard
              icon="video"
              title="Meeting"
              url={event?.meeting_url ?? null}
              off="no link on the invite"
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
              {basename(have.source_path) || have.title}
              <Sep />{Math.max(1, Math.round((have.meta.bytes ?? have.body.length) / 1024))} KB
              <Sep />published {relAge(have.updated_at)}
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
    </Takeover>
  )
}
