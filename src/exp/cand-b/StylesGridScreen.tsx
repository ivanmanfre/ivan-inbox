import { normalizeStyleKey, type StylePreview, type StylePrompt } from '../../lib/styles'

// "All styles ›" full grid, pushed from the Studio hub's horizontal gallery.
// Same normalizeStyleKey join the gallery uses — an unmatched style renders
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {styles.map(s => {
              const preview = previews.get(normalizeStyleKey(s.slug))
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
                      fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{preview?.count ?? 0} used</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
