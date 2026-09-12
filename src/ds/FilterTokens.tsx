/* ==========================================================================
   src/ds/FilterTokens.tsx — THE TOKEN ROW (E2, goal run
   inbox-repair-floor-and-21st-moves-2026-09-12).

   Ported from andrewlu0/filters (21st.dev, 1030 uses). What the reference is:
   a filter drawn as a row of segmented pills you can read left to right —
   `[Field] [is] [Value] [×]` — a `+` that opens a SEARCHABLE field list, and
   each token editable in place. What is discarded: all of the skin. No
   Tailwind, no shadcn, no lucide, no radix, no cva, no `cn`. The parts are
   this system's own Popover / PopoverItem / Input / Sheet / Icon, the ground
   is dark, the field name is mono, and the lime is spent on exactly one thing
   — the live half of a token, the value that is hiding rows right now.

   The grammar, the registries and every pure function live in
   `src/lib/filterTokens.ts`; this file draws them and owns no rules.

   NOTHING HERE SENDS OR WRITES. A filter READS: every handler on this surface
   ends in a setState.
   ========================================================================== */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from './icons'
import { Input } from './Input'
import { Popover, PopoverItem } from './Popover'
import { Sheet } from './Sheet'
import { presence } from './motion'
import {
  OP_LABEL, findField, newToken, tokenSentence, valueLabel,
  type FieldSpec, type FilterToken, type TokenOp,
} from '../lib/filterTokens'

const PHONE_MQ = '(max-width: 767px)'

function usePhone(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const fn = (e: MediaQueryListEvent) => setOn(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

/** Escape and a click outside both close. Escape is stopped at capture so it
 *  drops exactly one layer rather than also clearing the selection behind it —
 *  the same rule content's own filter panel already follows. */
function useDismiss(open: boolean, close: () => void, outside: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey, true)
    if (outside) document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close, outside])
  return ref
}

type Pick = { value: string; label: string }

/**
 * The one menu both popovers use: an optional search field, a list of rows, a
 * check on the one that is live. Arrow keys walk it, Enter takes the highlight,
 * Escape closes — bound on the WRAPPER so they work whether the caret is in the
 * search field or on a row.
 */
function PickMenu({
  label, items, active, onPick, search, phone, onClose,
}: {
  label: string
  items: Pick[]
  active: string | null
  onPick: (value: string) => void
  /** A searchable list. Off for a two-row operator menu, which would be a field
   *  to type in with nothing to find. */
  search: boolean
  phone: boolean
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase()
    return w ? items.filter(i => i.label.toLowerCase().includes(w) || i.value.toLowerCase().includes(w)) : items
  }, [items, q])
  useEffect(() => { setHi(0) }, [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const row = shown[hi]
      if (row) onPick(row.value)
    } else if (e.key === 'Escape') { e.stopPropagation(); onClose() }
  }

  return (
    <div className="ds-ftk-menu" onKeyDown={onKey}>
      {search && (
        <div className="ds-ftk-menu-head">
          <Input
            label={`Find a ${label}`}
            labelHidden
            icon="search"
            placeholder={`Find a ${label}…`}
            value={q}
            // The panel mounts under the pointer with nothing else in it to
            // focus; `Input` omits `ref` from its props by design, so the
            // attribute the platform already has is the one used.
            autoFocus={!phone}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      )}
      <div className="ds-ftk-menu-body">
        {shown.length === 0 ? (
          <div className="ds-ftk-menu-empty ds-t-meta">Nothing by that name.</div>
        ) : shown.map((i, n) => (
          <PopoverItem
            key={i.value}
            onClick={() => onPick(i.value)}
            tail={i.value === active ? <Icon name="check" size={16} /> : undefined}
          >
            <span
              className="ds-ftk-menu-row"
              data-hi={n === hi ? '' : undefined}
              data-on={i.value === active ? '' : undefined}
            >{i.label}</span>
          </PopoverItem>
        ))}
      </div>
    </div>
  )
}

/** The popover on a canvas, the bottom sheet on a phone — which is the fork
 *  `src/wb/content/filters.tsx` already makes for every one of its panels, so
 *  a filter opens the same way everywhere on this app. */
function Panel({
  open, onClose, title, phone, children,
}: {
  open: boolean; onClose: () => void; title: string; phone: boolean; children: ReactNode
}) {
  if (phone) {
    return <Sheet open={open} onClose={onClose} title={title}>{children}</Sheet>
  }
  return <Popover open={open} label={title} className="ds-ftk-pop">{children}</Popover>
}

function Token<T>({
  field, token, onChange, onRemove, phone,
}: {
  field: FieldSpec<T>
  token: FilterToken
  onChange: (t: FilterToken) => void
  onRemove: () => void
  phone: boolean
}) {
  const [open, setOpen] = useState<'op' | 'value' | null>(null)
  const [draftDays, setDraftDays] = useState(token.value)
  const close = () => setOpen(null)
  const ref = useDismiss(open !== null, close, !phone)
  useEffect(() => { setDraftDays(token.value) }, [token.value])

  const manyOps = field.ops.length > 1
  const vLabel = valueLabel(field, token)

  const commitDays = (v: string) => {
    const n = Math.max(1, Math.min(3650, Math.round(Number(v) || 0)))
    onChange({ ...token, value: String(n) })
    close()
  }

  return (
    <span className="ds-ftk-token" data-ds="FilterToken" ref={ref}>
      {/* The field is fixed once chosen: swapping it turns the token into a
          different question, which is what removing it and adding one is for.
          So it is a label, not a control — and one fewer thing in the tab
          order per token. */}
      <span className="ds-ftk-f ds-t-mono">{field.label}</span>

      {manyOps ? (
        <span className="ds-ftk-anchor">
          <button
            type="button"
            className="ds-ftk-op"
            aria-haspopup="menu"
            aria-expanded={open === 'op'}
            aria-label={`${field.label}: change the operator, now ${OP_LABEL[token.op]}`}
            onClick={() => setOpen(o => (o === 'op' ? null : 'op'))}
          >{OP_LABEL[token.op]}</button>
          <Panel open={open === 'op'} onClose={close} title={field.label} phone={phone}>
            <PickMenu
              label="operator"
              search={false}
              phone={phone}
              items={field.ops.map(o => ({ value: o, label: OP_LABEL[o] }))}
              active={token.op}
              onPick={v => { onChange({ ...token, op: v as TokenOp }); close() }}
              onClose={close}
            />
          </Panel>
        </span>
      ) : (
        <span className="ds-ftk-op" data-static="">{OP_LABEL[token.op]}</span>
      )}

      {field.kind !== 'flag' && (
        <span className="ds-ftk-anchor">
          <button
            type="button"
            className="ds-ftk-v"
            aria-haspopup="menu"
            aria-expanded={open === 'value'}
            aria-label={`${field.label}: change the value, now ${vLabel}`}
            onClick={() => setOpen(o => (o === 'value' ? null : 'value'))}
          >{vLabel}</button>
          <Panel open={open === 'value'} onClose={close} title={field.label} phone={phone}>
            {field.kind === 'days' ? (
              <div className="ds-ftk-menu">
                <div className="ds-ftk-menu-head">
                  <Input
                    label="Days"
                    labelHidden
                    type="number"
                    min={1}
                    max={3650}
                    mono
                    value={draftDays}
                    autoFocus={!phone}
                    onChange={e => setDraftDays(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitDays(draftDays) }
                      else if (e.key === 'Escape') { e.stopPropagation(); close() }
                    }}
                    tail={<span className="ds-t-meta">days</span>}
                  />
                </div>
                <div className="ds-ftk-menu-body">
                  {['3', '7', '14', '30', '90'].map(d => (
                    <PopoverItem
                      key={d}
                      onClick={() => commitDays(d)}
                      tail={d === token.value ? <Icon name="check" size={16} /> : undefined}
                    >
                      <span className="ds-ftk-menu-row" data-on={d === token.value ? '' : undefined}>
                        {d} days
                      </span>
                    </PopoverItem>
                  ))}
                </div>
              </div>
            ) : (
              <PickMenu
                label={field.label}
                search={(field.values?.length ?? 0) > 6}
                phone={phone}
                items={field.values ?? []}
                active={token.value}
                onPick={v => { onChange({ ...token, value: v }); close() }}
                onClose={close}
              />
            )}
          </Panel>
        </span>
      )}

      <button
        type="button"
        className="ds-ftk-x"
        aria-label={`Remove the filter ${tokenSentence(field, token)}`}
        title={`Remove ${tokenSentence(field, token)}`}
        onClick={onRemove}
      ><Icon name="close" size={16} /></button>
    </span>
  )
}

export interface FilterTokensProps<T> {
  /** This surface's registry. A token naming a field that is not here is drawn
   *  as nothing and narrows nothing — a persisted set outlives a rename. */
  fields: FieldSpec<T>[]
  tokens: FilterToken[]
  setTokens: (t: FilterToken[]) => void
  /** Names the `+` for a screen reader: "Add a DMs filter". */
  surfaceLabel: string
  /** Off where the surface already has its own way in. Content's phone sheet
   *  is one: it carries the search field and the Clear/Done foot, so a second
   *  opener beside it on a 390px bar is two controls for one job. */
  showAdd?: boolean
  /** Off where the surface already has a Clear that does MORE — Content's
   *  clears the search box as well, and two Clears a token apart is
   *  decoration. */
  showClear?: boolean
  className?: string
}

/**
 * The row: the live tokens, the `+`, and a `Clear` that appears only once there
 * is something to clear. It renders as `display:contents` so the tokens are
 * direct flex children of whatever bar hosts it and inherit that bar's own gap
 * and wrap — the chip row and the token row are ONE row, not two bands of
 * chrome stacked above the list.
 */
export function FilterTokens<T>({ fields, tokens, setTokens, surfaceLabel, showAdd = true, showClear = true, className }: FilterTokensProps<T>) {
  const phone = usePhone()
  const [adding, setAdding] = useState(false)
  const closeAdd = () => setAdding(false)
  const addRef = useDismiss(adding, closeAdd, !phone)

  const add = (key: string) => {
    const f = findField(fields, key)
    if (!f) return
    setTokens([...tokens, newToken(f)])
    setAdding(false)
  }

  return (
    <span className={className ? `ds-ftk ${className}` : 'ds-ftk'} data-ds="FilterTokens">
      <AnimatePresence initial={false}>
        {tokens.map(t => {
          const f = findField(fields, t.field)
          if (!f) return null
          return (
            <motion.span
              key={t.id}
              className="ds-ftk-slot"
              variants={presence.rise}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <Token
                field={f}
                token={t}
                phone={phone}
                onChange={next => setTokens(tokens.map(x => (x.id === t.id ? next : x)))}
                onRemove={() => setTokens(tokens.filter(x => x.id !== t.id))}
              />
            </motion.span>
          )
        })}
      </AnimatePresence>

      {showAdd && (
      <span className="ds-ftk-anchor" ref={addRef}>
        <button
          type="button"
          className="ds-ftk-add"
          aria-haspopup="menu"
          aria-expanded={adding}
          aria-label={`Add a ${surfaceLabel} filter`}
          title={`Add a ${surfaceLabel} filter`}
          onClick={() => setAdding(v => !v)}
        >
          <Icon name="add" size={16} />
          {tokens.length === 0 ? <span className="ds-ftk-add-t">Filter</span> : null}
        </button>
        <Panel open={adding} onClose={closeAdd} title="Filter by" phone={phone}>
          <PickMenu
            label="field"
            search
            phone={phone}
            items={fields.map(f => ({ value: f.key, label: f.label }))}
            active={null}
            onPick={add}
            onClose={closeAdd}
          />
        </Panel>
      </span>
      )}

      {showClear && tokens.length > 0 && (
        <button
          type="button"
          className="ds-ftk-clear"
          onClick={() => setTokens([])}
        >Clear</button>
      )}
    </span>
  )
}
