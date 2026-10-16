/* Hot now: the one pinned card at the top of Home (trends-proposal.md, 16 Oct 2026).
   A finished, QA-passed trend post with its story, a post-by deadline and three verbs.
   Approve = the lane's existing buffer verb (SwishDM: into Jonathan's review on his board,
   nothing posts until he approves). Edit = the client body save. Skip = archive + killed.
   Rare by design: the lane caps how many exist; this card shows the soonest deadline and
   says how many more wait behind it. The one push is rung by the database (db/289). */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronRight, Clock3, ExternalLink, Pencil } from 'lucide-react'
import { saveClientDraftBody, setBoardVisible } from '../../lib/content'
import { brokeAgo, fetchHotNow, skipHotNow, timeLeft, type HotNowCard } from '../../lib/hotNow'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDay, warsawDm, warsawHm } from '../ui/time'
import './hotnow.css'

const LANE_WHO: Record<HotNowCard['lane'], { lane: string; person: string }> = {
  swishdm: { lane: 'SwishDM', person: 'Jonathan' },
}

const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : null } catch { return null } }

export function useHotNow() {
  const [cards, setCards] = useState<HotNowCard[]>([])
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(() => { fetchHotNow().then(setCards).catch(() => { /* Home stays as it was */ }) }, [])
  useEffect(() => {
    load()
    const poll = window.setInterval(load, 120_000)
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('wb-rows-changed', onFocus)
    return () => { window.clearInterval(poll); window.clearInterval(tick); window.removeEventListener('focus', onFocus); window.removeEventListener('wb-rows-changed', onFocus) }
  }, [load])
  return { cards: cards.filter(c => Date.parse(c.post_by) > now), now, reload: load }
}

export function HotNow() {
  const { cards, now, reload } = useHotNow()
  const [i, setI] = useState(0)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = useDConfirm()
  const toast = useToast()
  const c = cards[Math.min(i, cards.length - 1)]
  useEffect(() => { setEditing(false); setExpanded(false) }, [c?.draft_id])
  if (!c) return null
  const who = LANE_WHO[c.lane]
  const more = cards.length - 1
  const broke = brokeAgo(c.source_published_at ?? c.detected_at, now)
  const src = host(c.primary_url)
  const dueDay = warsawDay(c.post_by) === warsawDay(now) ? 'Today' : warsawDay(c.post_by) === warsawDay(now + 86_400_000) ? 'Tomorrow' : warsawDm(c.post_by)

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true)
    try { await fn(); toast.show({ message: done }); setEditing(false); reload(); window.dispatchEvent(new Event('wb-rows-changed')) }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : 'That did not go through.', tone: 'failed' }); reload() }
    finally { setBusy(false) }
  }
  async function approve() {
    if (busy || !c) return
    const ok = await confirm({
      title: `Send this to ${who.person}’s review?`,
      message: `It goes into the review buffer on ${who.person}’s board. Nothing posts until he approves it there, and it is still due by ${warsawHm(c.post_by)} Warsaw.`,
      confirmText: `Send to ${who.person}`, verb: 'confirm',
    })
    if (!ok) return
    await run(() => setBoardVisible(c.draft_id, true, { client_id: c.lane, updated_at: c.draft_updated_at }), `In ${who.person}’s review.`)
  }
  async function skip() {
    if (busy || !c) return
    const ok = await confirm({ title: 'Skip this hot post?', message: 'The draft is archived and the story will not card again. Nothing is deleted.', confirmText: 'Skip', verb: 'confirm', danger: true })
    if (!ok) return
    await run(() => skipHotNow(c), 'Skipped.')
  }
  async function save() {
    if (busy || !c) return
    await run(() => saveClientDraftBody(c.draft_id, body, c.taxonomy, c.post_body, c.draft_updated_at), 'Saved. The deadline did not move.')
  }

  return (
    <section className="hn" aria-label="Hot now" aria-busy={busy} data-hot-now data-lane={c.lane}>
      <header className="hn-head">
        <h2 className="hn-flag"><span className="hn-signal" aria-hidden="true" />Hot now</h2>
        <span className="hn-lane">{who.lane}<span>for {who.person}</span></span>
        {more > 0 && <button type="button" className="hn-more" data-verb="hot-next" disabled={busy || editing} aria-label={`Next story, ${more} more. Story ${Math.min(i, cards.length - 1) + 1} of ${cards.length}`} onClick={() => setI((i + 1) % cards.length)}><span className="hn-count">{Math.min(i, cards.length - 1) + 1} / {cards.length}</span>Next story<ChevronRight size={16} aria-hidden="true" /></button>}
      </header>
      <div className="hn-body">
        <div className="hn-context">
          <div className="hn-due" data-hot-deadline>
            <span className="hn-due-label">Post by <span>Warsaw time</span></span>
            <time dateTime={c.post_by}>{dueDay} <b>{warsawHm(c.post_by)}</b></time>
            <span className="hn-clock"><Clock3 size={15} aria-hidden="true" />{timeLeft(c.post_by, now)}</span>
          </div>
          <div className="hn-story">
            <h3>{c.headline}</h3>
            <div className="hn-meta">
              {broke && <span>{broke}</span>}
              {c.primary_url && <a href={c.primary_url} target="_blank" rel="noreferrer">{src ?? 'Read source'}<ExternalLink size={13} aria-hidden="true" /></a>}
            </div>
          </div>
        </div>
        <div className="hn-draft">
          <div className="hn-draft-head"><span>{editing ? 'Editing post' : 'Post preview'}</span><span>For {who.person}</span></div>
          {editing
            ? <textarea className="hn-edit" value={body} onChange={e => setBody(e.target.value)} rows={10} aria-label="Edit the post" autoFocus />
            : <><div className={`hn-post${expanded ? ' hn-post-expanded' : ''}`} id="hot-now-post" data-hot-post role="region" aria-label="Full post preview" tabIndex={0}>{c.post_body}</div>
              <button type="button" className="hn-expand" aria-expanded={expanded} aria-controls="hot-now-post" onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse post' : 'Read full post'}<ChevronDown size={15} aria-hidden="true" /></button></>}
        </div>
      </div>
      <footer className="hn-footer">
        <p className="hn-review-note"><ArrowRight size={15} aria-hidden="true" />Approve sends this to {who.person}’s review.</p>
        <div className="hn-acts">
        {editing ? <>
          <button type="button" className="d-btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="d-btn d-btn-p" data-verb="hot-save" disabled={busy || body.trim() === '' || body === c.post_body} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </> : <>
          <button type="button" className="d-btn hn-skip" data-verb="hot-skip" disabled={busy} onClick={skip}>Skip</button>
          <button type="button" className="d-btn" data-verb="hot-edit" disabled={busy} onClick={() => { setBody(c.post_body); setEditing(true) }}><Pencil size={15} aria-hidden="true" />Edit</button>
          <button type="button" className="d-btn d-btn-p" data-verb="hot-approve" disabled={busy} onClick={approve}><Check size={16} aria-hidden="true" />{busy ? 'Working…' : 'Approve'}</button>
        </>}
        </div>
      </footer>
    </section>
  )
}
