// THE GLANCE LAYER'S PURE DERIVATIONS.
//
// Extracted out of `src/exp/v2c/useGlanceCounts.ts` 2026-08-22 so the numbers on
// the rail can be reached by a test. The hook keeps the fetching, the polling and
// the realtime subscription; everything that turns ROWS into NUMBERS lives here
// and is a pure function of its arguments.
//
// Why that split matters: the rail badge is the mechanism that makes hidden work
// visible. A silent regression in these three derivations reproduces the exact
// failure the glance layer was built to fix, which is a full lane looking dead,
// and it reproduces it quietly. The reasoning for each rule stays on the
// function that implements it.

import { CONTENT_LANES, draftLane, type ContentLane } from './content'

export type LaneRow = { client_id: string | null }

export type LaneSplit = {
  byLane: Record<ContentLane, number>
  // A lane that is not in CONTENT_LANES yet. Counted, never dropped: the
  // vocabulary has grown twice already (risedtc, then arch).
  other: number
}

// 🔴 Ivan's rows carry `client_id IS NULL`, never the literal 'ivan'
// (content.ts:103). The fold is `draftLane()`, the same one every other screen
// in the app uses, so a NULL row lands on `ivan` and never on `other`.
export function splitReviewByLane(rows: readonly LaneRow[]): LaneSplit {
  const byLane: Record<ContentLane, number> = { ivan: 0, risedtc: 0, arch: 0 }
  let other = 0
  for (const r of rows) {
    const l = draftLane(r)
    if ((CONTENT_LANES as readonly string[]).includes(l)) byLane[l as ContentLane] += 1
    else other += 1
  }
  return { byLane, other }
}

export type AutomationAlert = {
  // Normalised name. `dashboard_workflow_stats.workflow_name` and
  // `scheduled_ops_status.label` are the SAME string for the n8n-sourced jobs
  // that appear in both views, so this is the dedupe key: probed 2026-08-22 the
  // two windowed sets are 10 and 15 with an exact-name overlap of 6, and a
  // naive sum would claim 25 automations are broken when 19 are.
  key: string
  name: string
  // `errored` = its last n8n execution failed. `stalled` = a scheduled job that
  // was running inside the window and is now past its interval. `both` = the
  // two views agree about the same automation.
  kind: 'errored' | 'stalled' | 'both'
  source: string | null
  category: string | null
  lastAt: string | null
  detail: string | null
  acknowledged: boolean
}

export type WorkflowStatRow = {
  workflow_name?: string | null
  last_execution_at?: string | null
  last_error_message?: string | null
  error_acknowledged?: boolean | null
}

export type ScheduledOpsRow = {
  label?: string | null
  source?: string | null
  category?: string | null
  last_run_at?: string | null
  last_error_message?: string | null
}

export type MergedAlerts = {
  alerts: AutomationAlert[]
  // What the window left out, stated rather than hidden.
  olderErrored: number
  olderStalled: number
}

export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

// Windowed, then merged. `both` is not a third severity, it is the note that the
// two sources are describing one automation. `cut` is an ISO timestamp; a row
// with no timestamp at all counts as older, because an automation that has never
// reported is not evidence of a live alarm.
export function mergeAlerts(
  wf: readonly WorkflowStatRow[],
  jobs: readonly ScheduledOpsRow[],
  cut: string,
): MergedAlerts {
  const merged = new Map<string, AutomationAlert>()
  let olderErrored = 0
  for (const r of wf) {
    const at = r.last_execution_at ?? null
    if (!at || at < cut) { olderErrored += 1; continue }
    const name = String(r.workflow_name ?? '')
    merged.set(norm(name), {
      key: norm(name),
      name,
      kind: 'errored',
      source: 'n8n',
      category: null,
      lastAt: at,
      detail: r.last_error_message || null,
      acknowledged: r.error_acknowledged === true,
    })
  }
  let olderStalled = 0
  for (const r of jobs) {
    const at = r.last_run_at ?? null
    if (!at || at < cut) { olderStalled += 1; continue }
    const name = String(r.label ?? '')
    const k = norm(name)
    const hit = merged.get(k)
    if (hit) {
      merged.set(k, { ...hit, kind: 'both', category: r.category ?? hit.category })
      continue
    }
    merged.set(k, {
      key: k,
      name,
      kind: 'stalled',
      source: r.source ?? null,
      category: r.category ?? null,
      lastAt: at,
      detail: r.last_error_message || null,
      acknowledged: false,
    })
  }
  const alerts = [...merged.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
  return { alerts, olderErrored, olderStalled }
}

// TRUE when a count read came back clamped, i.e. the number on screen is a floor
// rather than the answer. PostgREST clamps a select at 1,000 rows here whatever
// `limit` says, so the count header and the row length are compared on every
// read. A null count is not a clamp: it is a count the server did not send.
export function isClamped(count: number | null | undefined, rowLen: number): boolean {
  return (count ?? 0) > rowLen
}
