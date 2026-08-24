import { supabase } from './supabase'
import type { ContentLane } from './content'

// The Strategy tab's data layer (db/036_client_strategy.sql).
//
// One row per content lane, `client_id` = ContentLane, so this reuses the lane
// state Content/Magnets/Styles already share rather than inventing a second
// client vocabulary. Read-write: unlike Styles and Magnets, this surface is the
// ONLY writer of what it shows — nothing upstream generates a strategy, Ivan
// does. That is why the section body is an editable textarea and not a render.

export type StrategySection = {
  // Stable across renames: the title is editable, the key is what a future
  // consumer (a brief builder, a QA gate) would match on.
  key: string
  title: string
  body: string
}

export type ClientStrategy = {
  clientId: ContentLane
  sections: StrategySection[]
  updatedAt: string | null
}

// The shape a lane gets when its row does not exist yet — a lane added after
// this migration must not render as an error. Same six headings the seed uses.
export const STARTER_SECTIONS: StrategySection[] = [
  { key: 'buyer', title: 'Who we sell to', body: '' },
  { key: 'offer', title: 'What they sell', body: '' },
  { key: 'angles', title: 'Angles that convert', body: '' },
  { key: 'week', title: 'Week structure', body: '' },
  { key: 'never', title: 'Off-lane — never post this', body: '' },
  { key: 'open', title: 'Open / undecided', body: '' },
]

// jsonb round-trips as `unknown`; a hand-edited row (or a future writer) can put
// anything in it. Coerce rather than trust, so one malformed section renders as
// an empty section instead of blanking the whole tab.
function toSections(raw: unknown): StrategySection[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r, i) => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    return [{
      key: typeof o.key === 'string' && o.key ? o.key : `section-${i}`,
      title: typeof o.title === 'string' ? o.title : '',
      body: typeof o.body === 'string' ? o.body : '',
    }]
  })
}

export async function fetchStrategy(lane: ContentLane): Promise<ClientStrategy> {
  const { data, error } = await supabase
    .from('client_strategy')
    .select('client_id, sections, updated_at')
    .eq('client_id', lane)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { clientId: lane, sections: STARTER_SECTIONS, updatedAt: null }
  return {
    clientId: lane,
    sections: toSections(data.sections),
    updatedAt: data.updated_at ?? null,
  }
}

// Whole-document upsert. The tab saves one section at a time from the UI's point
// of view, but writes the full array: a partial jsonb path update would need the
// section's index, and the index moves when a section is added or removed.
export async function saveStrategy(
  lane: ContentLane, sections: StrategySection[],
): Promise<string> {
  const updatedAt = new Date().toISOString()
  const { error } = await supabase
    .from('client_strategy')
    .upsert(
      { client_id: lane, sections, updated_at: updatedAt },
      { onConflict: 'client_id' },
    )
  if (error) throw new Error(error.message)
  return updatedAt
}

// A section is "unwritten" when it holds nothing but the placeholder the seed
// left. The tab counts these so the head can say how much is still being flown
// blind, which is the whole reason the tab exists.
export function sectionIsBlank(s: StrategySection): boolean {
  const b = s.body.trim()
  return b === '' || b === 'TODO' || b.startsWith('TODO —') || b.startsWith('TODO -')
}

export function blankCount(sections: StrategySection[]): number {
  return sections.filter(sectionIsBlank).length
}

// Insert a new section directly after `afterKey` (end of list when null).
// Returns a NEW array; callers hold this in state and hand it to saveStrategy.
export function addSection(
  sections: StrategySection[], afterKey: string | null,
): StrategySection[] {
  // Key collision is possible (add, remove, add again), and two sections with
  // the same key would make React reuse the wrong textarea. Suffix until free.
  let key = 'note'
  let n = 1
  while (sections.some(s => s.key === key)) { n += 1; key = `note-${n}` }
  const next: StrategySection = { key, title: 'New section', body: '' }
  if (afterKey === null) return [...sections, next]
  const i = sections.findIndex(s => s.key === afterKey)
  if (i < 0) return [...sections, next]
  return [...sections.slice(0, i + 1), next, ...sections.slice(i + 1)]
}

export function removeSection(
  sections: StrategySection[], key: string,
): StrategySection[] {
  return sections.filter(s => s.key !== key)
}

export function updateSection(
  sections: StrategySection[], key: string, patch: Partial<StrategySection>,
): StrategySection[] {
  return sections.map(s => (s.key === key ? { ...s, ...patch } : s))
}

// ---------- line shapes (the typeset render) ----------
//
// Ivan, 2026-08-19: "you know what we're doing for each line, not this whole
// text. Format it much better." The hierarchy is INFERRED from the text so
// there is no markup to remember and no second format to keep in sync:
//
//   RUN OF CAPS — rest    'head'  a group heading
//   Label — value         'kv'    the label is the thing being decided
//   - item                'item'  a list item
//   anything else         'text'
//
// Pure and exported so the classification is testable in node; the component
// only decides what each shape looks like.
export const LABEL_SEP = ' — '

export type LineShape =
  | { kind: 'gap' }
  | { kind: 'head'; label: string; rest: string }
  | { kind: 'kv'; label: string; rest: string }
  | { kind: 'item'; text: string }
  | { kind: 'text'; text: string }

// Uppercase-only letters, but digits, spaces and separators pass, so
// "1 · THE INSTRUMENTED LANE" and "TRUST + REACH" both qualify. Two letters
// minimum, or a lone "A" would head its own line.
export function isCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, '')
  return letters.length >= 2 && letters === letters.toUpperCase()
}

export function lineShape(line: string): LineShape {
  if (!line.trim()) return { kind: 'gap' }

  // Checked BEFORE the separator, so "- Which ad made the sale — 61 calls"
  // stays one bullet instead of splitting into a label and a value.
  const item = /^[-*]\s+(.*)$/.exec(line)
  if (item) return { kind: 'item', text: item[1] }

  const i = line.indexOf(LABEL_SEP)
  if (i > 0) {
    const label = line.slice(0, i)
    const rest = line.slice(i + LABEL_SEP.length)
    return { kind: isCaps(label) ? 'head' : 'kv', label, rest }
  }

  if (isCaps(line)) return { kind: 'head', label: line, rest: '' }
  return { kind: 'text', text: line }
}

export function moveSection(
  sections: StrategySection[], key: string, dir: -1 | 1,
): StrategySection[] {
  const i = sections.findIndex(s => s.key === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= sections.length) return sections
  const out = [...sections]
  const [row] = out.splice(i, 1)
  out.splice(j, 0, row)
  return out
}

// ---- Live ICP filter spec (db/043_filter_spec.sql) --------------------------
// PUBLISHED BY THE ENGINE, never authored here. Every gate lives in n8n jsCode;
// a hand-kept copy in the app would be a second source of truth and would drift
// the first time someone edits a regex. The harvest node writes what it actually
// ran with on every run, so this surface cannot be newer or older than the engine.
//
// The row shape is intentionally loose. Adding a gate in n8n must not require an
// app change or a migration, so the UI groups and prints whatever arrives.
export type FilterRule = { group: string; label: string; value?: string; rule?: string; note?: string }
export type FilterSpec = { client_id: string; run_tag: string; captured_at: string; spec: FilterRule[] }

// Soft-fails to [] like fetchReplacement: one missing relation must not take the
// Strategy tab down with it.
export async function fetchFilterSpec(): Promise<FilterSpec[]> {
  const { data, error } = await supabase
    .from('inbox_filter_spec_v').select('*').order('captured_at', { ascending: false })
  if (error) return []
  return (data ?? []) as FilterSpec[]
}
