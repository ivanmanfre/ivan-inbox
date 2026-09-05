/* ==========================================================================
   src/wb/ask/See.tsx: S15-15 to S15-20, the context strip, on ds `Chip`.

   One chip per thing the pane can currently see. Nothing travels unannounced,
   every chip detaches with one press, and "Show me" prints the EXACT block
   that will ride with the next message rather than a description of it.

   The default is shallow and stays shallow. Message bodies are real content
   about real people, so a chip sends names, counts, states and dates until it
   is opened to full text — at which point the chip says so, and so does the
   strip's own sentence.

   Every predicate here (`seeLine`, `attached`, `buildSeeBlock`, `isOff`,
   `isDeep`, `toggleOff`, `toggleDeep`, `onAll`, `offAll`) is imported from
   `chat/paneContext.ts` unchanged: this file rebuilt the view, not the rule
   about what travels.
   ========================================================================== */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Chip, fadeT, spring } from '../../ds'
import {
  attached, buildSeeBlock, isDeep, isOff, offAll, onAll, seeLine, toggleDeep, toggleOff,
  type SeeState, type Subject,
} from '../../exp/v2c/chat/paneContext'
import './ask.css'

export function See({ subjects, see, setSee }: {
  subjects: Subject[]
  see: SeeState
  setSee: (fn: (s: SeeState) => SeeState) => void
}) {
  const [peek, setPeek] = useState(false)
  const on = attached(subjects, see)
  const block = buildSeeBlock(subjects, see)
  if (subjects.length === 0) return null
  return (
    <div className="a-brain-see" data-see>
      <div className="a-brain-see-top">
        <span className="a-brain-see-l">{seeLine(subjects, see)}</span>
        <Button
          variant="quiet" size="sm"
          onClick={() => setSee(s => (on.length === 0 ? onAll(s, subjects) : offAll(s, subjects)))}
        >{on.length === 0 ? 'Attach again' : 'Detach all'}</Button>
        <Button
          variant="quiet" size="sm" aria-expanded={peek}
          iconEnd={peek ? 'discloseUp' : 'disclose'}
          onClick={() => setPeek(v => !v)}
        >{peek ? 'Hide' : 'Show me'}</Button>
      </div>
      <div className="a-brain-see-chips">
        {subjects.map(x => {
          const off = isOff(see, x.key)
          const deep = isDeep(see, x.key)
          return (
            <Chip
              key={x.key}
              tone={off ? 'quiet' : 'neutral'}
              selected={deep}
              onRemove={() => setSee(s => toggleOff(s, x.key))}
              removeLabel={off ? `Attach ${x.label}` : `Remove ${x.label}`}
            >
              <span className="a-nowrap" data-off={off ? '' : undefined}>{x.label}</span>
              {!off && x.full && (
                <button
                  type="button"
                  className="a-brain-see-d"
                  data-on={deep ? '' : undefined}
                  onClick={e => { e.stopPropagation(); setSee(s => toggleDeep(s, x.key)) }}
                  title={deep
                    ? 'The words themselves are being sent. Click to go back to names only.'
                    : 'Only names and states are being sent. Click to include the words.'}
                >{deep ? 'full text' : 'names only'}</button>
              )}
            </Chip>
          )
        })}
      </div>
      <AnimatePresence initial={false}>
        {peek && (
          <motion.pre
            className="a-brain-see-peek"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >{block ?? 'Nothing about your screen travels with your next message.'}</motion.pre>
        )}
      </AnimatePresence>
    </div>
  )
}
