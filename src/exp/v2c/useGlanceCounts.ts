import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { type ContentLane } from '../../lib/content'
import {
  isClamped, mergeAlerts, splitReviewByLane,
  type AutomationAlert,
} from '../../lib/glance'

// THE GLANCE LAYER'S NUMBERS.
//
// The DERIVATIONS moved to `src/lib/glance.ts` on 2026-08-22 and are unit-tested
// there (`src/lib/glance.test.ts`). What stays here is the fetching, the poll and
// the realtime subscription. Nothing in this file turns a row into a number any
// more, which is the only way the rail's arithmetic could be reached by a test.
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
// The window was 14 days, on the reasoning that the observed ages jumped from 9
// straight to 72 so any value in that gap picked the same rows.
//
// 🔴 THAT REASONING WAS MEASURED ONCE AND THE GAP CLOSED THE NEXT DAY. Shipped
// it, and Ivan's verdict on the result was "u ported some irrelevant workflows
// orange alert". Re-probed after he said it: the 14-day set holds
// "TEMP task-4 manual run — [Source] Competitor -> Idea" and
// "TEMP task-3 backfill — [Source] Competitors Scraping", both one-shot manual
// runs from 11 days ago. A constant chosen to sit in a gap is only as good as
// the gap, and a gap in one day's data is not a property of the system.
//
// 7 days, and the rule behind it is durable rather than fitted: an automation
// that has not run in a week is not currently failing, it has stopped, and a
// thing that has stopped is an Ops question, not an alarm on the rail he lives
// on. Everything older is still counted and still stated, in words, in the
// tooltip.
const ALERT_WINDOW_DAYS = 7

// 🔴 error_count_24h IS STALE AND IS NOT READ HERE. Rows whose last execution
// was 115 to 167 days ago still report error_count_24h of 2 and 13, with
// `updated_at` stamped 2026-03-11. The old dashboard sums that column across
// every workflow and drives a critical/degraded verdict off the total
// (hooks/useWorkflowStats.ts), so that verdict is computed from a column that
// stopped being refreshed. Nothing here renders a "in the last 24 hours"
// figure. What is rendered is `last_execution_status` plus the AGE of that
// execution, both of which are checkable on the row.

// Re-exported so every existing consumer (OpsBoard.tsx, Shell.tsx) keeps its
// import path while the shape itself lives with the function that builds it.
export type { AutomationAlert }

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
  // Errored inside the window but already acknowledged, so excluded from the
  // alarm and named in its tooltip instead.
  acknowledged: number
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
  acknowledged: 0,
  clamped: false,
  error: null,
  loadedAt: null,
}

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
    const { byLane, other } = splitReviewByLane(draftRows)

    const { alerts, olderErrored, olderStalled, acknowledged } = mergeAlerts(
      wf.data ?? [], jobs.data ?? [], cut,
    )

    const clamped =
      isClamped(drafts.count, draftRows.length) ||
      isClamped(magnets.count, (magnets.data ?? []).length)

    setState({
      contentReview: drafts.count ?? draftRows.length,
      contentReviewByLane: byLane,
      contentReviewOther: other,
      magnetsReview: magnets.count ?? (magnets.data ?? []).length,
      alerts,
      olderErrored,
      olderStalled,
      acknowledged,
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
