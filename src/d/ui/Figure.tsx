import type { ReactNode } from 'react'
import type { Read } from '../home/model'
import { Count } from './Count'
import { Reveal } from './Reveal'
import './figures.css'

export function slotRead<T, U>(s: { value: T | null; failed: string | null }, map: (v: T) => U): Read<U> {
  return s.value != null ? { v: map(s.value), ...(s.failed ? { stale: s.failed } : {}) } : s.failed ? { fail: s.failed } : { wait: true }
}
export function mapRead<T, U>(r: Read<T>, map: (v: T) => U): Read<U> {
  return 'v' in r ? { v: map(r.v), ...(r.stale ? { stale: r.stale } : {}) } : r
}
export function Figure({ r, size = 'l', retry, unit, format }: {
  r: Read<number | null>; size?: 'xl' | 'l' | 'm'; retry?: () => void; unit?: ReactNode; format?: (n: number) => string
}) {
  const known = 'v' in r && r.v != null
  const failed = 'fail' in r ? r.fail : 'v' in r && r.v == null ? 'No verified reading' : null
  return <span className={`ols-figure ols-figure-${size}${known && r.v === 0 ? ' ols-zero' : ''}`} data-read={known ? r.stale ? 'stale' : r.v === 0 ? 'zero' : 'value' : failed ? 'failed' : 'reading'}>
    <Reveal reading={'wait' in r} skeleton={<span className="ols-skeleton" aria-label="Reading value" />}>
      {known ? <>{format ? format(r.v!) : <Count value={r.v!} />}{unit && <small>{unit}</small>}{r.stale && retry && <button type="button" className="ols-retry" data-verb="retry" title={r.stale} onClick={retry}>Stale</button>}</>
        : <><span title={failed ?? undefined}>?</span>{retry && <button type="button" className="ols-retry" data-verb="retry" title={failed ?? undefined} onClick={retry}>Retry</button>}</>}
    </Reveal>
  </span>
}
