import { useEffect, useRef, useState, type ReactNode } from 'react'

// The takeover window — the reading register Ivan asked back for.
//
// "when i open a content idea or review do not just open it on the side its
// literally impossible to read… make it like before on the interface that
// opens a window so i can properly read". The 420px draft peer is gone for
// reading surfaces; a draft (or a lead magnet) opens as an overlay covering
// the canvas, in cand-a DraftDetail's register: a full-width reading surface
// with a comfortable centered measure, a real close affordance, scroll locked
// behind.
//
// The CHAT peer is untouched — this chrome is for reading surfaces only.
// ThreadPeer stays a peer too.
//
// z-index 50: below the confirm sheets (.sheet-scrim, z 60), which the delete
// flow opens ON TOP of this window.

export function Takeover({ label, sub, onClose, mobile, children }: {
  label: string
  sub?: string | null
  onClose: () => void
  mobile: boolean
  children: ReactNode
}) {
  // Esc closes, from anywhere — the window is modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // Backdrop click closes on desktop. On mobile the window IS the screen, so
    // there is no backdrop to click — the back chevron and the ✕ carry it.
    <div className="wb-tkscrim" onClick={mobile ? undefined : onClose}>
      <section
        className="wb-tk"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
      >
        <div className="wb-tk-head">
          {mobile && (
            <button type="button" className="back wb-back" onClick={onClose} aria-label="Back">‹</button>
          )}
          <div className="wb-pane-ttl">
            <div className="wb-pane-n">{label}</div>
            {sub && <div className="wb-pane-s">{sub}</div>}
          </div>
          <button type="button" className="wb-tk-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="rows wb-tk-body">
          <div className="wb-tk-col">{children}</div>
        </div>
      </section>
    </div>
  )
}

// The rendered-HTML preview, in a SANDBOXED iframe.
//
// sandbox WITHOUT allow-scripts: nothing in the artifact can execute —
// `allow-same-origin` alone grants no code execution, it only lets THIS parent
// read the frame's document to size it honestly (script execution is gated
// exclusively by allow-scripts). If the measurement is ever unreadable the
// frame keeps a fixed height and scrolls internally, which the spec allows.
export function HtmlPreview({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(480)
  return (
    <iframe
      ref={ref}
      className="wb-tk-frame"
      title={title}
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height: h }}
      onLoad={() => {
        try {
          const doc = ref.current?.contentDocument
          const measured = Math.max(
            doc?.body?.scrollHeight ?? 0,
            doc?.documentElement?.scrollHeight ?? 0,
          )
          if (measured > 0) setH(Math.min(Math.max(measured + 8, 160), 1200))
        } catch { /* measurement refused → the fixed, scrollable height stands */ }
      }}
    />
  )
}
