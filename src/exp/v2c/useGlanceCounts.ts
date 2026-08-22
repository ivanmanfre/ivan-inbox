import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CONTENT_LANES, draftLane, type ContentLane } from '../../lib/content'

// THE GLANCE LAYER'S NUMBERS.
//
// Why this file exists: the rail carried counts for three jobs out of nine, and
// the one it carried for Content was scoped to Ivan's lane. Measured against
// PostgREST on 2026-08-22, `carousel_drafts` at `review` splits
// NULL(Ivan) 2 · risedtc 54 · arch 39. So the rail read "2" while 93 drafts sat
// at the decision stage one lane pill away, and nothing anywhere in the shell
// said so. That is the density gap the dashboard port audit named: the old
// sidebar renders all 21 destinations with a count slot each, so a number never
// goes quiet just because you are looking somewhere else.
//
// This replaces useContentBadge, whose reasoning is kept because it is still
// the reason these are HEAD-shaped reads: a badge that mounts a second
// useContent() pulls up to 1,000 rows to render one numeral, and the workbench
// mounts more surfaces at once than the old app did. The three count reads here
// select ONE column, never a row body.
//
// 🔴 Ivan's rows carry `client_id IS NULL`, never the literal 'ivan'
// (content.ts:103). `.eq('client_id','ivan')` returns a calm, wrong zero. These
// queries carry NO lane filter at all, which is the whole point, and
// `draftLane()` does the NULL→ivan fold at the consumption layer the way every
// other screen in the app does.

// The recency window on the automation alarm, and the measurement that forced
// it. Today's note (TodayScreen.tsx:16) records that Ivan CUT an n8n /
// workflow-error zone from that surface, and SystemAlertStrip.tsx:8 states what
// the ruling was aimed at: "a permanent shelf of n8n workflow errors nobody
// acts on". An unwindowed port would rebuild exactly that shelf. Probed
// 2026-08-22, `dashboard_workflow_stats` holds 17 active workflows whose last
// run errored; 7 of them last ran 72 to 167 days ago and three are named
// "TEMP - Add Diagram Columns (delete me)", "TEMP - Create Table v2" and
// "Test Cookie Download". Those are corpses, not alarms.
//
// The window is 14 days. The answer is INSENSITIVE to the exact value: the
// observed ages jump from 9 days straight to 72, so anything between 10 and 71
// selects the same rows. 14 is inside that gap and is not a derived constant
// pretending to be precise.
const ALERT_WINDOW_DAYS = 14

// 🔴 error_count_24h IS STALE AND IS NOT READ HERE. Rows whose last execution
// was 115 to 167 days ago still report error_count_24h of 2 and 13, with
// `updated_at` stamped 2026-03-11. The old dashboard sums that column across
// every workflow and drives a critical/degraded verdict off the total
// (hooks/useWorkflowStats.ts), so that verdict is computed from a column that
// stopped being refreshed. Nothing here renders a "in the last 24 hours"
// figure. What is rendered is `last_execution_status` plus the AGE of that
// execution, both of which are checkable on the row.

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

export type GlanceCounts = {
  // carousel_drafts at `review`, EVERY lane. The rail row's number.
  contentReview: number
  // The same figure decomposed, so the roll-up above it can never be a number
  // whose parts are invisible.
  contentReviewByLane: Record<ContentLane, number>
  // A lane that is not in CONTENT_LANES yet. Counted in the headline, never
  // dropped: the vocabulary has grown twice already (risedtc, then arch).
  contentReviewOther: number
  // lm_drafts_v2 at review. `lm_review` folds into `review` the way
  // styles.ts:342 already folds it, so this counts what the surface shows.
  magnetsReview: number
  // The windowed alarm, deduped across both health views.
  alerts: AutomationAlert[]
  // What the window left out, stated rather than hidden.
  olderErrored: number
  olderStalled: number
  // TRUE when a count read came back clamped, i.e. the number on screen is a
  // floor rather than the answer. PostgREST clamps a select at 1,000 rows here
  // whatever `limit` says, so the count header and the row length are compared
  // on every read.
  clamped: boolean
  error: string | null
  loadedAt: string | null
}

const EMPTY: GlanceCounts = {
  contentReview: 0,
  contentReviewByLane: { ivan: 0, risedtc: 0, arch: 0 },
  contentReviewOther: 0,
  magnetsReview: 0,
  alerts: [],
  olderErrored: 0,
  olderStalled: 0,
  clamped: false,
  error: null,
  loadedAt: null,
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

// The two health views are synced by cron and carry no realtime channel, so
// they are polled. 120s is the interval the old dashboard's own nav badges use
// (components/dashboard-v2/useNavBadges.ts), ported rather than invented.
const POLL_MS = 120_000

export function useGlanceCounts(): GlanceCounts {
  const [state, setState] = useState<GlanceCounts>(EMPTY)
  const topic = `wb-glance:${useId()}`

  const refresh = useCallback(async () => {
    const cut = new Date(Date.now() - ALERT_WINDOW_DAYS * 86_400_000).toISOString()
    const [drafts, magnets, wf, jobs] = await Promise.all([
      supabase.from('carousel_drafts')
        .select('client_id', { count: 'exact' })
        .eq('status', 'review'),
      supabase.from('lm_drafts_v2')
        .select('client_id', { count: 'exact' })
        .in('status', ['review', 'lm_review']),
      // is.true, not neq/not.eq: `not.eq` DROPS NULLs, and a workflow row with
      // a NULL is_active is not evidence that it is running.
      supabase.from('dashboard_workflow_stats')
        .select('workflow_name, last_execution_at, last_error_message, error_acknowledged')
        .eq('last_execution_status', 'error')
        .is('is_active', true),
      supabase.from('scheduled_ops_status')
        .select('label, source, category, status, last_run_at, last_error_message')
        .is('enabled', true)
        .in('status', ['OVERDUE', 'ERRORING']),
    ])

    const err = drafts.error ?? magnets.error ?? wf.error ?? jobs.error
    if (err) { setState(s => ({ ...s, error: err.message })); return }

    const draftRows = (drafts.data ?? []) as { client_id: string | null }[]
    const byLane: Record<ContentLane, number> = { ivan: 0, risedtc: 0, arch: 0 }
    let other = 0
    for (const r of draftRows) {
      const l = draftLane(r)
      if ((CONTENT_LANES as readonly string[]).includes(l)) byLane[l as ContentLane] += 1
      else other += 1
    }

    // Windowed, then merged. `both` is not a third severity, it is the note
    // that the two sources are describing one automation.
    const merged = new Map<string, AutomationAlert>()
    let olderErrored = 0
    for (const r of (wf.data ?? []) as Record<string, string | boolean | null>[]) {
      const at = r.last_execution_at as string | null
      if (!at || at < cut) { olderErrored += 1; continue }
      const name = String(r.workflow_name ?? '')
      merged.set(norm(name), {
        key: norm(name),
        name,
        kind: 'errored',
        source: 'n8n',
        category: null,
        lastAt: at,
        detail: (r.last_error_message as string | null) || null,
        acknowledged: r.error_acknowledged === true,
      })
    }
    let olderStalled = 0
    for (const r of (jobs.data ?? []) as Record<string, string | null>[]) {
      const at = r.last_run_at
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
        source: r.source,
        category: r.category,
        lastAt: at,
        detail: r.last_error_message || null,
        acknowledged: false,
      })
    }

    const alerts = [...merged.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
    const clamped =
      (drafts.count ?? 0) > draftRows.length ||
      (magnets.count ?? 0) > (magnets.data ?? []).length

    setState({
      contentReview: drafts.count ?? draftRows.length,
      contentReviewByLane: byLane,
      contentReviewOther: other,
      magnetsReview: magnets.count ?? (magnets.data ?? []).length,
      alerts,
      olderErrored,
      olderStalled,
      clamped,
      error: null,
      loadedAt: new Date().toISOString(),
    })
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    // The two draft tables DO carry realtime, so the two numbers Ivan changes
    // by working move without waiting for the poll. The topic is useId-namespaced
    // so a second mount could not black the tree out.
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lm_drafts_v2' }, refresh)
      .subscribe()
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [refresh, topic])

  return state
}
