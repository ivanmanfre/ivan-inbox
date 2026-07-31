import type { AgentSummary } from '../../lib/agent'

// Pushed from the Studio hub's "Daily summary ›" row. Read-only list, newest
// first (fetchDailySummaries already orders that way).
export function SummariesScreen({ summaries, onBack }: {
  summaries: AgentSummary[]; onBack: () => void
}) {
  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">Daily summaries</div></div>
      </div>
      <div className="rows" style={{ padding: '12px 16px' }}>
        {summaries.length === 0 ? (
          <div className="empty">No summaries yet.</div>
        ) : summaries.map(s => (
          <div key={s.id} className="ops-card" style={{ margin: '0 0 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {s.date}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.5, marginTop: 8, color: 'var(--text)' }}>{s.summary}</div>
            {s.topics.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {s.topics.map(t => (
                  <span key={t} className="chip" style={{ fontSize: 11, padding: '4px 10px' }}>{t}</span>
                ))}
              </div>
            )}
            {s.action_items.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                  Action items
                </div>
                {s.action_items.map((a, i) => (
                  <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>· {a}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
