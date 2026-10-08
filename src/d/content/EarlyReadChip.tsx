import { useEffect, useRef, useState } from 'react'
import { holdoutText, noRead, parsePattern, rateText, readReasonText, type PatternRead } from '../../lib/earlyReads'
import { Sheet } from '../ui/Sheet'
import type { Lane } from './model'
import './early-read.css'

export function EarlyReadChip({ read, lane, unsaved = false }: { read?: PatternRead; lane: Lane; unsaved?: boolean }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const shown = unsaved ? { ...noRead('Save the changed body before its new early read can be made.'), state: 'unsaved' } : read ?? noRead()
  const pattern = shown.state === 'ready' ? parsePattern(shown.pattern, lane) : null
  const small = lane === 'arch' || shown.smallSample
  const text = pattern ? `${rateText(pattern.rate)} early read · n=${pattern.n}`
    : shown.state === 'loading' ? 'Reading early read…' : shown.state === 'failed' ? 'Early read unavailable'
      : shown.state === 'unsaved' ? 'Early read · unsaved' : 'No read yet'
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open) return
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const dialog = trigger.current?.closest('.d-app')?.querySelector('.cn-read-sheet')
      const focusable = dialog?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')
      if (!focusable?.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [open])
  return <span className="cn-early-wrap" onClick={e => e.stopPropagation()}>
    <button ref={trigger} type="button" className={`cn-early-chip${pattern ? ' cn-early-ready' : ''}`} data-verb="early-read" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${text}${small ? ' · small sample' : ''}`} onClick={e => { e.stopPropagation(); setOpen(true) }}>{pattern ? <>{rateText(pattern.rate)} early read<span className="cn-early-n"> · n={pattern.n}</span></> : text}</button>
    <Sheet open={open} onClose={close} title="Early read" className="cn-read-sheet" sub={small ? 'Small sample · niche evidence' : 'Niche evidence'}>
      <div onClick={e => e.stopPropagation()}>
        <p>{pattern ? shown.sentence || 'No stored explanation is available for this read.' : readReasonText(shown.reason)}</p>
        {pattern && <p>{pattern.value.replaceAll('_', ' ')} · {pattern.dimension.replaceAll('_', ' ')}: <b>{rateText(pattern.rate)}</b> · n={pattern.n}. Usual niche rate {rateText(pattern.base_rate)} · n={pattern.base_n}.</p>}
        <p className="cn-read-note">This describes the niche. It is an early read, never a promise for this post.</p>
        {small && <p className="cn-read-note">Small sample.</p>}
        {shown.holdout && <><p>{holdoutText(shown.holdout)}</p>{shown.holdout.limitation && <p className="cn-read-note">{shown.holdout.limitation}</p>}</>}
        {shown.recipeFit && <p className="cn-read-note">Recipe fit: {shown.recipeFit.score == null ? shown.recipeFit.reason || 'unavailable' : shown.recipeFit.score.toFixed(2)} ({shown.recipeFit.validated ? 'validated' : 'unvalidated'}). This is a separate fit score.</p>}
      </div>
    </Sheet>
  </span>
}
