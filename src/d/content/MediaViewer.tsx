import { useCallback, useEffect, useRef, useState } from 'react'
import { imgOf } from './model'
import './media-viewer.css'

/** A read-only, top-layer viewer shared by the draft window and inline preview. */
export function MediaViewer({ images, initial, onClose }: { images: string[]; initial: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fitControl = useRef<HTMLButtonElement>(null)
  const [index, setIndex] = useState(initial)
  const [zoom, setZoom] = useState(1)
  const image = useRef<HTMLImageElement>(null)
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const fitImage = useCallback(() => {
    const im = image.current, box = stage.current
    if (!im?.naturalWidth || !box) return
    const scale = Math.min((box.clientWidth - 16) / im.naturalWidth, (box.clientHeight - 16) / im.naturalHeight)
    if (scale > 0) setFit({ width: im.naturalWidth * scale, height: im.naturalHeight * scale })
  }, [])
  useEffect(() => { window.addEventListener('resize', fitImage); return () => window.removeEventListener('resize', fitImage) }, [fitImage])
  useEffect(() => { setLoading(true); setFailed(false) }, [index])
  useEffect(() => {
    const box = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    box.showModal()
    fitImage()
    return () => { box.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [fitImage])
  const move = (step: number) => {
    if (index + step < 0 || index + step >= images.length) return
    if (stage.current?.querySelector('.cn-media-status')?.contains(document.activeElement)) fitControl.current?.focus()
    setIndex(index + step)
    setZoom(1)
    stage.current?.scrollTo?.(0, 0)
  }
  return (
    <dialog ref={dialog} className="cn-media-viewer" aria-label="Image viewer" onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose() }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      }}>
      <div className="cn-media-head">
        <b aria-live="polite">{index + 1} / {images.length}</b>
        <div className="cn-media-tools">
          <button type="button" aria-label="Zoom out" aria-disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.5))}>−</button>
          <button type="button" aria-label="Fit to window" ref={fitControl} onClick={() => { setZoom(1); stage.current?.scrollTo?.(0, 0) }}>{zoom === 1 ? 'Fit' : `${zoom * 100}%`}</button>
          <button type="button" aria-label="Zoom in" aria-disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + 0.5))}>+</button>
        </div>
        <button type="button" aria-label="Close image viewer" onClick={onClose}>Close</button>
      </div>
      <div ref={stage} className="cn-media-stage">
        {loading && <p className="cn-media-status" role="status">Loading image…</p>}
        {failed && <div className="cn-media-status" role="alert">Image could not load. <button type="button" onClick={() => { fitControl.current?.focus(); setFailed(false); setLoading(true); setRetry(n => n + 1) }}>Retry</button></div>}
        <button type="button" className="cn-media-image" aria-label={zoom === 1 ? 'Enlarge image' : 'Fit image to window'} data-zoomed={zoom > 1}
          style={{ width: fit ? fit.width * zoom : '100%', height: fit ? fit.height * zoom : '100%' }} onClick={() => { setZoom(zoom === 1 ? 2 : 1); stage.current?.scrollTo?.(0, 0) }}>
          <img key={`${index}-${retry}`} ref={image} onLoad={() => { setLoading(false); setFailed(false); fitImage() }} onError={() => { setLoading(false); setFailed(true) }} src={imgOf([images[index]], 2400) ?? images[index]} alt={`Slide ${index + 1} of ${images.length}`} draggable={false} />
        </button>
      </div>
      {images.length > 1 && <div className="cn-media-nav">
        <button type="button" aria-label="Previous slide" aria-disabled={index === 0} onClick={() => move(-1)}>← Previous</button>
        <span>Use ← → to change slides</span>
        <button type="button" aria-label="Next slide" aria-disabled={index === images.length - 1} onClick={() => move(1)}>Next →</button>
      </div>}
    </dialog>
  )
}
