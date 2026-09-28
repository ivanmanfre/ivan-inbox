/* ==========================================================================
   CB-19 P4(b) REACH-SLOT BANDIT CHIP — a read-only decoration on Ivan's idea
   surface (lm_idea_candidates via IdeasSection, client_ideas via
   ClientIdeasSection), showing which idea (if any) the reach-slot bandit
   recommended for the week and which slot is the personal floor.

   D2 grant (CB-19 DECISIONS.md): "the inbox chip reading
   cb19_bandit_assignments." The RPC is `cb19_bandit_chip(p_gate, p_client_id,
   p_week_start default null)` — SECURITY DEFINER, operator_gate_ok +
   lane_allowed, the same shape as `operator_idea_scores` (see ideaScores.ts).
   It does NOT exist live until CB-19's DDL/fn are applied (after Monday's
   PREREG-BANDIT freeze + H2-bandit apply window); every call before then
   fails with an undefined-function error and this module must swallow it
   exactly like a network error.

   Same fail-soft contract as ideaScores.ts, stated once more because it is
   the entire safety case for shipping this ahead of the RPC existing:
     · fetchBanditChip never rejects — any error, absent function, non-object
       payload or empty read comes back `{ ok: false }`;
     · nothing here ever reorders, filters, or writes; it only ever adds a
       line of text next to an idea that already rendered.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'
import { weekStartOf } from './reach'

export type BanditArm = 'A' | 'B' | 'C'

export type BanditIdea = {
  ideaTable: string
  ideaRef: string
  arm: BanditArm
  armName: string
  slotIndex: number
  weekdayHint: string | null
}

export type BanditSlot = {
  slotIndex: number
  personalFloor: boolean
  arm: string | null
  armName: string | null
  weekdayHint: string | null
}

export type BanditChipRead = {
  ok: boolean
  weekStart: string | null
  /** idea_ref -> row, already narrowed to the requested idea_table. */
  byRef: ReadonlyMap<string, BanditIdea>
  /** Every slot for the week (including the personal floor), for the one
      channel-level note; never per-row. */
  slots: readonly BanditSlot[]
}

const EMPTY_CHIP: BanditChipRead = { ok: false, weekStart: null, byRef: new Map(), slots: [] }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function isArm(v: unknown): v is BanditArm {
  return v === 'A' || v === 'B' || v === 'C'
}

function toIdea(raw: unknown): BanditIdea | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ideaTable = str(r.idea_table)
  const ideaRef = str(r.idea_ref)
  const slotIndex = num(r.slot_index)
  if (ideaTable === null || ideaRef === null || !isArm(r.arm) || slotIndex === null) return null
  return { ideaTable, ideaRef, arm: r.arm, armName: str(r.arm_name) ?? r.arm, slotIndex, weekdayHint: str(r.weekday_hint) }
}

function toSlot(raw: unknown): BanditSlot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const slotIndex = num(r.slot_index)
  if (slotIndex === null) return null
  return { slotIndex, personalFloor: r.personal_floor === true, arm: str(r.arm), armName: str(r.arm_name), weekdayHint: str(r.weekday_hint) }
}

/** Monday 00:00 UTC of the CURRENT ISO week, as YYYY-MM-DD. The inbox always
    passes this explicitly (H2-bandit finding F8): the RPC's own
    `p_week_start` default resolves to the earliest PRODUCTION week
    `>= the current ISO Monday`, which is ambiguous once the Tuesday 08:47 UTC
    cron has drawn next week's assignments (both weeks then have production
    rows). Passing the current week's Monday explicitly means the chip always
    shows the week that is open now, never jumps ahead under Ivan's feet the
    moment Tuesday's cron fires. */
export function currentIsoWeekMonday(now: number = Date.now()): string {
  return weekStartOf(new Date(now).toISOString()) as string
}

/** Reads one lane's bandit chip data for the week, narrowed to one idea
    table. Never throws: before CB-19's apply the RPC does not exist
    (undefined function / PostgREST 404) and this returns `{ ok: false }`
    exactly as it will for any later network error or empty week. */
export async function fetchBanditChip(
  lane: ContentLane,
  ideaTable: 'lm_idea_candidates' | 'client_ideas',
  weekStart: string = currentIsoWeekMonday(),
): Promise<BanditChipRead> {
  try {
    const { data, error } = await supabase.rpc('cb19_bandit_chip', {
      p_gate: CLIENT_OPS_GATE, p_client_id: lane, p_week_start: weekStart,
    })
    if (error || !data || typeof data !== 'object') return EMPTY_CHIP
    const d = data as Record<string, unknown>
    const ideas = Array.isArray(d.ideas) ? d.ideas.map(toIdea).filter((i): i is BanditIdea => i !== null) : []
    const slots = Array.isArray(d.slots) ? d.slots.map(toSlot).filter((s): s is BanditSlot => s !== null) : []
    const rows = ideas.filter(i => i.ideaTable === ideaTable)
    if (rows.length === 0 && slots.length === 0) return EMPTY_CHIP
    return { ok: true, weekStart: str(d.week_start), byRef: new Map(rows.map(i => [i.ideaRef, i])), slots }
  } catch {
    return EMPTY_CHIP
  }
}

const ARM_WORDS: Record<string, string> = { recipe_top: 'recipe top', editor_pick: 'editor pick', tail: 'tail' }

/** "Reach test: arm A (recipe top), slot 2" — plain words, no verdict
    vocabulary, no em dashes. Null for an idea with no bandit recommendation
    this week (the common case, and the only case before CB-19 applies). */
export function banditChipLine(row: BanditIdea | undefined): string | null {
  if (!row) return null
  const word = ARM_WORDS[row.armName] ?? row.armName.replace(/_/g, ' ')
  return `Reach test: arm ${row.arm} (${word}), slot ${row.slotIndex}`
}

/** "Personal floor" — the one slot per client-week that is Ivan's own pick
    from the whole bank, never an arm recommendation (the bandit draw stamps
    it with no specific idea). Shown once per channel, not per row: unlike an
    arm pick, the floor names no idea to tag. Null when the week has no
    stamped floor (no chip data, or a week not yet drawn). */
export function personalFloorLine(slots: readonly BanditSlot[]): string | null {
  return slots.some(s => s.personalFloor) ? 'Personal floor' : null
}
