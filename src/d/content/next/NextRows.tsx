import { useEffect, useRef, useState } from 'react'
import type { ContentDraft } from '../../../lib/content'
import { keepNext } from '../../../lib/contentNext'
import { DIcon } from '../../ui/icons'
import { useToast } from '../../ui/toast'
import type { Lane } from '../model'
import { LinkedInCard } from '../v2/LinkedInCard'
import { GridPost } from '../v2/ReviewDesk'
import { loadFiles, releaseFiles, type FilesRead } from './hash'
import { keepAfterFix, keepShown } from './keepFlow'
import { hookOf, keepKeyOf, nextRows, slotDay, slotTime, statusOf, type NextRow } from './model'
import { refreshNextPosts, useNextPosts } from './store'
import './next.css'

// THE POST GOING OUT NEXT, AS ROWS OF IVAN'S REVIEW LIST (Ivan 2026-11-13: "the Review screen shows the post going out
// next, with Keep / Fix / Pull"; a lone card was rejected, so these are rows over his list). The first row is the
// soonest upcoming post (Next); under it, every later post that will not go out as it stands (Held). Each shows the
// queued text and its attachment, one status line, and its keys in the row's head, above the post.
// The Next row reads whole, like today's pick. A Held row folds its text at three lines ("…see more"), so the attachment
// he has to look at sits on the same screen as Keep, and three open posts do not push his own list a long way down.
//   Keep: his approval of exactly what the row shows (text hash + the attachment bytes on screen). Autopilot posts only.
//   Fix:  the Review rows' own in-place edit and save path; after a save on an autopilot post, Keep is tapped for him.
//   Pull: not here yet. The app's one unschedule verb (the Calendar's Remove date) leaves the queued copy in place, so
//         it does not take a scheduled post of his off the publish path. It waits for a database verb that does.

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))

export function NextRows({ rows, onOpen, onEdit, onChanged }: {
  /** Every draft the page holds: the row's draft is found here for Fix (its body, taxonomy and updated_at). */
  rows: readonly ContentDraft[]
  onOpen: (id: string, lane: Lane) => void
  /** The post's own editor, when the draft is not among the page's rows. */
  onEdit: (id: string, lane: Lane) => void
  onChanged: () => void
}) {
  const snap = useNextPosts()
  const list = nextRows(snap.posts)
  if (list.length === 0) return null
  return (
    <div className="cv2-list cv2-next" role="list" aria-label="Going out next" data-next-list>
      {list.map((row, i) => (
        <Row key={row.post.queue_id} row={row} i={i} draft={rows.find(r => r.id === row.post.draft_id && r.client_id == null) ?? null}
          onOpen={() => onOpen(row.post.draft_id, 'ivan')} onEdit={() => onEdit(row.post.draft_id, 'ivan')} onChanged={onChanged} />
      ))}
    </div>
  )
}

function Row({ row, i, draft, onOpen, onEdit, onChanged }: {
  row: NextRow; i: number; draft: ContentDraft | null
  onOpen: () => void; onEdit: () => void; onChanged: () => void
}) {
  const { post, tag } = row
  const toast = useToast()
  const [more, setMore] = useState(true)
  const [files, setFiles] = useState<FilesRead | null>(null)
  // A refused Keep that said the row changed: the attachment is fetched again past the browser's cached copy.
  const [fresh, setFresh] = useState(0)
  const [edit, setEdit] = useState<string | null>(null)
  const editBase = useRef('')
  // The text he just saved, shown while the queued copy catches up with it.
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState<'keep' | 'fix' | null>(null)
  // The last thing that left this row waiting on him, in the database's own words.
  const [said, setSaid] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // The attachments, fetched once: these bytes are what the row shows and what Keep hashes.
  const urlsKey = post.urls.join('\n')
  useEffect(() => {
    if (!post.urls.length) { setFiles({ status: 'ok', files: [] }); return }
    const ac = new AbortController()
    let mine: FilesRead | null = null
    let dead = false
    setFiles(null)
    loadFiles(post.urls, { fresh: fresh > 0, signal: ac.signal }).then(
      r => { if (dead) { releaseFiles(r); return } mine = r; setFiles(r) },
      () => { if (!dead) setFiles({ status: 'failed' }) })
    return () => { dead = true; ac.abort(); releaseFiles(mine) }
  }, [urlsKey, fresh]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (post.in_sync) setSaved(null) }, [post.in_sync, post.post_text])
  useEffect(() => { setSaid(null) }, [post.state, post.kept, post.post_text, urlsKey])

  const shown = !post.in_sync && saved !== null ? saved : post.post_text
  const status = statusOf(post)
  const keep = keepKeyOf(post, files)
  const editing = edit !== null
  const unsaved = editing && edit !== editBase.current
  const title = hookOf(shown) || 'No post text yet.'
  const note = said ?? (keep.show ? keep.note : null)

  const doKeep = async () => {
    if (busy || editing || !keep.show || !keep.enabled) return
    setBusy('keep'); setSaid(null)
    const out = await keepShown(post, shown, files, { keep: keepNext })
    if (out.code === 'next_changed') setFresh(n => n + 1)
    await refreshNextPosts()
    if (!alive.current) return
    setBusy(null)
    if (out.ok) toast.show({ id: `next-${post.queue_id}`, message: out.message })
    else setSaid(out.message)
  }
  const startFix = () => {
    if (busy) return
    // The draft is not among the page's rows (a cut read): the post's own editor opens it.
    if (!draft) { onEdit(); return }
    editBase.current = draft.post_body ?? ''
    setEdit(draft.post_body ?? ''); setMore(true)
  }
  const onSaved = (text: string) => {
    setSaved(text); setSaid(null); setBusy('fix')
    void keepAfterFix(post, text, files, { read: refreshNextPosts, keep: keepNext, wait }).then(out => {
      // The editor's own "Saved." receipt becomes the whole answer (same toast id).
      toast.show({ id: `grid-save-${post.draft_id}`, message: out.message, ...(out.ok ? {} : { tone: 'failed' as const }) })
      if (!alive.current) return
      if (out.code === 'next_changed') setFresh(n => n + 1)
      setBusy(null)
      if (!out.ok) setSaid(out.message)
    })
  }

  // In posting order (media_urls); a file that is hashed and not posted on its own (a poster) follows.
  const got = files?.status === 'ok' ? files.files : null
  const ok = got ? [...post.media_urls.flatMap(u => got.filter(f => f.url === u)), ...got.filter(f => !post.media_urls.includes(f.url))] : null
  const video = ok?.find(f => f.kind === 'video')?.blobUrl ?? (!ok && files ? post.media_urls.find(u => /\.(mp4|mov|webm)(\?|#|$)/i.test(u)) : null) ?? null
  // The bytes this row fetched; if they could not be fetched, the address itself, so the post is still readable (Keep stays off).
  const images = ok ? ok.filter(f => f.kind === 'image').map(f => f.blobUrl) : files ? post.media_urls.filter(u => !/\.(mp4|mov|webm|pdf)(\?|#|$)/i.test(u)) : []
  const docs = ok ? ok.filter(f => f.kind === 'pdf' || f.kind === 'other') : []

  return (
    <article className={`cv2-row cv2-next-row${more ? ' cv2-row-x' : ''}`} role="listitem" data-next-id={post.queue_id} data-next-tag={tag} data-next-state={post.state}
      data-unsaved={unsaved || undefined} aria-label={`${tag}: ${title}`} style={{ '--i': Math.min(i, 10) } as React.CSSProperties}>
      <div className="cv2-row-main">
        <span className="cv2-srctag cv2-next-tag" data-tone={status.tone}>{tag}</span>
        <div className="cv2-row-text">
          <b className="cv2-row-t">{title}</b>
          <p className="cv2-next-status" data-tone={status.tone} data-next-status>
            <span>{status.text}</span>{status.reason && <> <span className="cv2-next-why">{status.reason}</span></>}
          </p>
          {note && <p className="cv2-next-note" role={said ? 'alert' : 'status'} data-next-note>{note}</p>}
        </div>
        <div className="cv2-row-meta">
          <span className="cv2-row-age cv2-next-when" title="Warsaw time">{slotDay(post.slot_at)} · {slotTime(post.slot_at)}</span>
        </div>
        <div className="cv2-row-keys">
          {keep.show && (
            <button type="button" className={`cv2-k ${keep.primary ? 'cv2-k-p' : 'cv2-k-q'}`} data-verb="next-keep" data-key-main={keep.primary || undefined}
              disabled={!keep.enabled || !!busy || editing} title={editing ? 'Save or cancel your edit first' : keep.note ?? 'It goes out as you see it here.'} onClick={() => void doKeep()}>
              {busy === 'keep' ? 'Keeping…' : 'Keep'}
            </button>
          )}
          <button type="button" className="cv2-k cv2-k-q" data-verb="next-fix" disabled={!!busy || editing} onClick={startFix}>{busy === 'fix' ? 'Saving…' : 'Fix'}</button>
          <button type="button" className="cv2-chev" aria-expanded={more} aria-label={more ? 'Hide the post' : 'Show the post'} data-verb="next-preview" onClick={() => setMore(!more)}>
            <DIcon name="chevDown" />
          </button>
        </div>
      </div>
      {more && (
        <div className="cv2-row-more">
          <div className="cv2-row-post">
            <div className="cv2-today-post">
              {editing && draft
                ? <GridPost c={{ r: draft, lane: 'ivan', title }} body={shown} text={edit} setText={setEdit} base={editBase.current} canEdit onStart={startFix} onSaved={onSaved} onChanged={onChanged} />
                : <LinkedInCard lane="ivan" body={shown.trim() || title} images={images} type={video ? 'video' : 'image'} videoUrl={video} bare open={tag === 'Next' ? true : undefined} />}
              {docs.map(f => (
                <a key={f.url} className="cv2-k cv2-next-doc" href={f.blobUrl} target="_blank" rel="noreferrer" data-verb="next-open-file">{f.kind === 'pdf' ? 'Open the PDF' : 'Open the attachment'}</a>
              ))}
              {post.urls.length > 0 && !files && <p className="cv2-next-reading" role="status">Reading the attachment…</p>}
            </div>
          </div>
          <div className="cv2-row-side">
            <button type="button" className="cv2-k" data-verb="next-open" onClick={onOpen}>Open the post</button>
          </div>
        </div>
      )}
    </article>
  )
}
