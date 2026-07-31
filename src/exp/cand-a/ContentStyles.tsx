import { useRef } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useStyles } from '../../hooks/useStyles'
import { cleanStyleTitle, previewKeyFor, type StylePreview, type StylePrompt } from '../../lib/styles'

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

// One family's grid. The two are rendered as separate labelled sections
// because they are separate prompt libraries that happen to share names:
// 'style-before-after' is a carousel STRUCTURE, 'image-style-before-after' is a
// post IMAGE treatment, and only the image one has published examples. Cards
// look up their previews with previewKeyFor (family-qualified) — the bare
// normalised key would put those four images on both cards.
function StyleSection({ label, styles, previews }: {
  label: string; styles: StylePrompt[]; previews: Map<string, StylePreview>
}) {
  if (styles.length === 0) return null
  return (
    <>
      <div className="res-hdr">{label}</div>
      <div className="sty-grid">
        {styles.map(s => {
          const preview = previews.get(previewKeyFor(s))
          const img = preview?.imageUrls[0]
          return (
            <div className="sty-card" key={s.slug}>
              {img ? <img className="sty-thumb" src={img} alt="" /> : (
                <div className="sty-thumb-empty">No recent example</div>
              )}
              <div className="sty-body">
                <div className="sty-title">{cleanStyleTitle(s.title)}</div>
                <div className="sty-meta">
                  {preview ? `${preview.count} used · ${relTime(preview.lastUsedAt)}` : 'Not used recently'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
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
        // joined ONLY through the shared family-qualified key — never a
        // hardcoded map — so a style with no recent example gets the designed
        // empty tile instead of borrowing another style's images.
        <>
          <StyleSection
            label="Post styles"
            styles={styles.filter(s => s.family === 'structure')}
            previews={previews}
          />
          <StyleSection
            label="Image styles"
            styles={styles.filter(s => s.family === 'image')}
            previews={previews}
          />
        </>
      )}

      <div className="res-hdr">Resources</div>
      {resources.length === 0 ? (
        <div className="empty">No published resources yet.</div>
      ) : (
        resources.map(r => (
          <div className="res-row" key={r.id}>
            {r.cover_url
              ? <img className="res-thumb" src={r.cover_url} alt="" />
              : <div className="res-thumb res-thumb-empty">No image</div>}
            <div className="res-mid">
              {/* Same register cleanup as the style cards above — a resource
                  topic can carry the identical "Style: " / "Carousel Style — "
                  prose prefix content_prompts titles do, and cleanStyleTitle is
                  a no-op on any topic that doesn't (D8 register-drift fix). */}
              <div className="res-topic">{r.topic ? cleanStyleTitle(r.topic) : 'Untitled resource'}</div>
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
