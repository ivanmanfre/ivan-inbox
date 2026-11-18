// Tests only: jsdom has no IntersectionObserver and no elementFromPoint, so the desk never sends
// held_seen there (it cannot verify that Undo is visible). This installs a controllable stand-in:
// every observed element gets its own on-screen box, the observer reports `ratio` for it, and
// elementFromPoint returns the element under a point unless `covered` is set.
type Rec = { el: Element; cb: IntersectionObserverCallback; io: FakeIO }
const observed: Rec[] = []
let ratio = 1
let covered = false
let nextTop = 0

function box(top: number) {
  return { left: 10, top, right: 90, bottom: top + 30, width: 80, height: 30, x: 10, y: top, toJSON: () => ({}) }
}

function fire(rec: Rec) {
  const r = rec.el.getBoundingClientRect()
  rec.cb([{
    target: rec.el, isIntersecting: ratio > 0, intersectionRatio: ratio, time: 0,
    boundingClientRect: r as DOMRectReadOnly, intersectionRect: r as DOMRectReadOnly, rootBounds: null,
  }], rec.io as unknown as IntersectionObserver)
}

class FakeIO {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [1]
  private cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) {
    const top = (nextTop += 40)
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => box(top), configurable: true })
    const rec = { el, cb: this.cb, io: this }
    observed.push(rec)
    queueMicrotask(() => { if (observed.includes(rec)) fire(rec) })
  }
  unobserve(el: Element) { for (let i = observed.length - 1; i >= 0; i--) if (observed[i].el === el && observed[i].io === this) observed.splice(i, 1) }
  disconnect() { for (let i = observed.length - 1; i >= 0; i--) if (observed[i].io === this) observed.splice(i, 1) }
  takeRecords(): IntersectionObserverEntry[] { return [] }
}

function elementAt(x: number, y: number): Element | null {
  if (covered) return document.body
  for (const { el } of observed) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el
  }
  return null
}

const g = globalThis as unknown as { IntersectionObserver?: unknown }
const d = document as unknown as { elementFromPoint?: unknown }

/** Undo buttons are fully visible and uncovered unless a test says otherwise. */
export function installVisibility(): void {
  observed.length = 0; ratio = 1; covered = false; nextTop = 0
  g.IntersectionObserver = FakeIO
  d.elementFromPoint = elementAt
}
/** As in an old browser: no way to verify visibility. */
export function removeVisibility(): void {
  observed.length = 0
  delete g.IntersectionObserver
  delete d.elementFromPoint
}
/** The observer reports this visible fraction for every observed element, now. */
export function setVisibleRatio(r: number): void { ratio = r; observed.slice().forEach(fire) }
/** The next observation (a new observe) reports this fraction; nothing fires now (a hidden tab's layout moved). */
export function setRatioQuiet(r: number): void { ratio = r }
/** Something (a sheet, the keyboard bar) lies over every button. */
export function setCovered(c: boolean): void { covered = c }
