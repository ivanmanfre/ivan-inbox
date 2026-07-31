import { useEffect, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { useConfirm } from '../../components/ConfirmSheet'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useAgent } from '../../hooks/useAgent'
import { useContent } from '../../hooks/useContent'
import { useStyles } from '../../hooks/useStyles'
import { SettingsScreen } from '../../screens/SettingsScreen'
import { unsentAlerts, type AgentAlert } from '../../lib/agent'
import { type ContentBucketName, type ContentLane } from '../../lib/content'
import { normalizeStyleKey } from '../../lib/styles'
import { ContentCard } from './ContentCard'
import { ChatScreen } from './ChatScreen'
import { RemindersScreen } from './RemindersScreen'
import { SummariesScreen } from './SummariesScreen'
import { QueueScreen } from './QueueScreen'
import { StylesGridScreen } from './StylesGridScreen'
import { ago, truncate } from './format'

type Push =
  | { kind: 'chat' }
  | { kind: 'reminders' }
  | { kind: 'summaries' }
  | { kind: 'stylesGrid' }
  | { kind: 'queue'; lane: ContentLane; bucket: ContentBucketName }
  | { kind: 'settings' }

const LANES: { key: ContentLane; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

// Severity-only coloring for the bucket tiles: review is plain informational,
// error/stuck are the bad tier, approved-unscheduled is the "watch it" tier
// (it's the proven black-hole bucket — D5).
const TILE_COLOR: Record<string, string> = {
  review: 'var(--text)',
  error: '#FF453A',
  stuckScheduled: '#FF453A',
  approvedUnscheduled: '#FF9F0A',
}

function NavRow({ title, subtitle, onClick, right }: {
  title: string; subtitle?: string; onClick?: () => void; right?: React.ReactNode
}) {
  return (
    <div className={`grow ${onClick ? 'tap' : ''}`} onClick={onClick}>
      <div className="gtxt">
        <div className="gt">{title}</div>
        {subtitle && <div className="gs">{subtitle}</div>}
      </div>
      {right !== undefined
        ? right
        : onClick && <div style={{ color: 'var(--text3)', fontSize: 19, flex: 'none' }}>›</div>}
    </div>
  )
}

function AlertCard({ alert, onAck }: { alert: AgentAlert; onAck: (id: string) => void }) {
  return (
    <div style={{
      margin: '12px 22px 0', background: 'var(--surface)', borderRadius: 16, padding: '14px 16px',
      border: '1px solid rgba(255,159,10,.35)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', color: '#FF9F0A', textTransform: 'uppercase' }}>
          {alert.alert_type}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>{ago(alert.created_at)}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>{alert.title}</div>
      {alert.body && <div style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 4, lineHeight: 1.4 }}>{alert.body}</div>}
      <div className="btn s" style={{ marginTop: 12, cursor: 'pointer' }} onClick={() => onAck(alert.id)}>Dismiss</div>
    </div>
  )
}

function StudioSkeleton() {
  return (
    <div className="rows" aria-hidden>
      <div style={{ padding: '0 22px' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div className="sk sk-line" style={{ width: '30%', marginBottom: 10 }} />
            <div className="sk sk-line" style={{ width: '100%', height: 52, borderRadius: 14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Studio — the one-hub-tab-with-drill-ins IA. A single scrolling page: Agent
// strip → Content (bucketed, lane-scoped) → Styles + Resources → Settings.
// Every deeper view is a full-screen "push" kept as internal component state
// (no route/hash changes — 1d §8b item 14 only applies to surfaces reachable
// from a push notification, and this run adds none).
export function StudioScreen({ onPushChange }: { onPushChange?: (open: boolean) => void }) {
  const agent = useAgent()
  const styles = useStyles()
  const [lane, setLane] = useState<ContentLane>('ivan')
  const content = useContent(lane)
  const confirm = useConfirm()
  const [push, setPush] = useState<Push | null>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => {
    agent.refresh(); content.refresh(); styles.refresh()
  })

  useEffect(() => { onPushChange?.(push !== null) }, [push, onPushChange])

  async function ackAlert(id: string) {
    const ok = await confirm({
      title: 'Acknowledge this alert?',
      message: 'Marks it seen — it will not be raised again.',
      confirmText: 'Acknowledge',
    })
    if (!ok) return
    await agent.acknowledgeAlert(id)
  }

  async function completeReminder(id: number) {
    await agent.completeReminder(id)
  }

  async function sendChat(text: string) {
    await agent.send(text)
  }

  // ---- pushed screens ----

  if (push?.kind === 'chat') {
    return <ChatScreen messages={agent.messages} onSend={sendChat} onBack={() => setPush(null)} />
  }
  if (push?.kind === 'reminders') {
    return <RemindersScreen reminders={agent.reminders} onComplete={completeReminder} onBack={() => setPush(null)} />
  }
  if (push?.kind === 'summaries') {
    return <SummariesScreen summaries={agent.summaries} onBack={() => setPush(null)} />
  }
  if (push?.kind === 'stylesGrid') {
    return <StylesGridScreen styles={styles.styles} previews={styles.previews} onBack={() => setPush(null)} />
  }
  if (push?.kind === 'queue') {
    return (
      <QueueScreen
        lane={push.lane}
        bucket={push.bucket}
        buckets={content.buckets}
        laneTotal={content.laneTotal}
        loading={content.loading}
        error={content.error}
        refresh={content.refresh}
        onApproved={content.refresh}
        onBack={() => setPush(null)}
      />
    )
  }
  if (push?.kind === 'settings') {
    return (
      <>
        <div className="t-nav" style={{ justifyContent: 'flex-start' }}>
          <span className="back" onClick={() => setPush(null)}>‹</span>
        </div>
        <SettingsScreen />
      </>
    )
  }

  // ---- hub ----

  const firstLoad = agent.loading && content.loading && styles.loading
    && agent.messages.length === 0 && agent.alerts.length === 0
    && content.drafts.length === 0 && styles.styles.length === 0

  if (firstLoad) {
    return (
      <>
        <div className="nav">
          <div className="row-top"><h2>Studio</h2><div className="avatar-me">IM</div></div>
        </div>
        <StudioSkeleton />
      </>
    )
  }

  const unsent = unsentAlerts(agent.alerts)
  const lastMsg = agent.messages.at(-1)
  const chatSubtitle = lastMsg
    ? `${lastMsg.role === 'user' ? 'You: ' : ''}${truncate(lastMsg.content, 56)} · ${ago(lastMsg.created_at)}`
    : 'No messages yet'

  const tiles: { key: ContentBucketName; label: string }[] = [
    { key: 'review', label: 'Needs review' },
    { key: 'error', label: 'Errors' },
    { key: 'stuckScheduled', label: 'Stuck' },
    { key: 'approvedUnscheduled', label: 'Approved-unscheduled' },
  ]

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Studio</h2><div className="avatar-me">IM</div></div>
      </div>
      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />

        {unsent.map(a => <AlertCard key={a.id} alert={a} onAck={ackAlert} />)}

        {/* ---- Agent strip ---- */}
        <div className="grouphdr">Agent</div>
        {agent.error && <div className="td-banner" style={{ margin: '0 16px 10px' }}>{agent.error}</div>}
        <div className="group">
          <NavRow title="Chat with n8nClaw ›" subtitle={chatSubtitle} onClick={() => setPush({ kind: 'chat' })} />
          <NavRow
            title="Reminders"
            subtitle={`${agent.reminders.length} pending`}
            onClick={() => setPush({ kind: 'reminders' })}
          />
          <NavRow
            title="Daily summary ›"
            subtitle={agent.summaries[0] ? `Latest ${agent.summaries[0].date}` : 'No summaries yet'}
            onClick={() => setPush({ kind: 'summaries' })}
          />
        </div>

        {/* ---- Content ---- */}
        <div className="grouphdr">Content</div>
        <div className="chips" style={{ margin: '0 22px 12px' }}>
          {LANES.map(l => (
            <span key={l.key} className={`chip ${lane === l.key ? 'on' : ''}`} onClick={() => setLane(l.key)}>
              {l.label}
            </span>
          ))}
        </div>
        {content.error && <div className="td-banner" style={{ margin: '0 22px 10px' }}>{content.error}</div>}
        <div className="ov-kpis" style={{ margin: '0 22px 6px' }}>
          {tiles.map(t => (
            <div
              key={t.key}
              className="ov-kpi"
              style={{ cursor: 'pointer' }}
              onClick={() => setPush({ kind: 'queue', lane, bucket: t.key })}
            >
              <div className="ov-kpi-top"><span className="ov-kpi-nm">{t.label}</span></div>
              <div className="ov-kpi-big" style={{ color: TILE_COLOR[t.key] }}>{content.buckets[t.key].length}</div>
            </div>
          ))}
        </div>
        {content.buckets.review.length === 0 ? (
          <div className="empty" style={{ padding: '18px 22px' }}>
            {lane === 'ivan' ? 'Nothing waiting on your review.' : 'Nothing in review for Rise right now.'}
          </div>
        ) : (
          content.buckets.review.slice(0, 3).map(d => (
            <ContentCard key={d.id} draft={d} lane={lane} onChanged={content.refresh} />
          ))
        )}

        {/* ---- Styles ---- */}
        <div className="grouphdr">Styles</div>
        <div style={{ margin: '0 22px 8px' }}>
          <div className="grow tap" onClick={() => setPush({ kind: 'stylesGrid' })} style={{ padding: '0 0 10px' }}>
            <div className="gtxt"><div className="gt">All styles ›</div></div>
          </div>
        </div>
        {styles.error && <div className="td-banner" style={{ margin: '0 22px 10px' }}>{styles.error}</div>}
        {styles.styles.length === 0 ? (
          <div className="empty" style={{ padding: '0 22px 18px' }}>No active styles.</div>
        ) : (
          <div style={{
            display: 'flex', gap: 12, overflowX: 'auto', padding: '2px 22px 6px',
            scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
          }}>
            {styles.styles.map(s => {
              const preview = styles.previews.get(normalizeStyleKey(s.slug))
              const thumb = preview?.imageUrls[0]
              return (
                <div
                  key={s.slug}
                  style={{
                    flex: '0 0 128px', scrollSnapAlign: 'start', background: 'var(--surface)',
                    borderRadius: 16, overflow: 'hidden',
                  }}
                >
                  {thumb ? (
                    <img src={thumb} style={{ width: 128, height: 128, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{
                      width: 128, height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text3)', fontSize: 12, textAlign: 'center', padding: 8,
                    }}>
                      No recent example
                    </div>
                  )}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{preview?.count ?? 0} used</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {styles.resources.length > 0 && (
          <>
            <div className="grouphdr">Resources</div>
            <div style={{ padding: '0 16px' }}>
              {styles.resources.map(r => (
                <a
                  key={r.id} href={r.resource_url} target="_blank" rel="noreferrer"
                  className="log-r" style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  {r.cover_url ? (
                    <img src={r.cover_url} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--surface2)', flex: 'none' }} />
                  )}
                  <div className="log-mid">
                    <div className="log-top">
                      <span className="log-nm">{r.topic ?? 'Untitled'}</span>
                      {r.format && <span className="client">{r.format}</span>}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text3)', fontSize: 15, flex: 'none' }}>↗</span>
                </a>
              ))}
            </div>
          </>
        )}

        {/* ---- Settings (last row, per this IA — no longer a tab) ---- */}
        <div className="grouphdr">More</div>
        <div className="group">
          <NavRow title="Settings ›" onClick={() => setPush({ kind: 'settings' })} />
        </div>
      </div>
    </>
  )
}
