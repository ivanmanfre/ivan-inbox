import { useEffect, useRef, useState } from 'react'
import {
  BOARD_SLUG, listClientPhotos, listStills, normalizeImageUrls, searchStills, setDraftMedia,
  uploadDraftPicture, type ContentDraftDetail, type Picture, type StillFolder,
} from '../../lib/content'
import { Btn } from '../ui/Key'
import { useToast } from '../ui/toast'
import { OWNER, POSS, type Lane } from './model'
import './picture.css'

// THE PICTURE ROW, under the post, on every lane (Ivan 29 Sep: "can't do basic
// shit like change the pictures from there"). One write for all three lanes:
// setDraftMedia -> operator_set_draft_media (db/230). Client rows go through
// the board's own media function, so the client's board shows the new picture
// at once and the RISE assigner reads it as the real pick. Ivan's removals stamp
// taxonomy.no_photo, so the selfie job leaves the post bare.
//
// Optimistic: the preview shows the new picture the moment it is picked
// (`onShow`), and goes back to the stored one if the database refuses, with a
// failed toast. Every success toast carries Undo (re-pins what was there).
//
// The caller mounts this only where pictureEditable() says the RPC will accept
// the write (text / single_image, not published, the lane's statuses).

// The storage folders in words (Ivan 2026-10-08: "the tags are weird"). Both selfie pools are one choice.
type FolderKey = 'all' | 'selfies' | 'places' | 'yours'
const FOLDER_KEYS: readonly FolderKey[] = ['all', 'selfies', 'places', 'yours']
const FOLDER_LABEL: Record<FolderKey, string> = { all: 'Library', selfies: 'Selfies', places: 'Places', yours: 'Your photos' }
const FOLDER_GROUPS: Record<FolderKey, StillFolder[]> = { all: ['library'], selfies: ['selfie-pool-a', 'selfie-pool-b'], places: ['places-2026-09'], yours: ['ivan-photos'] }

const nameOf = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? url)

function whereFrom(url: string): string {
  if (/\/client-photos\/[^/]+\/onepost\//.test(url) || /\/post-stills\/onepost\//.test(url)) return 'Uploaded for this post'
  const m = url.match(/\/(?:post-stills|client-photos)\/([^/]+)\//)
  if (m) return /^selfie-pool/.test(m[1]) ? 'From your selfies' : `From ${m[1].replace(/[-_]+/g, ' ')}`
  return 'Pinned image'
}

export function PictureRow({ d, lane, onShow, onDone, disabled }: {
  /** The fields this row reads (the open post's detail, or a review card's row). */
  d: Pick<ContentDraftDetail, 'id' | 'image_urls' | 'taxonomy' | 'status' | 'type'>
  lane: Lane
  /** Show this picture list in the preview now (optimistic), or `undefined` to show what is stored. */
  onShow: (urls: string[] | undefined) => void
  onDone: () => void
  disabled?: boolean
}) {
  const toast = useToast()
  const stored = normalizeImageUrls(d.image_urls)[0] ?? null
  const [shown, setShown] = useState<string | null>(stored)
  const [open, setOpen] = useState(false)
  const [folder, setFolder] = useState<FolderKey>('all')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [pics, setPics] = useState<Picture[] | null>(null)
  // The picture being looked at full size before it is used (Ivan 2026-10-08: "i cant even open them to see").
  const [look, setLook] = useState<number | null>(null)
  const [libErr, setLibErr] = useState('')
  const [busy, setBusy] = useState<'' | 'pick' | 'upload' | 'remove'>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const slug = lane === 'ivan' ? null : BOARD_SLUG[lane]
  const noPhoto = lane === 'ivan' && !stored && (d.taxonomy as { no_photo?: unknown } | null)?.no_photo === true

  // A refetch re-seats the row on what the database holds.
  useEffect(() => { setShown(stored) }, [stored])

  // Load the library on open (and per folder / search), never on mount.
  useEffect(() => {
    if (!open) return
    let live = true
    setPics(null); setLibErr(''); setLook(null)
    const read = slug ? listClientPhotos(slug) : query ? searchStills(query)
      : Promise.all(FOLDER_GROUPS[folder].map(listStills)).then(all => all.flat())
    read.then(p => { if (live) setPics(p) })
      .catch(e => { if (live) setLibErr(e instanceof Error ? e.message : 'Could not read the library.') })
    return () => { live = false }
  }, [open, folder, query, slug])

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const write = async (url: string | null, kind: 'pick' | 'upload' | 'remove', prev = shown) => {
    setBusy(kind); setShown(url); onShow(url ? [url] : [])
    try {
      await setDraftMedia(d.id, url)
      setOpen(false)
      toast.show({
        message: url ? 'Picture changed.' : 'Picture removed.',
        sub: lane === 'ivan'
          ? (url ? undefined : 'The selfie job leaves this post bare now.')
          : `${POSS[lane]} board shows it now.`,
        action: { label: 'Undo', verb: 'picture-undo', run: () => { void write(prev, prev ? 'pick' : 'remove', url) } },
      })
      onDone()
    } catch (e) {
      setShown(prev); onShow(undefined)
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'The picture did not change.', sub: 'The post keeps the picture it had.' })
    } finally {
      setBusy('')
    }
  }

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy('upload')
    let url: string
    try {
      url = await uploadDraftPicture(lane, d.id, file)
    } catch (err) {
      setBusy('')
      toast.show({ tone: 'failed', message: err instanceof Error ? err.message : 'The upload did not go through.', sub: 'The post keeps the picture it had.' })
      return
    }
    await write(url, 'upload')
  }

  const off = disabled || !!busy
  return (
    <section className="cn-pic2" aria-label="Picture" data-busy={busy || undefined}>
      <div className="cn-pic2-h">
        <span className="cn-pic2-th">
          {shown ? <img src={shown} alt="" /> : <span aria-hidden="true">none</span>}
        </span>
        <div className="cn-pic2-m">
          <small className="cn-cap">Picture</small>
          <b title={shown ? nameOf(shown) : undefined}>{busy === 'upload' ? 'Uploading…' : shown ? whereFrom(shown) : 'No picture'}</b>
          <span>{shown ? (d.type === 'carousel' ? 'Carousel' : 'Single image')
            : noPhoto ? 'Removed on purpose: the selfie job leaves it bare.'
            : lane === 'ivan' && d.status === 'review' && d.type === 'text' ? 'Text only. The selfie job adds one within 10 min unless you pick one or remove it.'
            : lane === 'ivan' ? 'Text only.'
            : `Text only on ${POSS[lane]} board.`}</span>
        </div>
      </div>
      <div className="cn-pic2-acts">
        <Btn verb="picture-change" aria-expanded={open} disabled={off} onClick={() => setOpen(o => !o)}>{shown ? 'Change' : 'Add'}</Btn>
        <Btn verb="picture-upload" disabled={off} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</Btn>
        {shown && <Btn danger verb="picture-remove" disabled={off} onClick={() => void write(null, 'remove')}>{busy === 'remove' ? 'Removing…' : 'Remove'}</Btn>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void upload(e)} aria-label="Upload a picture for this post" />
      </div>
      {open && (
        <div className="cn-pic2-lib">
          {slug ? (
            <small className="cn-cap">{OWNER[lane]}’s photos</small>
          ) : (
            <>
              <input className="cn-pic2-q" type="search" placeholder="Search photos: warsaw night street…" aria-label="Search photos"
                value={q} onChange={e => setQ(e.target.value)} />
              <div className="cn-pic2-chips" role="group" aria-label="Folder">
                {FOLDER_KEYS.map(f => (
                  <button key={f} type="button" aria-pressed={!query && f === folder} onClick={() => { setQ(''); setQuery(''); setFolder(f) }}>{FOLDER_LABEL[f]}</button>
                ))}
              </div>
            </>
          )}
          {libErr && <p className="cn-say cn-bad" role="alert">{libErr}</p>}
          {!pics && !libErr && <p className="cn-say">Reading the library…</p>}
          {pics && pics.length === 0 && <p className="cn-say">{query ? 'No photo is tagged with all of that.' : slug ? `No photos in ${POSS[lane]} library yet. Upload one.` : 'Nothing in this folder.'}</p>}
          {pics && pics.length > 0 && look !== null && pics[look] && (
            <div className="cn-pic2-look" role="dialog" aria-label="Picture preview"
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); setLook(null) }
                if (e.key === 'ArrowRight') { e.preventDefault(); setLook(i => i === null ? i : Math.min(pics.length - 1, i + 1)) }
                if (e.key === 'ArrowLeft') { e.preventDefault(); setLook(i => i === null ? i : Math.max(0, i - 1)) }
              }}>
              <div className="cn-pic2-look-img"><img src={pics[look].url} alt="" /></div>
              <div className="cn-pic2-look-bar">
                <Btn aria-label="Previous picture" disabled={look === 0} onClick={() => setLook(look - 1)}>‹</Btn>
                <span>{look + 1} of {pics.length}</span>
                <Btn aria-label="Next picture" disabled={look === pics.length - 1} onClick={() => setLook(look + 1)}>›</Btn>
                <span className="cn-grow" />
                <Btn verb="picture-look-back" autoFocus onClick={() => setLook(null)}>Back</Btn>
                <Btn primary verb="picture-use" disabled={off || pics[look].url === shown}
                  onClick={() => { const u = pics[look].url; setLook(null); void write(u, 'pick') }}>{pics[look].url === shown ? 'On this post' : 'Use this picture'}</Btn>
              </div>
            </div>
          )}
          {pics && pics.length > 0 && look === null && (
            <div className="cn-pic2-g">
              {pics.map((p, i) => (
                <button key={p.url} type="button" aria-label={`Look at ${p.name}`} title="Look at it full size" disabled={off}
                  aria-current={p.url === shown ? 'true' : undefined} onClick={() => setLook(i)}>
                  <img src={p.thumb} alt="" loading="lazy"
                    // The render endpoint is a paid storage feature; if it is off, show the original.
                    onError={e => { const el = e.currentTarget; if (el.src !== p.url) el.src = p.url }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
