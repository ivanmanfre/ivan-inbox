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
  // F3 (phase-2 review): the header itself is a content-hugging pill when it is
  // a <button>, so IT cannot be the sticky element — scrolled rows slide around
  // it at the same y. The STRIP is sticky: a full-width opaque canvas band the
  // pill rides inside, so nothing ever shows through beside the chrome.
  return (
    <div className={`wb-sech-strip${sticky ? ' wb-sech-strip-hi' : ''}`}>
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
    </div>
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
// F8 (phase-2 review): at 390 the ~30px axis slots ellipsized the short codes
// to garbage ("ASS… / REV… / SC…"). Fixed-width 3-char codes for the narrow
// axis — a clipped label is a defect, an abbreviation is a decision. IDEA keeps
// its 4 chars (it fits; "IDE" reads worse than the word).
const AXIS_ABBR: Record<string, string> = {
  ideas: 'IDEA', idea: 'IDEA', gen: 'GEN', assets: 'AST', review: 'REV',
  appr: 'APR', sched: 'SCH', pub: 'PUB', err: 'ERR', stuck: 'STK',
  arch: 'ARC', other: 'OTH',
}
const axisAbbr = (s: string) => AXIS_ABBR[s.toLowerCase()] ?? s.slice(0, 3).toUpperCase()

// THE STAGE TAB BAR (2026-08-20) — the pile, laid on its side.
//
// Ivan: "i dont like the pile format on the stages... make it more clickup
// table were i can switch between them", then "make sure everyone has it like
// that". So it lives HERE rather than beside one lane's render: three surfaces
// draw it now (Ivan's posts, the client lanes, the lead magnets) and a fourth
// will, and a tab bar that drifted per lane is the tag-wall argument one level
// up.
//
// It is deliberately dumb. The caller owns what a tab MEANS — a stage on the
// post pipeline, a group-plus-stage on a client lane, an LM stage — and hands
// over a label, a count and a key. This file owns only the geometry: a sticky,
// horizontally-scrolling row of pills that never wraps, because ten tabs on two
// rows is the pile again and it would move the table's top edge every time a
// stage emptied.
export type StageTab = {
  key: string
  label: string
  n: number
  // The neutral "this is waiting on you" dot. Only the decision stage takes it
  // — a backlog is not a warning, it is the work (the rule the section heads
  // kept before these replaced them).
  mark?: boolean
}

export function StageTabs({ tabs, active, onSelect }: {
  tabs: StageTab[]
  active: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="ct-tabs" role="tablist">
      {tabs.map(t => (
        <button
          type="button" key={t.key} role="tab"
          className={`ct-tab${active === t.key ? ' on' : ''}`}
          aria-selected={active === t.key}
          onClick={() => onSelect(t.key)}
        >
          <span className="ct-tab-t">{t.label}</span>
          <span className="ct-tab-n">{t.n}</span>
          {t.mark && t.n > 0 && <span className="wb-sech-dot attention" />}
        </button>
      ))}
    </div>
  )
}

export function CapsuleChart({ parts, onJump }: {
  parts: { key: string; label: string; short?: string; n: number }[]
  onJump?: (key: string) => void
}) {
  const peak = Math.max(1, ...parts.map(p => p.n))
  // Cat index cycles 1-4; beyond four series MONO differentiates by PATTERN,
  // not by colour, which is why the capsule reads the same in greyscale.
  const cat = (i: number) => String((i % 4) + 1)
  // LINEAR again, 2026-08-03. The sqrt compression existed for exactly one
  // reason — a 109-row Published stage sitting beside 2-6-row in-flight stages
  // — and it bought that legibility by drawing every bar at the wrong height.
  // Published is no longer a mark on either pipeline (Ivan's call), so the
  // series is 0-11 and a linear map is both honest and readable.
  //
  // The 24px floor is a DRAWING floor, not a data claim: it is what keeps a
  // 1-row stage from rendering thinner than the numeral printed inside it. A
  // zero never reaches it — zeros take the stub below and keep their slot.
  // Heights are emitted as a PERCENTAGE of the plot, so the one place that
  // decides how tall the plot is stays CSS (`.wb-caps{min-height}`) and the
  // narrow-canvas rule can shorten the bars instead of only the box around
  // them. The 28% floor is a DRAWING floor, not a data claim: it is what keeps
  // a 1-row stage from rendering shorter than the numeral printed inside it.
  // A zero never reaches it — zeros take the stub below and keep their slot.
  const capH = (n: number) => Math.max(28, Math.round(100 * (n / peak)))
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
                style={{ height: `${capH(p.n)}%` }}
                onClick={onJump ? () => onJump(p.key) : undefined}
                title={`${p.label}: ${p.n}`}
              >
                {/* style-delta §5 move 2 — the numeral sits in a drawn print
                    capsule on the mark's own fill. Presentational span only;
                    zero layout movement. */}
                <span className="wb-cap-v">{p.n}</span>
              </span>
            )
        ))}
      </div>
      <div className="wb-caps-x">
        {parts.map(p => (
          <span className="wb-caps-xl" key={p.key} title={p.label}>
            <span className="wb-caps-xl-f">{p.short ?? p.label}</span>
            <span className="wb-caps-xl-a" aria-hidden>{axisAbbr(p.short ?? p.label)}</span>
          </span>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// STAT CHIP — the pipeline as a strip of inline marks (candidate B, D10)
// ---------------------------------------------------------------------------
//
// It replaces a 261px chart card with a 32px chip, and in doing so it drops two
// dishonesties the card carried and could not shed:
//
//   1. NO DRAWING FLOOR. `CapsuleChart` floors every mark at 28% of the plot so
//      a 1-row stage still fits the numeral printed inside it — which draws
//      SCHED=1 beside REVIEW=9 as 28% vs 100% when the true ratio is 11%, a
//      2.5x overstatement. Here the numeral lives OUTSIDE the mark, so the mark
//      is free to be exactly `n / peak` with no floor at all. A 1-of-9 stage
//      draws 11% of the rule, and a zero draws nothing.
//   2. THE HUE IS THE STAGE. The capsule's `cat(i) = (i%4)+1` encodes a stage's
//      POSITION in the array, so re-ordering the pipeline silently recolours it.
//      The colour is passed in, from the stage's own entry in STAGE_COLOR.
//
// `peak` is stated in the title on every chip, because a bar you cannot read the
// denominator of is a picture, not a measurement.
export function StatChip({ label, full, n, peak, color, tone, title, onClick }: {
  label: string
  full: string
  n: number
  peak: number
  color?: string
  // Severity is licensed here for exactly one thing: a stage that is waiting on
  // Ivan (review) or holding a defect (approved-with-no-date). A backlog never
  // takes it — the audit's amber-vs-pending rule.
  tone?: 'attention' | 'urgent' | null
  title: string
  onClick?: () => void
}) {
  const share = peak > 0 ? n / peak : 0
  const Tag: 'button' | 'div' = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`wb-stat${tone ? ` ${tone}` : ''}${n === 0 ? ' wb-stat-0' : ''}`}
      title={`${full}: ${n} · bar is ${n} of ${peak}, the largest stage${title ? ` · ${title}` : ''}`}
    >
      <span className="wb-stat-l">{label}</span>
      <span className="wb-stat-n">{n}</span>
      <span className="wb-stat-r" aria-hidden>
        <i style={{ width: `${share * 100}%`, background: color ?? 'var(--cat-2)' }} />
      </span>
    </Tag>
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
