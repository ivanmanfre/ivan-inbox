/* =========================================================================
   Direction B — "surface". The shared frame every dir-b screen mounts in.

   Two jobs, both of which have to happen exactly once per screen and cannot
   be done in the seam (the seam is read-only for a builder):

   1. `ds-body` on document.body. `src/ds/ds.css` puts the type base, the
      focus ring, the scrollbar and the `prefers-reduced-motion` collapse
      behind `body.ds-body`, so without the class the motion contract has no
      reduced-motion half. It is added on mount and never removed: a dir-b
      screen and the shipped chrome coexist in one tree.
   2. `<Motion>` — `MotionConfig reducedMotion="user"` — so every spring in
      here honours the OS setting without a per-component check.

   `Surface` is the page body itself: a scrolling column of cards on the
   pistachio-framed plate, with the air Direction B is built on.
   ========================================================================= */
import { useEffect, type ReactNode } from 'react'
import { Motion, cx } from '../../ds'
import './dir-b.css'

let mounted = 0

export function useDsBody() {
  useEffect(() => {
    mounted += 1
    document.body.classList.add('ds-body')
    return () => { mounted -= 1; if (mounted <= 0) document.body.classList.remove('ds-body') }
  }, [])
}

/** The frame. Every override's outermost element. */
export function DirB({ className, children }: { className?: string; children: ReactNode }) {
  useDsBody()
  return (
    <Motion>
      <div data-dirb="root" className={cx('dirb', className)}>{children}</div>
    </Motion>
  )
}

/**
 * A scrolling page of stacked cards. The default body of a dir-b screen.
 *
 * It forwards a ref because it IS the scrolling element: pull-to-refresh and
 * the "N new" pill both have to hold the node that actually scrolls, and a
 * screen that cannot reach it has to redraw this markup locally instead.
 * React 19 passes `ref` as a plain prop, so no forwardRef wrapper is needed.
 */
export function Surface({ className, children, ref, ...rest }:
  { className?: string; children: ReactNode; ref?: React.Ref<HTMLDivElement> }
  & React.HTMLAttributes<HTMLDivElement>) {
  return <div ref={ref} className={cx('dirb-surface', className)} {...rest}>{children}</div>
}

/**
 * One vertical block inside a Surface: an eyebrow, then its cards.
 *
 * `id` because Today's zones are jump anchors (#td-z0 and its siblings) and an
 * anchor a screen cannot set is an anchor that stops working; `sticky` because
 * a zone head condenses on scroll and the head is inside this component.
 */
export function Block({ id, label, tail, sticky = false, headClassName, className, children }: {
  id?: string
  label?: ReactNode
  tail?: ReactNode
  sticky?: boolean
  headClassName?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section id={id} className={cx('dirb-block', className)}>
      {label || tail ? (
        <div className={cx('dirb-block-head', sticky && 'dirb-sticky', headClassName)}>
          <span className="ds-t-eyebrow">{label}</span>
          {tail ? <span className="dirb-block-tail">{tail}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
