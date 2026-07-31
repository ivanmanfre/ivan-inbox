import { useRef } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useStyles } from '../../hooks/useStyles'
import { cleanStyleTitle, previewKeyFor, type StylePreview, type StylePrompt } from '../../lib/styles'

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

// One family's grid. content_prompts holds two style libraries that share
// names — 'style-before-after' is a carousel STRUCTURE, 'image-style-before-after'
// is a post IMAGE treatment, and only the latter has published examples — so
// they render as two labelled sections and each card looks its previews up by
// the family-qualified key. previewKeyFor, never the bare normalised key: the
// bare key would hang the image examples on the structure card too.
function StyleSection({ label, styles, previews }: {
  label: string; styles: StylePrompt[]; previews: Map<string, StylePreview>
}) {
  if (styles.length === 0) return null
  return (
    <>
      <div className="ops-sechdr" style={{ cursor: 'default' }}><span>{label} · {styles.length}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px' }}>
        {styles.map(s => {
          const p = previews.get(previewKeyFor(s))
          const img = p?.imageUrls[0]
          return (
            <div key={s.slug} style={{ background: 'var(--surface)', borderRadius: 16, overflow: 'hidden' }}>
              {img ? (
                <img
                  src={img} alt=""
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: 'var(--text3)', fontSize: 13,
                    background: 'var(--surface2)', textAlign: 'center', padding: 12,
                  }}
                >
                  No recent example
                </div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{cleanStyleTitle(s.title)}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {p ? `${p.count} used · last ${timeAgo(p.lastUsedAt)}` : 'No recent example'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Styles segment of the Work tab: a live-enumerated roster (D8, never a
// hardcoded catalogue — three past ones were all wrong the day after they
// were written) joined to real published previews via the SAME normalizer the
// roster itself is keyed by ("style-teardown" -> "teardown"), never a fuzzy
// stemmer that could silently attach one style's examples to another's card.
export function StylesGallery() {
  const { styles, previews, resources, loading, error, refresh } = useStyles()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, refresh)

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Styles</h2><div className="avatar-me">IM</div></div>
      </div>
      {loading && styles.length === 0 ? (
        <div className="rows"><div className="empty">Loading…</div></div>
      ) : error ? (
        <div className="rows"><div className="empty">{error}</div></div>
      ) : (
        <div className="rows" ref={rowsRef}>
          <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
          {styles.length === 0 ? (
            <div className="empty">No styles yet.</div>
          ) : (
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

          <div className="ops-sechdr" style={{ cursor: 'default', marginTop: 20 }}>
            <span>Resources · {resources.length}</span>
          </div>
          {resources.length === 0 ? (
            <div className="empty">No published resources yet.</div>
          ) : (
            <div style={{ padding: '0 16px' }}>
              {resources.map(r => (
                <a
                  key={r.id}
                  href={r.resource_url} target="_blank" rel="noreferrer"
                  className="log-r" style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 10, flex: 'none', background: 'var(--surface2)', overflow: 'hidden' }}>
                    {r.cover_url && (
                      <img src={r.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                  </div>
                  <div className="log-mid">
                    <div className="log-top">
                      <span className="log-nm">{r.topic || 'Untitled'}</span>
                      {r.format && (
                        <span className="log-chip" style={{ background: 'var(--surface3)', color: 'var(--text2)' }}>
                          {r.format.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="log-tm" style={{ color: 'var(--accent)', fontSize: 16 }}>↗</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
