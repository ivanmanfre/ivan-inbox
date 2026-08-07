import { describe, expect, it } from 'vitest'
import {
  draftFacetsActive, ideasIsOpen, toggleIdeasOpen, withoutDecided,
  stagesWriteBase, STAGES_TOUCHED,
} from './contentIdeas'
import { projectSectionState } from '../../lib/sectionState'

// The D1 contract, pinned at its only seam.
//
// The ideas band renders lm_idea_candidates; the facets and the search box run
// over carousel_drafts. Nothing joins the two, so while a draft facet is set the
// band cannot be narrowed by it and must not sit on top of the rows the filter
// DID find — the shipped surface reported "9 of 224 drafts shown" with all 74
// idea rows still above the first review card, at y≈5,156.
//
// This is the predicate the hide is driven by. It is deliberately the SAME one
// the FilteredEmpty escape sits behind, so "the band is down to its header" and
// "the filter found nothing" can never disagree.
describe('draftFacetsActive — what hides the ideas band', () => {
  it('is false on a clean lane, so the band renders its rows', () => {
    expect(draftFacetsActive({}, '')).toBe(false)
  })

  it('is true for the stage facet — the reported case (Stage: Needs review)', () => {
    expect(draftFacetsActive({ stage: 'review' }, '')).toBe(true)
  })

  it('is true for every other draft facet, not just stage', () => {
    for (const k of ['kind', 'pillar', 'source', 'qa_verdict']) {
      expect(draftFacetsActive({ [k]: 'anything' }, '')).toBe(true)
    }
  })

  it('is true for the free-text search, which cannot reach an idea either', () => {
    expect(draftFacetsActive({}, 'linkedin')).toBe(true)
  })

  it('treats a whitespace-only search as no filter — it narrows nothing', () => {
    expect(draftFacetsActive({}, '   ')).toBe(false)
  })

  it('ignores a facet key that was cleared to an empty value', () => {
    // contentFilters deletes a cleared key, but a persisted entry from an older
    // build can still carry one; an empty value hides no row and must hide no
    // band either.
    expect(draftFacetsActive({ stage: '' }, '')).toBe(false)
    expect(draftFacetsActive({ stage: '', pillar: 'personal' }, '')).toBe(true)
  })
})

// D2 — the ideas band's open flag rides in the persisted `open` array, and the
// thing that makes it non-trivial is that the array already carries the stage
// sections' answer.
describe('ideasIsOpen / toggleIdeasOpen', () => {
  it('defaults OPEN on a browser that has never touched anything', () => {
    expect(ideasIsOpen([])).toBe(true)
  })

  it('🔴 stays OPEN for a browser that decided about STAGES only', () => {
    // The pre-existing entry: the stages' own TOUCHED sentinel, no ideas key.
    // Reading that as "closed" would silently reverse Ivan's 2026-08-04
    // default-open ruling on every install that already used the surface.
    expect(ideasIsOpen(['approved', 'error', 'generating', 'review', 'touched'])).toBe(true)
  })

  it('round-trips a collapse and an expand', () => {
    const closed = toggleIdeasOpen([])
    expect(ideasIsOpen(closed)).toBe(false)
    expect(ideasIsOpen(toggleIdeasOpen(closed))).toBe(true)
  })

  it('leaves the stage sections’ own answer alone', () => {
    const stages = ['review', 'scheduled', 'touched']
    const closed = toggleIdeasOpen(stages)
    for (const s of stages) expect(closed).toContain(s)
  })

  it('survives the storage projection — both sentinels are storable keys', () => {
    // sectionState drops anything that is not an identifier, silently. A
    // sentinel it refuses is a collapse that never persists, which is the
    // defect this fix exists for.
    const closed = toggleIdeasOpen(['review', 'touched'])
    expect(projectSectionState({ open: closed }).open.sort()).toEqual([...closed].sort())
    expect(ideasIsOpen(projectSectionState({ open: closed }).open)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

// 🔴 THE OTHER DIRECTION — one array, two writers, and the order they are used
// in must not matter. `toggleIdeasOpen` was tested against a browser that had
// already decided about stages; this is the mirror, the one that was broken:
// the ideas band written FIRST, the stage sections rebuilding the array LATER.
//
// `stagesWrite` below is useOpenStages' write (ContentList.tsx), verbatim — the
// hook is a hook, but its write is this one composition, and the drop lived in
// the base it rebuilds from.
describe('stagesWriteBase — the stage sections cannot wipe the ideas answer', () => {
  const DEFAULT_OPEN = ['review', 'generating', 'approved', 'scheduled', 'error']
  const stagesWrite = (cur: string[], next: (c: string[]) => string[], initial = DEFAULT_OPEN) =>
    [...next(stagesWriteBase(cur, initial)), STAGES_TOUCHED]
  const toggleStage = (s: string) => (cur: string[]) =>
    cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]

  it('🔴 keeps a band collapsed through the FIRST-EVER stage toggle', () => {
    // The reported sequence: collapse the ideas band (74 rows), then later
    // collapse a stage section for the first time. The stages' rebuild starts
    // from DEFAULT_OPEN because their own sentinel is not there yet — and used
    // to drop `ideas_touched` with it, reopening the band on the next render.
    const afterIdeas = toggleIdeasOpen([])
    expect(ideasIsOpen(afterIdeas)).toBe(false)
    const afterStage = stagesWrite(afterIdeas, toggleStage('review'))
    expect(ideasIsOpen(afterStage)).toBe(false)
  })

  it('keeps an explicitly REOPENED band open through that same first toggle', () => {
    // The mirror of the mirror: a band closed and reopened carries `ideas` too,
    // and both keys have to make the trip or the next toggle re-decides it.
    const reopened = toggleIdeasOpen(toggleIdeasOpen([]))
    expect(ideasIsOpen(reopened)).toBe(true)
    const after = stagesWrite(reopened, toggleStage('review'))
    expect(after).toContain('ideas')
    expect(after).toContain('ideas_touched')
  })

  it('still gives the STAGES their default answer on that first toggle', () => {
    // The carried keys are the band's, not the stages': the rebuild is still
    // DEFAULT_OPEN minus whatever was just toggled, and an ideas key must never
    // be read as an open section.
    const after = stagesWrite(toggleIdeasOpen([]), toggleStage('review'))
    expect(after.filter(x => !x.startsWith('ideas') && x !== STAGES_TOUCHED).sort())
      .toEqual(['approved', 'error', 'generating', 'scheduled'])
  })

  it('invents no ideas key for a browser that only ever touched stages', () => {
    // The 08-04 default-open ruling: absence means OPEN, so the rebuild must
    // not manufacture `ideas_touched` out of a stage toggle.
    const after = stagesWrite([], toggleStage('review'))
    expect(after.some(x => x.startsWith('ideas'))).toBe(false)
    expect(ideasIsOpen(after)).toBe(true)
  })

  it('survives in the OTHER order too — stages first, then the band', () => {
    const afterStage = stagesWrite([], toggleStage('review'))
    const afterIdeas = toggleIdeasOpen(afterStage)
    expect(ideasIsOpen(afterIdeas)).toBe(false)
    expect(afterIdeas).toContain(STAGES_TOUCHED)
    // …and a SECOND stage toggle after that keeps both answers.
    const again = stagesWrite(afterIdeas, toggleStage('approved'))
    expect(ideasIsOpen(again)).toBe(false)
    expect(again).not.toContain('approved')
    expect(again).toContain('generating')
  })

  it('round-trips the interleaved answer through storage', () => {
    // Same projection gate as above: a key storage refuses is an answer that
    // never survives the reload, which is the defect class this whole entry is.
    const interleaved = stagesWrite(toggleIdeasOpen([]), toggleStage('review'))
    const stored = projectSectionState({ open: interleaved }).open
    expect(ideasIsOpen(stored)).toBe(false)
    expect(stored).toContain(STAGES_TOUCHED)
    expect([...stored].sort()).toEqual([...new Set(interleaved)].sort())
  })
})

// ---------------------------------------------------------------------------

// The optimistic half of approve/reject. A decided row leaves `reviewing` for
// real, but the refetch behind it takes a round trip — and approve waits on the
// n8n promote run before the status is even stamped, so the row would sit there
// clickable for seconds on an act that fires a pipeline.
describe('withoutDecided — the row leaves the band on the click', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('returns the SAME array when nothing has been decided (no copy per render)', () => {
    expect(withoutDecided(rows, new Set())).toBe(rows)
  })

  it('drops only the decided ids, and keeps the order of the rest', () => {
    expect(withoutDecided(rows, new Set(['b']))).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  it('can empty the band — the header counts read the same filtered array', () => {
    expect(withoutDecided(rows, new Set(['a', 'b', 'c']))).toEqual([])
  })

  it('ignores an id that is not in the band, rather than throwing', () => {
    expect(withoutDecided(rows, new Set(['zz']))).toEqual(rows)
  })

  // 🔴 content.ts:329 bans keying UI state on an idea id ACROSS refreshes,
  // because an idea's identity comes from the LLM's own title and a re-worded
  // re-ingest is a different row. That ban is why this is safe: the re-ingest
  // arrives under a NEW id, so a decision can never hide it.
  it('cannot hide a re-ingest — a new id is a new row', () => {
    const reingested = [{ id: 'a2' }, { id: 'c' }]
    expect(withoutDecided(reingested, new Set(['a']))).toEqual(reingested)
  })
})
