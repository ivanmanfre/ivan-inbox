import type { EditorialClientId } from './editorialTypes.ts'
import type { NormalizedSnapshot } from './editorialCollectorBridge.ts'

export type AuthorNoteInput = {
  clientId: EditorialClientId; author: string; noteId: string
  originPointer: string; originalUserStatement: string; observedAt: string
  confirmedFields: string[]; unknownFields: string[]
}
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(x => x.toString(16).padStart(2, '0')).join('')

/** Exact user confirmation, with field-specific limits. The confirmation is
 * original evidence of broad themes, not the unavailable detailed story. */
export async function normalizeAuthorNote(input: AuthorNoteInput): Promise<NormalizedSnapshot> {
  if (!['ivan', 'risedtc', 'arch'].includes(input.clientId) || !input.author.trim() ||
      !input.noteId.trim() || !input.originPointer.trim() || !input.originalUserStatement.trim() ||
      !Number.isFinite(Date.parse(input.observedAt)) || !input.confirmedFields.length ||
      !input.unknownFields.length || [...input.confirmedFields, ...input.unknownFields].some(x => !x.trim())) {
    throw new Error('Author note requires exact scope, origin, confirmed fields and explicit unknowns')
  }
  const passage = input.originalUserStatement
  const contract = {
    origin_state: 'user_confirmed_themes', origin_pointer: input.originPointer,
    original_user_statement: input.originalUserStatement, original_session_recovered: false,
    confirmed_at: null, confirmed_fields: input.confirmedFields, unknown_fields: input.unknownFields,
    passage_is_exact_confirmation: true, not_an_exact_story_quote: true, public_release_hold: true,
    prohibited_inferences: ['exact rank or dates', 'invented scenes or dialogue', 'unrecorded routines', 'causal business lessons'],
  }
  const source: Omit<NormalizedSnapshot, 'snapshot_hash'> = {
    client_id: input.clientId, source_id: `author-note:${input.clientId}:${input.noteId}`,
    seen_version: 1, source_kind: 'author_note', source_client_scope: input.clientId,
    source_url: null, excerpt_pointer: input.originPointer, owner: input.author,
    source_published_at: null, published_date_state: 'unknown', captured_at: input.observedAt,
    body_sha256: await sha(passage), passage, retained_context: 'The original detailed session is unavailable. Only the explicitly confirmed broad themes are usable.',
    limitation: 'Theme-level personal material only. No exact quotation, event chronology or inferred lesson. Public release requires author review.',
    independent: true, derived_from: null, permission_state: 'unknown',
    // The complete original here is the user's confirmation, not the missing
    // detailed session. It supplies no market-performance observation.
    gap_state: null,
    candidate_fields: { body_state: 'full', author_note_contract: contract,
      body_provenance: 'exact explicit user confirmation in current task',
      source_identity: { platform: 'private_author_note', author: input.author } },
  }
  // Capture time is provenance, not a semantic revision. An identical replay
  // retains the first immutable version rather than manufacturing a new source.
  return { ...source, snapshot_hash: await sha(JSON.stringify({ ...source, captured_at: undefined })) }
}
