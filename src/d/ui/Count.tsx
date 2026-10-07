import { useLayoutEffect, useRef, useState } from 'react'
import { useMotionLevel } from '../../ds/motionLevel'
import './figures.css'

export function rollSlots(from: string, to: string) {
  return [...to].map((char, i) => ({ char, old: from[from.length - to.length + i] ?? '', changed: char !== from[from.length - to.length + i] }))
}

/** A real accessible value; only changed digits move, never a first reading. */
export function Count({ value }: { value: number }) {
  const level = useMotionLevel()
  const prev = useRef(value)
  const [old, setOld] = useState<number | null>(null)
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = value
    if (before === value || level === 'off') { setOld(null); return }
    setOld(before)
    const t = window.setTimeout(() => setOld(null), 380)
    return () => window.clearTimeout(t)
  }, [value, level])
  const text = value.toLocaleString('en-US')
  const animate = old != null && level !== 'off'
  return <span className="ols-count" data-count={value}>
    <span className="ols-sr">{text}</span>
    <span aria-hidden="true" className={animate && value < old ? 'ols-count-down' : ''}>
      {rollSlots(animate ? old.toLocaleString('en-US') : text, text).map((s, i) => <span key={text.length - i} className="ols-digit">
        <span key={s.char} className={animate && s.changed ? 'ols-digit-in' : undefined}>{s.char}</span>
        {animate && s.changed && s.old && <span className="ols-digit-out">{s.old}</span>}
      </span>)}
    </span>
  </span>
}
