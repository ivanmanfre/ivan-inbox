import { useState } from 'react'
import { reasonLabel, reasonsFor } from '../../lib/verdicts'
import { VERDICT_HOLD_MS, forgetVerdict, giveReason, retryVerdict, undoVerdict, type Judged } from './verdictStore'
import './verdict.css'

// THE STRIP (run 39, variant A "two keys + inline why"). Keep or Drop turns the
// card into one 44px line in the same place: what was decided, the title, and
// Undo draining for 5 s (nothing is written until it ends). Under it, the why:
// one tap, or ignore it. A reason after the write is one more idempotent call.
// A failed write keeps the draft undecided and says why.
const verdictWord = (e: Pick<Judged, 'verdict' | 'lane'>) => e.verdict === 'drop' ? 'Dropped' : e.lane === 'ivan' ? 'Kept · approved' : 'Kept'

export function VerdictStrip({ e }: { e: Judged }) {
  const keep = e.verdict === 'keep'
  const [other, setOther] = useState(false)
  const [note, setNote] = useState('')
  // A strip that moves between slots remounts: start the bar where the hold really is.
  const [elapsed] = useState(() => Math.min(VERDICT_HOLD_MS, Math.max(0, Date.now() - e.at)))
  const failed = e.phase === 'failed'
  const chosen = e.reasons[0] ?? null
  const pick = (slug: string) => {
    if (slug === 'other') { setOther(true); return }
    setOther(false)
    giveReason(e.id, slug)
  }
  return (
    <article className={`cn-vs cn-vs-${e.verdict}`} data-strip-id={e.id} data-phase={e.phase} aria-label={failed ? 'Not saved' : verdictWord(e)}>
      <div className="cn-vs-row">
        <span className={`cn-vs-what${failed ? ' cn-vs-bad' : keep ? ' cn-vs-keep' : ''}`}>{failed ? 'Not saved' : verdictWord(e)}</span>
        <span className="cn-vs-ttl">{e.title}</span>
        {e.phase === 'held' && (
          <button type="button" className="cn-vs-undo" data-verb="verdict-undo" onClick={() => undoVerdict(e.id)}>
            Undo<i className="cn-vs-drain" aria-hidden="true" style={{ animationDuration: `${VERDICT_HOLD_MS}ms`, animationDelay: `-${elapsed}ms` }} />
          </button>
        )}
        {e.phase === 'saving' && <span className="cn-vs-state" role="status">Saving…</span>}
        {e.phase === 'saved' && <>
          <span className="cn-vs-state cn-vs-mono" role="status">Saved</span>
          <button type="button" className="cn-vs-x" data-verb="verdict-close" aria-label="Close" onClick={() => forgetVerdict(e.id)}>×</button>
        </>}
      </div>
      {failed ? (
        <div className="cn-vs-fail">
          <p className="cn-vs-err" role="alert">{e.error ?? 'That did not go through.'}</p>
          <div className="cn-vs-btns">
            <button type="button" className="cn-vs-btn" data-verb="verdict-retry" onClick={() => retryVerdict(e.id)}>Try again</button>
            <button type="button" className="cn-vs-btn" data-verb="verdict-forget" onClick={() => forgetVerdict(e.id)}>Keep the card</button>
          </div>
        </div>
      ) : (
        <>
          <div className="cn-vs-why" role="group" aria-label={keep ? 'Why keep it' : 'Why drop it'}>
            <span className="cn-vs-lbl">{keep ? 'Why keep it? Optional' : 'Why? One tap'}</span>
            {reasonsFor(e.verdict).map(([slug, label]) => (
              <button key={slug} type="button" data-verb="verdict-reason" data-reason={slug} aria-pressed={chosen === slug} disabled={e.reasonSaving} onClick={() => pick(slug)}>{label}</button>
            ))}
          </div>
          {(other || chosen === 'other') && (
            <form className="cn-vs-note" onSubmit={ev => { ev.preventDefault(); giveReason(e.id, 'other', note) }}>
              <input type="text" value={note} maxLength={500} placeholder="What was it?" aria-label="What was it?" onChange={ev => setNote(ev.target.value)} />
              <button type="submit" className="cn-vs-btn" data-verb="verdict-note-save" disabled={e.reasonSaving}>Save</button>
            </form>
          )}
          {chosen && !e.error && <p className="cn-vs-saved" role="status">Why: {reasonLabel(e.verdict, chosen)}{e.reasonSaving ? ' · saving…' : ''}</p>}
          {e.error && (
            <p className="cn-vs-warn" role="alert">
              {e.error}{' '}
              {chosen && <button type="button" className="cn-vs-link" data-verb="verdict-reason-retry" onClick={() => giveReason(e.id, chosen, e.note)}>Try again</button>}
            </p>
          )}
        </>
      )}
    </article>
  )
}
