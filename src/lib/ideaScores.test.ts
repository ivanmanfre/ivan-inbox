import { describe, it, expect } from 'vitest'
import { contributionsLine, sortByScore, type IdeaScoreRead, type IdeaScoreRow } from './ideaScores'

/* ==========================================================================
   THE SORT RULE (CB-15 P4 W-W2), the one G4/G6 both depend on:

     · a VALIDATED client's idea list sorts by idea_scores.score desc;
     · an UNVALIDATED client's list — or one behind a failed/empty score
       read — is returned in EXACTLY the order it was given, because the
       existing order function (composite_score for lm_idea_candidates,
       icp_score inside operator_client_ideas) is what must keep deciding it.

   sortByScore is pure, so these cases need no Supabase stub.
   ========================================================================== */

type Row = { id: string }

function scoreRow(idea_ref: string, score: number | null, validated: boolean): IdeaScoreRow {
  return {
    idea_table: 'lm_idea_candidates', idea_ref, model_version: 'v1', stage: 'idea',
    score, validated, contributions: [], recommended_format: 'carousel', scored_at: '2026-09-24T00:00:00Z',
  }
}

function readOf(rows: IdeaScoreRow[], validated: boolean): IdeaScoreRead {
  return { ok: true, byRef: new Map(rows.map(r => [r.idea_ref, r])), validated }
}

const NO_SCORES: IdeaScoreRead = { ok: false, byRef: new Map(), validated: false }

describe('sortByScore', () => {
  const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('validated: sorts by score desc', () => {
    const scores = readOf(
      [scoreRow('a', 0.2, true), scoreRow('b', 0.9, true), scoreRow('c', 0.5, true)], true,
    )
    const out = sortByScore(rows, scores, r => r.id)
    expect(out.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('validated: rows with no score row keep their relative order at the tail', () => {
    // 'b' is scored, 'a' and 'c' are not — the input order between the two
    // unscored rows (a before c) must survive the sort.
    const scores = readOf([scoreRow('b', 0.4, true)], true)
    const out = sortByScore(rows, scores, r => r.id)
    expect(out.map(r => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('unvalidated: the array comes back unchanged, even with score rows present', () => {
    // Scores exist (the read succeeded) but validated=false — P4 W-W2 says
    // this must NOT reorder anything, only add a grey label at render time.
    const scores = readOf(
      [scoreRow('a', 0.2, false), scoreRow('b', 0.9, false), scoreRow('c', 0.5, false)], false,
    )
    const out = sortByScore(rows, scores, r => r.id)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('failed or empty read: the array comes back unchanged', () => {
    const out = sortByScore(rows, NO_SCORES, r => r.id)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('never mutates the input array', () => {
    const scores = readOf([scoreRow('a', 0.1, true), scoreRow('b', 0.9, true)], true)
    const original = [...rows]
    sortByScore(rows, scores, r => r.id)
    expect(rows).toEqual(original)
  })
})

describe('contributionsLine', () => {
  it('renders plain words with signed beta, most explanatory first as given', () => {
    const row = scoreRow('a', 0.4, true)
    row.contributions = [
      { indicator: 'format_carousel', beta: 0.4, words: 'carousel' },
      { indicator: 'angle_contrarian', beta: 0.3, words: 'contrarian' },
    ]
    expect(contributionsLine(row)).toBe('carousel +0.4 · contrarian +0.3')
  })

  it('falls back to the raw indicator when words is missing', () => {
    const row = scoreRow('a', 0.4, true)
    row.contributions = [{ indicator: 'has_number', beta: -0.2, words: null }]
    expect(contributionsLine(row)).toBe('has_number -0.2')
  })

  it('is null for a row with no contributions, or no row at all', () => {
    expect(contributionsLine(scoreRow('a', 0.4, true))).toBeNull()
    expect(contributionsLine(undefined)).toBeNull()
  })
})
