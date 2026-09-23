import type { EditorialClientId } from './editorialTypes.ts'

export type CallSpeakerRole = 'author' | 'third_party' | 'ambiguous'
export type CallAttributionState = 'verified' | 'ambiguous_speaker' |
  'ambiguous_multiple_segments' | 'unmatched_quote'

export type AttributedCallPassage = {
  candidate_id: string
  transcript_id: string
  transcript_sha256: string
  transcript_text_sha256: string
  transcript_json_sha256: string
  excerpt: string
  excerpt_sha256: string
  permission_state: 'granted' | 'unknown'
  transcript_source: string
  speaker_name: string | null
  speaker_role: CallSpeakerRole
  attribution_state: CallAttributionState
  segment_index: number | null
  segment_start: string | null
  segment_end: string | null
  quote_start: number | null
  quote_end: number | null
}

type RawSegment = { text: string; speaker: string; start: string | null; end: string | null }

const authorNames: Record<EditorialClientId, string[]> = {
  ivan: ['Ivan Manfredi'],
  risedtc: ['Mattan Danino'],
  arch: ['Davorin Smit'],
}

const normalized = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
const ambiguousSpeaker = /^(?:unattributed|unknown|speaker(?:\s+\d+)?|speaker\s*[a-z]|n\/a)?$/i

export function classifyCallSpeaker(clientId: EditorialClientId, speaker: unknown): CallSpeakerRole {
  const label = normalized(speaker)
  if (!label || ambiguousSpeaker.test(label)) return 'ambiguous'
  return authorNames[clientId].some(author => author.toLocaleLowerCase() === label.toLocaleLowerCase())
    ? 'author' : 'third_party'
}

function speakerName(raw: unknown) {
  if (typeof raw === 'string') return normalized(raw)
  if (!raw || typeof raw !== 'object') return ''
  const value = raw as Record<string, unknown>
  return normalized(value.display_name ?? value.name ?? value.label)
}

function segmentTime(raw: unknown) {
  if (raw == null || raw === '') return null
  return String(raw)
}

function transcriptSegments(transcriptJson: unknown, transcriptText: string): RawSegment[] {
  const value = transcriptJson && typeof transcriptJson === 'object'
    ? transcriptJson as Record<string, unknown> : null
  const rows = Array.isArray(transcriptJson) ? transcriptJson
    : value && Array.isArray(value.transcript) ? value.transcript : null
  if (rows) return rows.map(row => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    return { text: String(item.text ?? item.content ?? ''), speaker: speakerName(item.speaker ?? item.speaker_name),
      start: segmentTime(item.start ?? item.start_time ?? item.timestamp),
      end: segmentTime(item.end ?? item.end_time) }
  })
  return transcriptText.split(/\r?\n/).map(line => {
    const match = line.match(/^([^:]{1,80}):\s*(.*)$/)
    return { text: match?.[2] ?? '', speaker: normalized(match?.[1]), start: null, end: null }
  })
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const canonicalJson = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value) ?? 'null'
  : Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
    : `{${Object.keys(value as object).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
const transcriptBinding = (text: string, json: unknown) =>
  `${text}\n--TRANSCRIPT-JSON--\n${canonicalJson(json)}`
export const VERIFIED_PASSAGE_SEPARATOR = '\n\n[Verified separate passage from the same call]\n\n'

export async function extractCallQuoteAttributions(input: {
  clientId: EditorialClientId
  transcriptId: string
  transcriptSource: string
  transcriptSha256?: string
  transcriptText: string
  transcriptJson: unknown
  quotes: Array<{ candidateId: string; text: string; permissionState: 'granted' | 'unknown' }>
}): Promise<AttributedCallPassage[]> {
  const segments = transcriptSegments(input.transcriptJson, input.transcriptText)
  const [transcriptTextSha256, transcriptJsonSha256, transcriptSha256] = await Promise.all([
    sha256(input.transcriptText), sha256(canonicalJson(input.transcriptJson)),
    sha256(transcriptBinding(input.transcriptText, input.transcriptJson)),
  ])
  return Promise.all(input.quotes.map(async quote => {
    const matches = segments.flatMap((segment, segmentIndex) => {
      const offset = segment.text.indexOf(quote.text)
      return offset < 0 ? [] : [{ segment, segmentIndex, offset }]
    })
    const exact = matches.length === 1 ? matches[0] : null
    const role = exact ? classifyCallSpeaker(input.clientId, exact.segment.speaker) : 'ambiguous'
    const state: CallAttributionState = matches.length === 0 ? 'unmatched_quote'
      : matches.length > 1 ? 'ambiguous_multiple_segments'
        : role === 'ambiguous' ? 'ambiguous_speaker' : 'verified'
    return {
      candidate_id: quote.candidateId,
      transcript_id: input.transcriptId,
      transcript_sha256: transcriptSha256,
      transcript_text_sha256: transcriptTextSha256,
      transcript_json_sha256: transcriptJsonSha256,
      excerpt: quote.text,
      excerpt_sha256: await sha256(quote.text),
      permission_state: quote.permissionState,
      transcript_source: input.transcriptSource,
      speaker_name: exact ? exact.segment.speaker || null : null,
      speaker_role: role,
      attribution_state: state,
      segment_index: exact ? exact.segmentIndex : null,
      segment_start: exact?.segment.start ?? null,
      segment_end: exact?.segment.end ?? null,
      quote_start: exact ? exact.offset : null,
      quote_end: exact ? exact.offset + quote.text.length : null,
    }
  }))
}

/** Defense in depth for frozen manifests created before attribution enforcement.
 * Legacy or ambiguous calls remain visible as gaps, never usable passages. */
export async function projectSourceForSynthesis<T extends Record<string, unknown>>(source: T): Promise<T> {
  if (source.source_kind !== 'call') return source
  const fields = source.candidate_fields && typeof source.candidate_fields === 'object'
    ? source.candidate_fields as Record<string, unknown> : {}
  const attributions = Array.isArray(fields.passage_attributions)
    ? fields.passage_attributions as Array<Record<string, unknown>> : []
  const passage = typeof source.passage === 'string' ? source.passage : ''
  const topTranscriptHash = fields.transcript_sha256
  const topTextHash = fields.transcript_text_sha256
  const topJsonHash = fields.transcript_json_sha256
  const itemValidity = await Promise.all(attributions.map(async item => {
    const excerpt = typeof item.excerpt === 'string' ? item.excerpt : ''
    const start = item.quote_start
    const end = item.quote_end
    return (
    item.attribution_state === 'verified' && ['author', 'third_party'].includes(String(item.speaker_role)) &&
    typeof item.speaker_name === 'string' && item.speaker_name.trim() &&
    typeof item.transcript_sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.transcript_sha256) &&
    typeof item.transcript_text_sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.transcript_text_sha256) &&
    typeof item.transcript_json_sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.transcript_json_sha256) &&
    item.transcript_sha256 === topTranscriptHash && item.transcript_text_sha256 === topTextHash &&
    item.transcript_json_sha256 === topJsonHash &&
    typeof item.excerpt_sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.excerpt_sha256) &&
    Number.isInteger(item.segment_index) && Number.isInteger(start) && Number.isInteger(end) &&
    Number(start) >= 0 && Number(end) > Number(start) && Number(end) - Number(start) === excerpt.length &&
    await sha256(excerpt) === item.excerpt_sha256)
  }))
  const valid = attributions.length > 0 && itemValidity.every(Boolean) &&
    attributions.map(item => String(item.excerpt)).join(VERIFIED_PASSAGE_SEPARATOR) === passage &&
    typeof source.body_sha256 === 'string' && await sha256(passage) === source.body_sha256
  if (!valid) return { ...source, passage: null, body_sha256: null, permission_state: 'unknown',
    gap_state: { reason: 'partial', detail: 'Call passage is quarantined until exact speaker and quote-range attribution is verified.' },
    limitation: `${String(source.limitation ?? '').trim()} Call passage lacks verified speaker attribution and cannot support synthesis.`.trim(),
    candidate_fields: { ...fields, first_person_eligible: false, attribution_use: 'quarantined' } }
  const authorOnly = attributions.every(item => item.speaker_role === 'author')
  return { ...source, candidate_fields: { ...fields, first_person_eligible: authorOnly,
    attribution_use: authorOnly ? 'author_experience' : 'attributed_research_only' } }
}

export function callOwnerLabel(clientId: EditorialClientId, attributions: Array<Record<string, unknown>>) {
  const speakers = [...new Set(attributions.map(item => normalized(item.speaker_name)).filter(Boolean))]
  const lane = clientId === 'risedtc' ? 'RISE DTC' : clientId === 'arch' ? 'ARCH' : 'Ivan'
  return speakers.length === 1 ? `${speakers[0]}, on a private ${lane} call`
    : `Multiple attributed speakers on a private ${lane} call`
}
