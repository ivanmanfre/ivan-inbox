import { useEffect, useRef, useState } from 'react'
import {
  BOARD_SLUG, STILL_FOLDERS, listClientPhotos, listStills, normalizeImageUrls, searchStills, setDraftMedia,
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
  const [folder, setFolder] = useState<StillFolder>(STILL_FOLDERS[0])
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [pics, setPics] = useState<Picture[] | null>(null)
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
    setPics(null); setLibErr('')
    const read = slug ? listClientPhotos(slug) : query ? searchStills(query) : listStills(folder)
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
            <small className="cn-cap">{OWNER[lane]}’s photos · client-photos/{slug}</small>
          ) : (
            <>
              <input className="cn-pic2-q" type="search" placeholder="Search photos: warsaw night street…" aria-label="Search photos"
                value={q} onChange={e => setQ(e.target.value)} />
              <div className="cn-pic2-chips" role="group" aria-label="Folder">
                {STILL_FOLDERS.map(f => (
                  <button key={f} type="button" aria-pressed={!query && f === folder} onClick={() => { setQ(''); setQuery(''); setFolder(f) }}>{f}</button>
                ))}
              </div>
            </>
          )}
          {libErr && <p className="cn-say cn-bad" role="alert">{libErr}</p>}
          {!pics && !libErr && <p className="cn-say">Reading the library…</p>}
          {pics && pics.length === 0 && <p className="cn-say">{query ? 'No photo is tagged with all of that.' : slug ? `No photos in ${POSS[lane]} library yet. Upload one.` : 'Nothing in this folder.'}</p>}
          {pics && pics.length > 0 && (
            <div className="cn-pic2-g">
              {pics.map(p => (
                <button key={p.url} type="button" aria-label={`Use ${p.name}`} title={p.name} disabled={off}
                  aria-current={p.url === shown ? 'true' : undefined} onClick={() => void write(p.url, 'pick')}>
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
