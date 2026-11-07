import { useSyncExternalStore } from 'react'
import { setXQuickPhoto, type XRingPhoto } from '../../lib/xReview'
import { patchX, refreshX } from './useXReview'

// ONE PHOTO-WRITE QUEUE PER QUICK POST (Sol r1 2026-11-05). Swipes, gallery picks and Remove all set the
// post's wanted photo here; one drain loop saves it through x_quick_set_photo, one request at a time, and
// always saves the LATEST want. It lives outside the component, so leaving and reopening the card mid-save
// never lets an older swipe land after a newer one, and Post's flush waits for every kind of photo change.
// Each save goes through patchX, which bumps the store revision (a read that started before it is dropped).

export const PHOTO_SETTLE_MS = 600

/** photo null = remove the photo (text only). */
type Want = { photo: XRingPhoto | null }
export type PhotoSlotView = { want: Want | null; err: string | null; saving: boolean }
type Slot = { want: Want | null; err: string | null; timer: number | null; running: Promise<boolean> | null; view: PhotoSlotView }

const EMPTY: PhotoSlotView = { want: null, err: null, saving: false }
const slots = new Map<string, Slot>()
const subs = new Set<() => void>()

function slot(id: string): Slot {
  let s = slots.get(id)
  if (!s) { s = { want: null, err: null, timer: null, running: null, view: EMPTY }; slots.set(id, s) }
  return s
}
function emit(s: Slot) {
  s.view = { want: s.want, err: s.err, saving: s.running !== null || s.timer !== null }
  subs.forEach(f => f())
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function drain(id: string): Promise<boolean> {
  const s = slot(id)
  if (s.running) return s.running
  if (!s.want) return Promise.resolve(true)
  const run = (async () => {
    let ok = true
    while (s.want) {
      const target = s.want
      const p = target.photo
      try {
        const url = await setXQuickPhoto(id, p ? p.id : null)
        patchX(l => ({ ...l, quicks: l.quicks.map(q => q.id === id ? { ...q, media_url: url, media_photo_id: p ? p.id : null, media_source: 'ivan', media_reason: p ? 'picked by Ivan' : 'removed by Ivan', media_place: p ? p.place : null } : q) }))
        // saved what he still wants: done. A newer want (set while this one saved) loops once more.
        if (s.want === target) s.want = null
      } catch (e) {
        // the server state is unknown after a failed answer: drop the want and read the truth again
        s.want = null
        s.err = msg(e)
        ok = false
        void refreshX()
      }
      emit(s)
      if (!ok) break
    }
    s.running = null
    emit(s)
    return ok
  })()
  s.running = run
  emit(s)
  return run
}

/** A swipe: the preview moves at once; the save waits until he settles. */
export function swipePhoto(id: string, photo: XRingPhoto) {
  const s = slot(id)
  s.want = { photo }
  s.err = null
  if (s.timer !== null) window.clearTimeout(s.timer)
  s.timer = window.setTimeout(() => { s.timer = null; emit(s); void drain(id) }, PHOTO_SETTLE_MS)
  emit(s)
}

/** A gallery pick or Remove: saved at once, after anything already queued. true = saved. */
export function choosePhoto(id: string, photo: XRingPhoto | null): Promise<boolean> {
  const s = slot(id)
  s.want = { photo }
  s.err = null
  if (s.timer !== null) { window.clearTimeout(s.timer); s.timer = null }
  emit(s)
  return drain(id)
}

/** Save whatever is still settling now and wait for every queued photo write. false = the last one failed. */
export function flushPhoto(id: string): Promise<boolean> {
  const s = slot(id)
  if (s.timer !== null) { window.clearTimeout(s.timer); s.timer = null; emit(s) }
  return drain(id)
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export function usePhotoSlot(id: string): PhotoSlotView {
  return useSyncExternalStore(subscribe, () => slots.get(id)?.view ?? EMPTY, () => slots.get(id)?.view ?? EMPTY)
}

/** Test hook. */
export function __resetPhotoSavesForTests() {
  for (const s of slots.values()) if (s.timer !== null) window.clearTimeout(s.timer)
  slots.clear()
}
