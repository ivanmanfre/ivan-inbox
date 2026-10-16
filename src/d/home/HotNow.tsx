/* Hot now: the one pinned card at the top of Home (trends-proposal.md, 16 Oct 2026).
   A finished, QA-passed trend post with its story, a post-by deadline and three verbs.
   Approve = the lane's existing buffer verb (SwishDM: into Jonathan's review on his board,
   nothing posts until he approves). Edit = the client body save. Skip = archive + killed.
   Rare by design: the lane caps how many exist; this card shows the soonest deadline and
   says how many more wait behind it. The one push is rung by the database (db/289). */
import { useCallback, useEffect, useState } from 'react'
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
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const confirm = useDConfirm()
  const toast = useToast()
  const c = cards[Math.min(i, cards.length - 1)]
  useEffect(() => { setEditing(false) }, [c?.draft_id])
  if (!c) return null
  const who = LANE_WHO[c.lane]
  const more = cards.length - 1
  const broke = brokeAgo(c.source_published_at ?? c.detected_at, now)
  const src = host(c.primary_url)

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
    <section className="hn" aria-label="Hot now" data-hot-now data-lane={c.lane}>
      <header className="hn-head">
        <span className="hn-flag">Hot now</span>
        <span className="hn-lane">{who.lane} · for {who.person}</span>
        {more > 0 && <button type="button" className="hn-more" data-verb="hot-next" onClick={() => setI((i + 1) % cards.length)}>{more} more</button>}
      </header>
      <div className="hn-due" data-hot-deadline>
        <b>Post by {warsawDay(c.post_by) === warsawDay(now) ? '' : warsawDay(c.post_by) === warsawDay(now + 86_400_000) ? 'tomorrow ' : `${warsawDm(c.post_by)} `}{warsawHm(c.post_by)}</b><span>{timeLeft(c.post_by, now)}</span>
      </div>
      <div className="hn-story">
        <strong>{c.headline}</strong>
        <span className="hn-meta">
          {[broke, src].filter(Boolean).join(' · ')}
          {c.primary_url && <> · <a href={c.primary_url} target="_blank" rel="noreferrer">source</a></>}
        </span>
      </div>
      {editing
        ? <textarea className="hn-edit" value={body} onChange={e => setBody(e.target.value)} rows={10} aria-label="Edit the post" />
        : <div className="hn-post" data-hot-post>{c.post_body}</div>}
      <div className="hn-acts">
        {editing ? <>
          <button type="button" className="d-btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="d-btn d-btn-p" data-verb="hot-save" disabled={busy || body.trim() === '' || body === c.post_body} onClick={save}>Save</button>
        </> : <>
          <button type="button" className="d-btn" data-verb="hot-skip" disabled={busy} onClick={skip}>Skip</button>
          <button type="button" className="d-btn" data-verb="hot-edit" disabled={busy} onClick={() => { setBody(c.post_body); setEditing(true) }}>Edit</button>
          <button type="button" className="d-btn d-btn-p" data-verb="hot-approve" disabled={busy} onClick={approve}>Approve</button>
        </>}
      </div>
    </section>
  )
}
