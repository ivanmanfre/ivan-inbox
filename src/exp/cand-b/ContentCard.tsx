import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { approveDraft, skipDraft, type ContentDraft, type ContentLane } from '../../lib/content'
import { ago } from './format'

// Shared "needs review" card — used both by the Studio hub's inline top-3 and
// by QueueScreen's full review bucket. Ivan lane gets Approve/Skip behind a
// confirm sheet (D6/D11); Rise stays read-only ambient visibility (D7) — no
// button, just the card.
export function ContentCard({ draft, lane, onChanged }: {
  draft: ContentDraft; lane: ContentLane; onChanged: () => void
}) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function approve() {
    const ok = await confirm({
      title: 'Approve this post?',
      // Exact copy from the audit (D6/D11): approving is a status write only.
      message: 'Marks approved. Nothing publishes — scheduling stays on the board.',
      confirmText: 'Approve',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await approveDraft(draft.id); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not approve') }
    finally { setBusy(false) }
  }

  async function skip() {
    const ok = await confirm({
      title: 'Skip this post?',
      message: 'Marks it disqualified — it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await skipDraft(draft.id); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not skip') }
    finally { setBusy(false) }
  }

  const thumb = draft.image_urls?.[0]

  return (
    <div className="qc" style={{ margin: '10px 22px 0' }}>
      <div className="h">
        {thumb ? (
          <img src={thumb} alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
        ) : (
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: 'var(--surface2)', flex: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--text3)', textAlign: 'center',
          }}>
            No image
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm">{draft.title || draft.topic || 'Untitled'}</div>
          <div className="sub">updated {ago(draft.updated_at)} ago</div>
        </div>
      </div>
      {draft.post_body && <div className="bd" style={{ cursor: 'default' }}>{draft.post_body.slice(0, 220)}</div>}
      {error && <div className="err">{error}</div>}
      {lane === 'ivan' ? (
        <div className="ac">
          <div className="btn s" onClick={busy ? undefined : skip}>Skip</div>
          <div className="btn p" onClick={busy ? undefined : approve}>{busy ? 'Working…' : 'Approve'}</div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
          Read-only — Rise decisions stay on the client board.
        </div>
      )}
    </div>
  )
}
