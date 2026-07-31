import { useRef } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useStyles } from '../../hooks/useStyles'
import { normalizeStyleKey } from '../../lib/styles'

// slug → readable title ('style-case-study' → 'Case Study'). Cosmetic only —
// the roster's real title column already wins when present (fetchStyleRoster
// falls back to the slug only when title is blank).
function cleanTitle(t: string): string {
  return t
    .replace(/^style-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function ContentStyles() {
  const { styles, previews, resources, loading, error, refresh } = useStyles()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  return (
    <div className="rows" ref={rowsRef}>
      <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
      {error ? (
        <div className="ct-broken" style={{ margin: '14px 16px 0' }}>{error}</div>
      ) : loading && styles.length === 0 ? (
        <div className="sty-grid" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="sty-card" key={i}>
              <div className="sk" style={{ aspectRatio: '1/1', borderRadius: 0 }} />
              <div className="sty-body">
                <div className="sk sk-line" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : styles.length === 0 ? (
        <div className="empty">No active styles in the roster.</div>
      ) : (
        // D8: the roster's slug and a published draft's taxonomy value are
        // joined ONLY through the shared normalizer — never a hardcoded map —
        // so a style with no recent example gets the designed empty tile
        // instead of borrowing another style's images.
        <div className="sty-grid">
          {styles.map(s => {
            const key = normalizeStyleKey(s.slug)
            const preview = previews.get(key)
            const img = preview?.imageUrls[0]
            return (
              <div className="sty-card" key={s.slug}>
                {img ? <img className="sty-thumb" src={img} alt="" /> : (
                  <div className="sty-thumb-empty">No recent example</div>
                )}
                <div className="sty-body">
                  <div className="sty-title">{cleanTitle(s.title)}</div>
                  <div className="sty-meta">
                    {preview ? `${preview.count} used · ${relTime(preview.lastUsedAt)}` : 'Not used recently'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="res-hdr">Resources</div>
      {resources.length === 0 ? (
        <div className="empty">No published resources yet.</div>
      ) : (
        resources.map(r => (
          <div className="res-row" key={r.id}>
            {r.cover_url ? <img className="res-thumb" src={r.cover_url} alt="" /> : <div className="res-thumb" />}
            <div className="res-mid">
              <div className="res-topic">{r.topic || 'Untitled resource'}</div>
              <div className="res-meta">
                {r.format && <span className="ct-chip">{r.format}</span>}
                <span>{relTime(r.updated_at)}</span>
              </div>
            </div>
            <a className="res-link" href={r.resource_url} target="_blank" rel="noreferrer">↗</a>
          </div>
        ))
      )}
    </div>
  )
}
