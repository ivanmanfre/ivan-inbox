// src/orbit/PostPanel.tsx — the post sheet. Engagers list + one bulk action:
// queue every unreached engager at ICP >= 7, confirmed with the exact list of
// people first, then queueInvite() per row (same write-guarded call
// PersonPanel uses — nothing new is invented here).

import { useCallback, useMemo, useState } from 'react'
import { Chip, IconButton, Sheet } from '../ds'
import { relAge } from '../wb/kit'
import { queueInvite, queueInviteEffect } from './actions'
import { STAGE_LABEL, type OrbitContentEdge, type OrbitPerson, type OrbitPost, type OrbitTenant } from './types'

export interface PostPanelProps {
  post: OrbitPost | null
  tenant: OrbitTenant
  people: OrbitPerson[]
  contentEdges: OrbitContentEdge[]
  onClose: () => void
  onOpenPerson: (id: string) => void
}

export function PostPanel({ post, tenant, people, contentEdges, onClose, onOpenPerson }: PostPanelProps) {
  const open = post != null

  const engagers = useMemo(() => {
    if (!post) return []
    const ids = new Set<string>()
    for (const e of contentEdges) if (e.t === post.id) ids.add(e.s)
    const byId = new Map(people.map(p => [p.id, p]))
    return [...ids]
      .map(id => byId.get(id))
      .filter((p): p is OrbitPerson => !!p)
      .sort((a, b) => (b.st - a.st) || a.n.localeCompare(b.n))
  }, [post, contentEdges, people])

  // "Unreached, ICP >= 7" — the bulk action's exact predicate, restated in
  // the effect copy so a tap never surprises anyone about who is included.
  const queueCandidates = useMemo(
    () => engagers.filter(p => !p.reached && (p.i ?? -1) >= 7 && p.pid),
    [engagers],
  )
  // Clears ICP but has no prospect row yet — queueInvite() only ever flips an
  // EXISTING row, so these are named rather than silently dropped from the count.
  const excludedNoProspect = useMemo(
    () => engagers.filter(p => !p.reached && (p.i ?? -1) >= 7 && !p.pid),
    [engagers],
  )

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  const runBulkQueue = useCallback(async () => {
    setRunning(true)
    let queued = 0, blocked = 0, failed = 0
    for (const p of queueCandidates) {
      if (!p.pid) continue
      try {
        const r = await queueInvite(tenant, p.pid)
        if (r.ok) queued++
        else blocked++
      } catch {
        failed++
      }
    }
    setRunning(false)
    setConfirmOpen(false)
    setSummary(`${queued} queued, ${blocked} blocked, ${failed} failed.`)
  }, [queueCandidates, tenant])

  return (
    <>
      <div className="a-orbit-scrim" data-open={open ? '' : undefined} onClick={onClose} />
      <div className="a-orbit-panel" data-open={open ? '' : undefined} role="dialog" aria-label={post ? 'Post' : undefined}>
        {post ? (
          <>
            <div className="a-orbit-panel-head">
              <div className="a-orbit-panel-head-t">
                <div className="a-orbit-panel-name">{post.txt || 'Untitled post'}</div>
                <div className="a-orbit-panel-sub">
                  {relAge(post.d)} · {post.li} likes · {post.cm} comments · {post.im} impressions
                </div>
              </div>
              <IconButton icon="close" label="Close" onClick={onClose} />
            </div>

            <div className="a-orbit-panel-body">
              {post.url ? <Chip tone="neutral" href={post.url} target="_blank">Open on LinkedIn</Chip> : null}

              <section className="a-orbit-action">
                <div className="a-orbit-action-effect">
                  Queue every unreached engager at ICP ≥ 7 — {queueCandidates.length} row{queueCandidates.length === 1 ? '' : 's'}. {queueInviteEffect(tenant)}
                  {excludedNoProspect.length > 0
                    ? ` ${excludedNoProspect.length} more clear ICP but have no prospect row yet — open their panel and use Add to lane first.`
                    : ''}
                </div>
                <Chip tone="accent" onClick={queueCandidates.length > 0 ? () => setConfirmOpen(true) : undefined}>
                  {queueCandidates.length > 0 ? `Queue ${queueCandidates.length} unreached ≥ ICP 7` : 'Nothing to queue'}
                </Chip>
                {summary ? <div className="a-orbit-action-note">{summary}</div> : null}
              </section>

              <section>
                <div className="a-orbit-panel-sub" style={{ marginBottom: 8 }}>Engagers ({engagers.length})</div>
                {engagers.length === 0 ? <div className="a-orbit-event-text">No one engaged this post in the window.</div> : null}
                {engagers.map(p => (
                  <div
                    key={p.id}
                    className="a-orbit-engager"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenPerson(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPerson(p.id) } }}
                  >
                    <div className="a-orbit-engager-main">
                      <div className="a-orbit-engager-name">{p.n}</div>
                      <div className="a-orbit-engager-meta">{p.c || '—'} · ICP {p.i ?? '—'}</div>
                    </div>
                    <Chip tone={p.st === 4 ? 'accent' : 'neutral'}>{STAGE_LABEL[p.st]}</Chip>
                  </div>
                ))}
              </section>
            </div>
          </>
        ) : null}
      </div>

      {/* The confirm step: the EXACT people the bulk action will touch, named
          before the tap — never just a count. */}
      <Sheet
        open={confirmOpen}
        onClose={() => { if (!running) setConfirmOpen(false) }}
        title={`Queue ${queueCandidates.length} engager${queueCandidates.length === 1 ? '' : 's'}`}
        sub={queueInviteEffect(tenant)}
        className="a-orbit-confirm"
        foot={<Chip tone="accent" onClick={running ? undefined : runBulkQueue}>{running ? 'Queuing…' : 'Confirm'}</Chip>}
      >
        <div className="a-orbit-events">
          {queueCandidates.map(p => (
            <div key={p.id} className="a-orbit-event">
              <span className="a-orbit-event-mark" />
              <div className="a-orbit-event-body">
                <span className="a-orbit-event-kind">{p.n}</span>
                <span className="a-orbit-event-date">ICP {p.i}</span>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  )
}
