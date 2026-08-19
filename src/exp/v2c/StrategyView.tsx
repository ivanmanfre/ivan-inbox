import { useEffect, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useStrategy } from '../../hooks/useStrategy'
import {
  addSection, blankCount, lineShape, moveSection, removeSection, sectionIsBlank, updateSection,
} from '../../lib/strategy'
import { CONTENT_LANES, LANE_LABEL, type ContentLane } from '../../lib/content'
import { Failed, relAge } from './Surface'

// Strategy as its own job (Ivan, 2026-08-19: "i feel like i need a strategy doc
// per client that im currently kinda flying... we can do a tab strategy besides
// magnets and styles").
//
// It joins WORK_JOBS rather than becoming a seventh rail row because it is
// per-LANE, and the lane switch is exactly what the work group already carries.
// Switching to RISE in Content and then opening Strategy shows RISE's strategy;
// there is one lane state in the app, not one per tab.
//
// What this is NOT: it is not a prompt. Ivan ruled content_prompts out — that
// row set is generation canon the n8n pipeline reads, and a strategy Ivan is
// still working out has no business steering a live generator. Nothing machine-
// reads this table. It is his document, on his surface.

// A textarea that grows to its content, because a strategy section is 2 lines
// or 20 and a fixed box makes the 20-line one a 4-line scroll port. Measured on
// every value change rather than on input, so a lane switch (which replaces the
// value without an input event) resizes too.
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

// Ivan, 2026-08-19: "make it a bit more digestible... you know what we're doing
// for each line, not this whole text. Format it much better."
//
// A strategy is read far more often than it is typed, so the resting state is
// TYPESET, not a textarea. One click swaps in the editor. Three line shapes
// carry all the hierarchy, and each is inferable from the text itself — no
// markup for Ivan to remember and no second format to keep in sync:
//
//   RUN OF CAPS — rest    a group heading ("BUYERS — 1 post of 5")
//   Label — value         the label is the thing being decided
//   - item                a list item
//
// The caps test is on the segment BEFORE the dash, so "TRUST + REACH — 4 of 5.
// Pains his feed has barely touched:" still reads as a heading even though its
// tail is a sentence. Classification lives in lib/strategy (pure, unit-tested);
// this only decides what each shape looks like.
function BodyLine({ line }: { line: string }) {
  const shape = lineShape(line)
  switch (shape.kind) {
    case 'gap':
      return <div className="wb-strat-gap" />
    case 'item':
      return (
        <div className="wb-strat-li">
          <span className="wb-strat-bullet">·</span>
          <span>{shape.text}</span>
        </div>
      )
    case 'head':
      return (
        <div className="wb-strat-head">
          <span className="wb-strat-kicker">{shape.label}</span>
          {shape.rest && <span className="wb-strat-headrest">{shape.rest}</span>}
        </div>
      )
    case 'kv':
      return (
        <div className="wb-strat-kv">
          <span className="wb-strat-k">{shape.label}</span>
          <span>{shape.rest}</span>
        </div>
      )
    default:
      return <div className="wb-strat-p">{shape.text}</div>
  }
}

function SectionCard({ s, first, last, onPatch, onMove, onRemove, onAddAfter }: {
  s: { key: string; title: string; body: string }
  first: boolean
  last: boolean
  onPatch: (patch: { title?: string; body?: string }) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onAddAfter: () => void
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)
  useAutoGrow(bodyRef, editing ? s.body : '')
  const blank = sectionIsBlank(s)

  // Focus lands at the END, not at character 0: clicking a section to append a
  // line and landing at the top is the wrong guess almost every time.
  useEffect(() => {
    if (!editing) return
    const el = bodyRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  return (
    <div className={`ct-card wb-strat-card${blank ? ' blank' : ''}`}>
      <div className="wb-strat-h">
        <input
          className="wb-strat-t"
          value={s.title}
          placeholder="Section title"
          onChange={e => onPatch({ title: e.target.value })}
        />
        {/* Unwritten is the state worth SEEING — the tab exists because Ivan is
            flying without these. A blank section says so on its face instead of
            looking identical to a written one. */}
        {blank && <span className="wb-strat-blank">unwritten</span>}
        <div className="wb-strat-ctl">
          <button type="button" onClick={() => onMove(-1)} disabled={first} title="Move up">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={last} title="Move down">↓</button>
          <button type="button" onClick={onAddAfter} title="Add a section below">+</button>
          <button
            type="button" className="x" title="Remove this section"
            onClick={() => {
              // The only destructive control on the surface, and a section can
              // hold a paragraph Ivan wrote once and never re-derived.
              if (s.body.trim() && !confirm(`Remove "${s.title || 'this section'}"? Its text is not recoverable.`)) return
              onRemove()
            }}
          >×</button>
        </div>
      </div>
      {editing ? (
        <textarea
          ref={bodyRef}
          className="wb-strat-b"
          value={s.body}
          rows={2}
          placeholder="One line per decision. CAPS heads a group, Label — value, - for a list."
          onChange={e => onPatch({ body: e.target.value })}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <div
          className="wb-strat-read"
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}
        >
          {s.body.trim()
            ? s.body.split('\n').map((line, i) => <BodyLine key={i} line={line} />)
            : <div className="wb-strat-empty">Click to write this one.</div>}
        </div>
      )}
    </div>
  )
}

export function StrategyView({ lane, setLane }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
}) {
  const st = useStrategy(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  // Pull-to-refresh would discard unsaved edits, so it is wired to a refresh
  // that refuses while dirty rather than being wired to nothing (a dead pull
  // gesture reads as a broken surface).
  const ptr = usePullToRefresh(rowsRef, () => { if (!st.dirty) st.refresh() })

  const head = (
    <div className="nav wb-head">
      <div className="row-top">
        <h2>Strategy</h2>
        <span className="wb-strat-age">
          {st.dirty
            ? 'unsaved'
            : st.updatedAt ? `saved ${relAge(st.updatedAt)}` : 'never saved'}
        </span>
      </div>
      <div className="chips">
        {CONTENT_LANES.map(k => (
          <button
            type="button" key={k} className={`chip ${lane === k ? 'on' : ''}`}
            onClick={() => {
              // Switching lane remounts against a different row. Doing that with
              // unsaved text would drop it silently.
              if (st.dirty && !confirm('You have unsaved strategy edits on this lane. Switch and lose them?')) return
              setLane(k)
            }}
          >
            {LANE_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  )

  if (st.error) {
    return (
      <>
        {head}
        <Failed what="This lane's strategy" message={st.error} onRetry={st.refresh} loadedAt={null} />
      </>
    )
  }

  const blanks = blankCount(st.sections)

  return (
    <>
      {head}
      <div className="rows ct-rows wb-strat" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {st.loading ? (
          <div className="wb-strat-note">Loading…</div>
        ) : (
          <>
            <div className="wb-strat-note">
              {blanks > 0
                ? `${blanks} of ${st.sections.length} sections still unwritten.`
                : `${st.sections.length} sections, all written.`}
              {' '}Only you can see this. It is never read by the generator and never shown to the client.
            </div>
            {st.sections.map((s, i) => (
              <SectionCard
                key={s.key}
                s={s}
                first={i === 0}
                last={i === st.sections.length - 1}
                onPatch={patch => st.setSections(cur => updateSection(cur, s.key, patch))}
                onMove={dir => st.setSections(cur => moveSection(cur, s.key, dir))}
                onRemove={() => st.setSections(cur => removeSection(cur, s.key))}
                onAddAfter={() => st.setSections(cur => addSection(cur, s.key))}
              />
            ))}
            <div className="wb-strat-add">
              <button type="button" className="btn s" onClick={() => st.setSections(cur => addSection(cur, null))}>
                Add a section
              </button>
            </div>
          </>
        )}
        <div style={{ height: 96 }} />
      </div>
      {/* The save bar exists only when there is something to save — a permanently
          docked bar with a greyed button teaches nothing and costs 56px of a
          phone screen on every visit. */}
      {st.dirty && (
        <div className="wb-strat-save">
          <span className="wb-strat-savemsg">
            {st.saveError ?? 'Unsaved changes'}
          </span>
          <button type="button" className="btn s" disabled={st.saving} onClick={st.refresh}>
            Discard
          </button>
          <button type="button" className="btn p" disabled={st.saving} onClick={() => { void st.save() }}>
            {st.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </>
  )
}
