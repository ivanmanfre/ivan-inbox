// Warm DM4 to review (Ivan's seat). Each held DM4 opens in a sheet with its bubbles in order and the exact image
// between them. Approve sends that pairing; Discard drops it. Deliveries that need a look are listed read-only.
import { useCallback, useEffect, useState } from 'react'
import { approveWarmDm4, discardWarmDm4, fetchVerifiedImage, fetchWarmDm4Queue, IMAGE_LINE, type VerifiedImage, type WarmDm4Item } from '../../lib/warmDm4Review'
import { Btn, Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { Failed } from '../ui/states'
import { Quiet, Row } from './Row'
import { Section, type Folds } from './Section'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function WarmDm4Review({ folds, v4 }: { folds: Folds; v4?: boolean }) {
  const [rows, setRows] = useState<WarmDm4Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(() => {
    setFailed(false)
    fetchWarmDm4Queue().then(setRows).catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])
  if (!failed && (rows === null || rows.length === 0)) return null
  const held = (rows ?? []).filter(r => r.state === 'held')
  const review = (rows ?? []).filter(r => r.state === 'uncertain')
  const open = held.find(r => r.id === openId) ?? null
  return <>
    <Section id="warm-dm4" label="Warm DM4 to review" n={failed ? '?' : held.length + review.length} folds={folds}
      before={failed ? <Failed compact what="the warm DM4 drafts" onRetry={load} /> : null}
      rows={[
        ...held.map(r => <Row key={r.id} v4={v4} id={`wdm4:${r.id}`} name={r.name} company={r.company ?? undefined} conversation={false}
          tags={[{ kind: 'lane', text: r.variant === 'image' ? 'DM4 with image' : 'DM4 text' }]}
          line={r.bubbles[0]} onOpen={() => setOpenId(r.id)} />),
        ...review.map(r => <Row key={r.id} v4={v4} id={`wdm4:${r.id}`} name={r.name} company={r.company ?? undefined} conversation={false}
          tags={[{ kind: 'lane', text: `DM${r.step} delivery needs a look` }]}
          line={`${r.receipts} of ${r.bubbles.length} bubbles confirmed. ${r.reason ?? ''} Nothing will be retried.`} />),
      ]} />
    {open && <WarmDm4Sheet item={open} onClose={() => setOpenId(null)} onDone={() => { setOpenId(null); load() }} />}
  </>
}

export function WarmDm4Sheet({ item, onClose, onDone }: { item: WarmDm4Item; onClose: () => void; onDone: () => void }) {
  const [image, setImage] = useState<VerifiedImage | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'approve' | 'discard'>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true, url: string | null = null
    setImage(null); setImageError(null)
    if (item.image_sha256) {
      fetchVerifiedImage(item).then(v => { url = v.url; if (live) setImage(v); else URL.revokeObjectURL(v.url) })
        .catch(e => { if (live) setImageError(e instanceof Error ? e.message : 'The image could not be read.') })
    }
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [item])
  const needsImage = Boolean(item.image_sha256)
  const canApprove = !busy && (!needsImage || image !== null)
  const run = async (k: 'approve' | 'discard') => {
    if (busy) return
    setBusy(k); setError(null)
    try { await (k === 'approve' ? approveWarmDm4(item, image) : discardWarmDm4(item)); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : 'Not saved. Try again.') }
    finally { setBusy(null) }
  }
  return (
    <Sheet open onClose={onClose} title={item.name} sub={[item.company, item.campaign].filter(Boolean).join(' · ')} label="Warm DM4 review"
      foot={<div className="dm-ban-row">
        <Key primary verb="approve-warm-dm4" disabled={!canApprove} onClick={() => { void run('approve') }}>{busy === 'approve' ? 'Approving…' : 'Approve this DM4'}</Key>
        <Btn danger verb="discard-warm-dm4" disabled={Boolean(busy)} onClick={() => { void run('discard') }}>{busy === 'discard' ? 'Discarding…' : 'Discard'}</Btn>
      </div>}>
      {item.headline && <p className="dm-meta">{item.headline}</p>}
      <ol className="dm-bubbles" aria-label="Messages in send order">
        {item.bubbles.map((b, i) => b === IMAGE_LINE
          ? <li key={i} data-bubble="image">
              {image ? <img src={image.url} alt="Campaign preview image that will be sent" style={{ width: '100%', height: 'auto' }} />
                : imageError ? <p role="alert">{imageError}</p> : <p>Checking the image…</p>}
            </li>
          : <li key={i} data-bubble="text" style={{ whiteSpace: 'pre-wrap' }}>{b}</li>)}
      </ol>
      <Quiet>Sends on or after {day(item.send_after)}, between 13:00 and 00:59 UTC, in the existing chat. Approving sends exactly this.</Quiet>
      {error && <p role="alert">{error}</p>}
    </Sheet>
  )
}
