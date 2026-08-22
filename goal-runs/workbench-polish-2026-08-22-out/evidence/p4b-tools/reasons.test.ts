// PROOF, not a fixture test: reads the 55 live `status='error'` rows captured by
// fetch55.py and prints what the card says now against what it said before.
// Run: npx vitest run goal-runs/workbench-polish-2026-08-22-out/evidence/p4b-tools/reasons.test.ts
import { readFileSync, existsSync } from 'node:fs'
import { it, expect } from 'vitest'
import { draftFailure, taxonomyValue } from '../../../../src/lib/content'
import { label } from '../../../../src/lib/labels'

const SNAP = new URL('./err55.json', import.meta.url).pathname

// The function exactly as it stood before this change, so "before" is the real
// old output and not a remembered one.
function before(d: any): string {
  const msg = taxonomyValue(d.taxonomy, 'error_message')
  if (msg) return msg
  if (d.qa_verdict) {
    const verdict = label(d.qa_verdict)
    return d.qa_score ? `${verdict} (score ${d.qa_score})` : verdict
  }
  return 'No reason recorded'
}

it('every one of the live error rows, before and after', () => {
  if (!existsSync(SNAP)) throw new Error(`no snapshot at ${SNAP} — run fetch55.py first`)
  const rows = JSON.parse(readFileSync(SNAP, 'utf8'))
  expect(rows.length).toBeGreaterThan(0)

  let changed = 0, stale = 0, silent = 0, echo = 0, noStamp = 0
  const kinds: Record<string, number> = {}
  const lines: string[] = []

  for (const r of rows) {
    const log = Array.isArray(r.agent_log) ? r.agent_log : []
    const last = log.length ? log[log.length - 1] : {}
    const d = {
      taxonomy: r.taxonomy, qa_verdict: r.qa_verdict, qa_score: r.qa_score,
      log_agent: last.agent ?? null, log_body: last.body ?? null, log_ts: last.ts ?? null,
    }
    const b = before(d)
    const a = draftFailure(d)
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1

    // A "stale stall" is the measured defect: the card claims the sentinel
    // stopped it while the terminal event says something else entirely.
    const claimsStall = /Generation stuck/i.test(b)
    const reallyStalled = a.kind === 'stalled'
    if (claimsStall && !reallyStalled) stale += 1
    if (b === 'No reason recorded') silent += 1
    // The OTHER wrong-reason shape, and the one the brief mis-stated as "No
    // reason recorded": a row with no `taxonomy.error_message` fell through to
    // the qa_verdict branch, so its reason line printed the same verdict the QA
    // chip two elements to its left was already printing. Not a lie, but not a
    // reason either — it answers "what is the verdict", never "why did it fail".
    if (!taxonomyValue(r.taxonomy, 'error_message')) {
      noStamp += 1
      if (r.qa_verdict) echo += 1
    }
    if (a.reason !== b) changed += 1

    lines.push(
      `\n${r.id.slice(0, 8)}  lane=${r.client_id ?? 'ivan'}  body=${(r.post_body || '').trim() ? 'yes' : 'no'}  kind=${a.kind}`
      + `\n   BEFORE  ${b.replace(/\n/g, ' ').slice(0, 150)}`
      + `\n   AFTER   ${a.reason.replace(/\n/g, ' ').slice(0, 150)}`,
    )
  }

  console.log(lines.join(''))
  console.log(`\n=== ${rows.length} live error rows ===`)
  console.log(`reason text changed:                 ${changed}`)
  console.log(`was a STALE STALL claim, now correct: ${stale}`)
  console.log(`was "No reason recorded", now named:  ${silent}`)
  console.log(`no taxonomy.error_message at all:     ${noStamp}`)
  console.log(`  of those, reason line only echoed the QA chip: ${echo}`)
  console.log(`WRONG -> RIGHT (stale + echo + silent): ${stale + echo + silent}`)
  console.log(`kinds: ${JSON.stringify(kinds)}`)

  // Nothing under the old order may survive as a stall claim that the log denies.
  for (const r of rows) {
    const log = Array.isArray(r.agent_log) ? r.agent_log : []
    const last = log.length ? log[log.length - 1] : {}
    const a = draftFailure({
      taxonomy: r.taxonomy, qa_verdict: r.qa_verdict, qa_score: r.qa_score,
      log_agent: last.agent ?? null, log_body: last.body ?? null, log_ts: last.ts ?? null,
    })
    if (/stalled\. The watchdog/i.test(a.reason)) expect(last.agent).toBe('Stuck Sentinel')
    expect(a.reason.trim().length).toBeGreaterThan(0)
  }
})
