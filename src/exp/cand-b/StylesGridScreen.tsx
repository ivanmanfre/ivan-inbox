import { cleanStyleTitle, previewKeyFor, type StylePreview, type StylePrompt } from '../../lib/styles'

// One family's grid. content_prompts holds two style libraries that share
// names — 'style-before-after' is a carousel STRUCTURE,
// 'image-style-before-after' is a post IMAGE treatment, and only the latter has
// published examples — so each family gets its own labelled section and every
// card resolves previews by the family-qualified key.
function StyleSection({ label, styles, previews }: {
  label: string; styles: StylePrompt[]; previews: Map<string, StylePreview>
}) {
  if (styles.length === 0) return null
  return (
    <>
      <div style={{
        margin: '4px 0 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '.03em',
      }}>
        {label} · {styles.length}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {styles.map(s => {
          const preview = previews.get(previewKeyFor(s))
          const thumb = preview?.imageUrls[0]
          return (
            <div key={s.slug} style={{ background: 'var(--surface)', borderRadius: 16, overflow: 'hidden' }}>
              {thumb ? (
                <img src={thumb} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{
                  width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: 8,
                }}>
                  No recent example
                </div>
              )}
              <div style={{ padding: '9px 11px' }}>
                <div style={{
                  fontSize: 13.5, fontWeight: 700, lineHeight: 1.25,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {cleanStyleTitle(s.title)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                  <span style={{
                    fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
                    color: 'var(--text2)', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 5,
                  }}>
                    {s.family === 'structure' ? 'Post' : 'Image'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{preview?.count ?? 0} used</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// "All styles ›" full grid, pushed from the Studio hub's horizontal gallery.
// Same family-qualified join the hub strips use — an unmatched style renders
// its designed "no recent example" tile rather than a wrong or missing one
// (D8): this is a live enumeration, not a hardcoded roster.
export function StylesGridScreen({ styles, previews, onBack }: {
  styles: StylePrompt[]; previews: Map<string, StylePreview>; onBack: () => void
}) {
  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">All styles</div></div>
      </div>
      <div className="rows" style={{ padding: 16 }}>
        {styles.length === 0 ? (
          <div className="empty">No active styles.</div>
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
      </div>
    </>
  )
}
