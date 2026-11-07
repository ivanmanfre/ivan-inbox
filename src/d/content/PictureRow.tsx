import { useEffect, useRef, useState } from 'react'
import {
  BOARD_SLUG, MAX_POST_PHOTOS, listClientPhotos, listStills, normalizeImageUrls, photoOptions, searchStills,
  setDraftMedia, setDraftPhotos, uploadDraftPicture, type ContentDraftDetail, type Picture, type StillFolder,
} from '../../lib/content'
import { photoThumb } from '../../lib/xReview'
import { Btn } from '../ui/Key'
import { useToast } from '../ui/toast'
import { OWNER, POSS, type Lane } from './model'
import './picture.css'
import '../x/x.css'

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
//
// IVAN'S OWN POSTS (2026-11-06, report #4 + #44): the publisher posts every
// photo in one LinkedIn post, so his row shows them all, as the X quick-post
// row he accepted on 6 Nov (PR #87, x.css .xr-pick): 76px options with a check
// on the ones that post, "No photo", and "All photos" (the library). A tap on a
// checked photo takes it off the post and keeps it as an option; a tap on an
// option puts it back. Order is the order they post in; there is no reorder.
// One write: setDraftPhotos -> operator_set_draft_photos (the whole list).

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
  const storedList = normalizeImageUrls(d.image_urls)
  const storedKey = JSON.stringify(storedList)
  const stored = storedList[0] ?? null
  const ivan = lane === 'ivan'
  // Ivan rows: the list on the post (optimistic) and every photo it has had (the option row).
  const [list, setList] = useState<string[]>(storedList)
  const [added, setAdded] = useState<string[]>([])
  const options = [...new Set([...photoOptions(d), ...added, ...list])]
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
  useEffect(() => { setList(JSON.parse(storedKey) as string[]) }, [storedKey])

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

  // Ivan rows: write the whole photo list. Every success carries Undo (puts the old list back).
  const writeList = async (next: string[], message: string, prev = list) => {
    setBusy(next.length < prev.length ? 'remove' : 'pick'); setList(next); onShow(next)
    try {
      await setDraftPhotos(d.id, next)
      toast.show({
        message,
        sub: next.length === 0 ? 'Text only. The selfie job leaves this post bare now.'
          : next.length === 1 ? '1 photo posts.' : `${next.length} photos post together in one post.`,
        action: { label: 'Undo', verb: 'picture-undo', run: () => { void writeList(prev, 'Photos put back.', next) } },
      })
      onDone()
    } catch (e) {
      setList(prev); onShow(undefined)
      toast.show({ tone: 'failed', message: e instanceof Error ? e.message : 'The photos did not change.', sub: 'The post keeps the photos it had.' })
    } finally {
      setBusy('')
    }
  }
  // An option back on the post goes to its place in the option order, so the posting order never shuffles.
  const toggle = (url: string) => {
    if (list.includes(url)) return void writeList(list.filter(u => u !== url), 'Photo taken off the post.')
    if (list.length >= MAX_POST_PHOTOS) {
      toast.show({ tone: 'failed', message: `A post takes at most ${MAX_POST_PHOTOS} photos.`, sub: 'Take one off first.' })
      return
    }
    const on = new Set([...list, url])
    void writeList(options.filter(u => on.has(u)), 'Photo added.')
  }
  const addFromLibrary = (url: string) => {
    if (list.includes(url)) return
    // a photo that is already an option goes back in its own place, same as a tap on the row
    if (options.includes(url)) { setOpen(false); toggle(url); return }
    if (list.length >= MAX_POST_PHOTOS) {
      toast.show({ tone: 'failed', message: `A post takes at most ${MAX_POST_PHOTOS} photos.`, sub: 'Take one off first.' })
      return
    }
    setAdded(a => a.includes(url) ? a : [...a, url])
    setOpen(false)
    void writeList([...list, url], 'Photo added.')
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
    if (ivan) { setBusy(''); addFromLibrary(url); return }
    await write(url, 'upload')
  }

  const off = disabled || !!busy
  const n = list.length
  const ivanNote = n > 1 ? `${n} photos post together in one post, in this order. Tap a photo to take it off.`
    : n === 1 ? 'This photo posts. Tap it to take it off.'
    : noPhoto ? 'Removed on purpose: the selfie job leaves it bare.'
    : d.status === 'review' && d.type === 'text' ? 'Text only. The selfie job adds one within 10 min unless you pick one or remove it.'
    : 'Text only.'
  const libraryUses = (url: string) => ivan ? list.includes(url) : url === shown
  const takeFromLibrary = (url: string) => { if (ivan) addFromLibrary(url); else void write(url, 'pick') }
  return (
    <section className={`cn-pic2${ivan ? ' cn-pic3' : ''}`} aria-label={ivan ? 'Photos' : 'Picture'} data-busy={busy || undefined}>
      {ivan ? (
        <>
          <div className="cn-pic3-h">
            <span>Photos</span>
            <small>{busy === 'upload' ? 'Uploading…' : n ? `${n} photo${n > 1 ? 's' : ''}` : 'Text only'}</small>
          </div>
          <p className="cn-pic3-note">{ivanNote}</p>
          <div className="xr-picks" role="group" aria-label="Photos for this post">
            {options.map((u, i) => {
              const at = list.indexOf(u)
              const on = at >= 0
              return (
                <button key={u} type="button" role="checkbox" aria-checked={on} className={`xr-pick${on ? ' xr-pick-on' : ''}`}
                  data-verb="picture-option" disabled={off} title={nameOf(u)}
                  aria-label={`${on ? `Photo ${at + 1} on the post` : `Option ${i + 1}, not on the post`}: ${whereFrom(u)}`} onClick={() => toggle(u)}>
                  <span className="xr-pick-img"><img src={photoThumb(u, 200)} alt="" loading="lazy"
                    onError={e => { const el = e.currentTarget; if (el.src !== u) el.src = u }} />{on && <span className="xr-pick-check" aria-hidden>{n > 1 ? at + 1 : '✓'}</span>}</span>
                  <span className="xr-pick-cap">{on ? (n > 1 ? `Photo ${at + 1}` : 'On the post') : 'Off the post'}</span>
                </button>
              )
            })}
            {/* With no photo and no stamp yet the tile stays tappable: the tap stamps taxonomy.no_photo so the selfie job leaves the post bare. */}
            <button type="button" aria-pressed={n === 0} className={`xr-pick xr-pick-text${n === 0 ? ' xr-pick-on' : ''}`}
              data-verb="picture-remove" disabled={off || (n === 0 && noPhoto)} onClick={() => void writeList([], n > 1 ? 'Photos taken off the post.' : n === 1 ? 'Photo taken off the post.' : 'Kept as text only.')}>
              <span className="xr-pick-img"><span className="xr-pick-glyph" aria-hidden>Aa</span>{n === 0 && <span className="xr-pick-check" aria-hidden>✓</span>}</span>
              <span className="xr-pick-cap">{busy === 'remove' ? 'Saving…' : 'No photo'}</span>
            </button>
            <button type="button" className="xr-pick xr-pick-more" data-verb="picture-change" aria-expanded={open} disabled={off} onClick={() => setOpen(o => !o)}>
              <span className="xr-pick-img"><span className="xr-pick-glyph" aria-hidden>{open ? '×' : '+'}</span></span>
              <span className="xr-pick-cap">{open ? 'Close' : 'All photos'}</span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void upload(e)} aria-label="Upload a picture for this post" />
        </>
      ) : (<>
      <div className="cn-pic2-h">
        <span className="cn-pic2-th">
          {shown ? <img src={shown} alt="" /> : <span aria-hidden="true">none</span>}
        </span>
        <div className="cn-pic2-m">
          <small className="cn-cap">Picture</small>
          <b title={shown ? nameOf(shown) : undefined}>{busy === 'upload' ? 'Uploading…' : shown ? whereFrom(shown) : 'No picture'}</b>
          <span>{shown ? (d.type === 'carousel' ? 'Carousel' : 'Single image')
            : `Text only on ${POSS[lane]} board.`}</span>
        </div>
      </div>
      <div className="cn-pic2-acts">
        <Btn verb="picture-change" aria-expanded={open} disabled={off} onClick={() => setOpen(o => !o)}>{shown ? 'Change' : 'Add'}</Btn>
        <Btn verb="picture-upload" disabled={off} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</Btn>
        {shown && <Btn danger verb="picture-remove" disabled={off} onClick={() => void write(null, 'remove')}>{busy === 'remove' ? 'Removing…' : 'Remove'}</Btn>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void upload(e)} aria-label="Upload a picture for this post" />
      </div>
      </>)}
      {open && (
        <div className="cn-pic2-lib">
          {slug ? (
            <small className="cn-cap">{OWNER[lane]}’s photos</small>
          ) : (
            <>
              <div className="cn-pic3-libh">
                <small className="cn-cap">Your library: a photo you use is added to the post</small>
                <Btn verb="picture-upload" disabled={off} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</Btn>
              </div>
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
                <Btn primary verb="picture-use" disabled={off || libraryUses(pics[look].url)}
                  onClick={() => { const u = pics[look].url; setLook(null); takeFromLibrary(u) }}>{libraryUses(pics[look].url) ? 'On this post' : ivan ? 'Add to the post' : 'Use this picture'}</Btn>
              </div>
            </div>
          )}
          {pics && pics.length > 0 && look === null && (
            <div className="cn-pic2-g">
              {pics.map((p, i) => (
                <button key={p.url} type="button" aria-label={`Look at ${p.name}`} title="Look at it full size" disabled={off}
                  aria-current={libraryUses(p.url) ? 'true' : undefined} onClick={() => setLook(i)}>
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
