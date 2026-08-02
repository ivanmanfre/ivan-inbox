import type { ReactNode } from 'react'

// The three states, as three components, so no surface can accidentally render
// two of them the same way.
//
// The audit's P1 U2/U3: Inbox, Drafts and Ops have no error state at all — a
// failed fetch renders the identical "No threads yet." / "Nothing waiting on
// you." copy as a genuinely empty queue, on the screens Ivan opens first every
// day. Meanwhile Sends and Today, the "just checking" surfaces, have the most
// thorough three-way handling in the app. This inverts that: every data surface
// in the workbench routes through here.
//
// The distinguishing signal is not just copy — it is the FRESHNESS STAMP. Today
// already has one (.td-sync "Synced 00:30 · now"); nothing else does. An empty
// list carrying "checked 4s ago" is confirmed empty. An empty list carrying
// nothing is unverified.

export function relAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// State 3 — FETCH FAILED. Red tier, names what broke, offers the retry, and says
// what the operator is looking at instead (stale rows or nothing).
export function Failed({ what, message, onRetry, loadedAt, children }: {
  what: string
  message: string
  onRetry?: () => void
  loadedAt?: string | null
  children?: ReactNode
}) {
  return (
    <div className="wb-failed">
      <div className="wb-failed-h">
        <span className="wb-failed-dot" />
        <span className="wb-failed-t">{what} didn’t load</span>
        {onRetry && <button className="wb-retry" onClick={onRetry}>Try again</button>}
      </div>
      <div className="wb-failed-m">{message}</div>
      <div className="wb-failed-f">
        {loadedAt
          ? `Showing what loaded ${relAge(loadedAt)}. It may be out of date.`
          : 'Nothing has loaded yet, so this is not an empty queue — it is an unread one.'}
      </div>
      {children}
    </div>
  )
}

// State 2 — GENUINELY EMPTY. Calm, terse, un-corporate (the zero-state voice the
// aesthetics audit named as worth protecting), plus the stamp that makes it a
// fact rather than a hope.
export function CalmEmpty({ line, loadedAt, sub }: {
  line: string; loadedAt?: string | null; sub?: string
}) {
  return (
    <div className="wb-empty">
      <div className="wb-empty-l">{line}</div>
      {sub && <div className="wb-empty-s">{sub}</div>}
      {loadedAt !== undefined && (
        <div className="wb-empty-f">
          <span className="wb-ok-dot" />
          Checked {relAge(loadedAt)}
        </div>
      )}
    </div>
  )
}

// One section-header primitive with optional slots, modelled on Today's .td-zh
// (the strongest of the four unrelated patterns the audit counted). Count, dot
// and chevron are slots; the rule and the letter-spaced label are the constant.
// `sticky` (phase 6 ask 4) pins a collapsible header to the top of the scroller
// so its COUNT stays readable while its own rows run under it. Used on the two
// long collapsed sections (Ideas, and the lead-magnet lane header), never on
// every section: a page of competing sticky bars is a page with no top.
export function SectionHead({ n, title, count, sev, open, onToggle, tail, sticky }: {
  n?: string
  title: string
  count?: ReactNode
  sev?: 'clear' | 'attention' | 'urgent' | null
  open?: boolean
  onToggle?: () => void
  tail?: ReactNode
  sticky?: boolean
}) {
  // Interactive headers are real <button>s (keyboard reach + the global focus
  // ring); a header with nothing to toggle stays a plain div.
  const Tag: 'button' | 'div' = onToggle ? 'button' : 'div'
  return (
    <Tag
      {...(onToggle ? { type: 'button' as const } : {})}
      className={`wb-sech${onToggle ? ' tap' : ''}${sticky ? ' wb-sech-sticky' : ''}`}
      onClick={onToggle}
    >
      {n && <span className="wb-sech-n">{n}</span>}
      <span className="wb-sech-t">{title}</span>
      <span className="wb-sech-rule" />
      {tail}
      {count !== undefined && <span className="wb-sech-c">{count}</span>}
      {sev !== undefined && sev !== null && <span className={`wb-sech-dot ${sev}`} />}
      {onToggle && <span className="wb-sech-chev">{open ? '⌄' : '›'}</span>}
    </Tag>
  )
}

// The capsule column-chart: one capsule per stage with the value printed INSIDE
// the mark, the single most transferable object in the reference. It costs
// nothing here because the series is always real — it is the stage histogram of
// rows the list is already holding.
//
// Lifted out of ContentList's PipelineBar in phase 6 so the LEAD-MAGNET lane can
// have the same chart as the post lane without either importing the other
// (ContentList imports ContentSections, so the primitive has to live below
// both). The post bar keeps its own hero figure and footer; only the plot is
// shared.
//
// A zero stage still spends its slot (`.wb-cap-0`), collapsed to a stub rather
// than omitted: on the LM lane four of the nine stages have never had a row, and
// dropping them would draw a five-stage pipeline that does not exist.
export function CapsuleChart({ parts, onJump }: {
  parts: { key: string; label: string; short?: string; n: number }[]
  onJump?: (key: string) => void
}) {
  const peak = Math.max(1, ...parts.map(p => p.n))
  // Cat index cycles 1-4; beyond four series MONO differentiates by PATTERN,
  // not by colour, which is why the capsule reads the same in greyscale.
  const cat = (i: number) => String((i % 4) + 1)
  // SQRT scale, not linear. The live Ivan lane holds a 109-row Published stage
  // beside 2-6-row in-flight stages; a linear map to 120px drew the outlier as
  // a monster balloon and flattened every other capsule to its floor. sqrt
  // compresses the top of the range (109 → 72px, 6 → 17px→floor 22) so the
  // small stages stay readable against the big one. Cap is 72px by
  // construction: sqrt(n/peak) ≤ 1.
  const capH = (n: number) => Math.max(22, Math.round(72 * Math.sqrt(n / peak)))
  return (
    <>
      <div className="wb-caps">
        {parts.map((p, i) => (
          p.n === 0
            ? <span className="wb-cap-0" key={p.key} title={`${p.label}: 0`} />
            : (
              <span
                className="wb-cap"
                key={p.key}
                data-cat={cat(i)}
                style={{ height: `${capH(p.n)}px` }}
                onClick={onJump ? () => onJump(p.key) : undefined}
                title={`${p.label}: ${p.n}`}
              >
                {p.n}
              </span>
            )
        ))}
      </div>
      <div className="wb-caps-x">
        {parts.map(p => <span className="wb-caps-xl" key={p.key} title={p.label}>{p.short ?? p.label}</span>)}
      </div>
    </>
  )
}

// A proportion bar built from parts. This is the workbench's answer to "every
// section encodes something visually": a stage/lane breakdown is drawn once at
// the top of a list instead of being a column of numbers.
export function StackBar({ parts }: { parts: { key: string; n: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  if (total === 0) return <div className="wb-stack wb-stack-zero" />
  return (
    <div className="wb-stack">
      {parts.filter(p => p.n > 0).map(p => (
        <span
          key={p.key}
          className="wb-stack-seg"
          style={{ width: `${(p.n / total) * 100}%`, background: p.color }}
          title={`${p.key}: ${p.n}`}
        />
      ))}
    </div>
  )
}
