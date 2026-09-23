import { describe, it, expect } from 'vitest'
import { normalizeAuthorNote, type AuthorNoteInput } from './editorialAuthorNotes'
import { selectSynthesisSources } from './editorialSelection'
import { prepareSynthesisContext } from './editorialSynthesisContext'
import { buildSynthesisBriefs } from './editorialSynthesis'

// Synthetic fixture. Exact user confirmations belong in private evidence receipts.
const exactUserStatement = 'A test author confirmed tennis life and Poland as broad themes. Other personal material was discussed, but exact dates and stories remain unverified.'

const input: AuthorNoteInput = {
  clientId: 'ivan', author: 'Ivan Manfredi', noteId: 'tennis-poland-themes',
  originPointer: 'test-fixture:author-confirmation:personal-themes',
  originalUserStatement: exactUserStatement,
  observedAt: '2026-09-23T00:24:01Z', confirmedFields: ['Ivan discussed tennis life', 'Ivan discussed Poland', 'other personal material was discussed'],
  unknownFields: ['exact rank and dates', 'detailed stories, scenes or dialogue', 'routines and causal business lessons'],
}
describe('bounded private author notes', () => {
  it('retains only supplied broad fields with origin and publication holds', async () => {
    const s = await normalizeAuthorNote(input)
    expect(s.source_kind).toBe('author_note'); expect(s.source_client_scope).toBe('ivan')
    expect(s.source_published_at).toBeNull(); expect(s.permission_state).toBe('unknown')
    expect(s.passage).toBe(input.originalUserStatement)
    expect(s.candidate_fields?.author_note_contract).toMatchObject({ not_an_exact_story_quote: true,
      public_release_hold: true, original_session_recovered: false, confirmed_at: null,
      confirmed_fields: input.confirmedFields, unknown_fields: input.unknownFields })
    expect(s.passage).not.toMatch(/ranked|sponsorship|Minturno|2023/)
  })
  it('does not create a semantic revision on identical recapture', async () => {
    const a = await normalizeAuthorNote(input)
    const b = await normalizeAuthorNote({ ...input, observedAt: '2026-09-24T00:00:00Z' })
    expect(a.snapshot_hash).toBe(b.snapshot_hash); expect(a.captured_at).not.toBe(b.captured_at)
    const c = await normalizeAuthorNote({ ...input, confirmedFields: ['a different confirmed field'] })
    expect(c.snapshot_hash).not.toBe(a.snapshot_hash)
  })
  it('fails closed on absent origin or unqualified fields', async () => {
    await expect(normalizeAuthorNote({ ...input, originPointer: '' })).rejects.toThrow()
    await expect(normalizeAuthorNote({ ...input, unknownFields: [] })).rejects.toThrow()
    await expect(normalizeAuthorNote({ ...input, clientId: 'public' as never })).rejects.toThrow()
  })

  it('survives real selection and the rendered context with the complete limiting contract', async () => {
    const note = await normalizeAuthorNote(input)
    const selected = selectSynthesisSources([note], 1)
    const context = prepareSynthesisContext({ sources:selected.selected, outcomes:[],
      render: parts => [{ role:'user', content:JSON.stringify(parts.selected) }] })
    const contract = context.selected[0].candidate_fields?.author_note_contract as Record<string, unknown>
    expect(selected.selected[0].source_kind).toBe('author_note')
    expect(contract).toMatchObject({ original_user_statement:exactUserStatement,
      confirmed_fields:input.confirmedFields, unknown_fields:input.unknownFields,
      not_an_exact_story_quote:true, public_release_hold:true })
    expect(context.messages[0].content).toContain('public_release_hold')
    expect(context.messages[0].content).toContain(exactUserStatement)
  })

  it('keeps unknown author-note permission non-citable and adds an internal public-release hold', async () => {
    const note = await normalizeAuthorNote(input)
    const publicSource = { ...note, source_id:'public-proof', source_kind:'public_post' as const,
      passage:'A separately published source supports this factual sentence.',
      retained_context:'Published evidence.', permission_state:'public_source',
      candidate_fields:{ body_state:'full', source_identity:{ platform:'linkedin', native_id:'public-proof' } } }
    const suggestion = { source_ids:[note.source_id,publicSource.source_id], topic:'A personal-theme exploration',
      angle:'Explore a confirmed broad theme without filling in the missing story', hook:'A theme worth reviewing internally',
      objective:'Prepare an internal direction', intended_audience:'Ivan', why_now:'A broad theme was explicitly confirmed',
      structural_beats:['Name only the broad theme','List the missing detail'], missing_material:[], tone:'Candid',
      overlap_with_existing_content:'Unknown', novelty_reason:'Uses a newly retained theme confirmation', format:'text' as const,
      claims:[{ source_id:publicSource.source_id, supporting_quote:'separately published source',
        statement:'A separate published source exists.', allowed_phrasing:'A separate published source exists.',
        prohibited_inference:'Do not attribute details to the author note.', status:'fact' as const }], measurements:[],
      resource:{ asset_id:'',version:'',artifact_role:'',readiness:'not_needed' as const,access_route:'',permission_basis:'',
        required_missing_material:[],draft_state:'',public_catalog_state:'' },
      distribution:{ channel:'internal',cta:'No CTA proposed',route:'ungated' as const,fulfillment_requirements:[] },
      production:{ structure:'Theme and explicit gaps',required_materials:[],critical_constraints:[],effort_category:'low' },
      evaluation:{ primary_metric:'author review',secondary_metrics:[],comparator:'unknown',window:'before release',
        earliest_valid_observation:'after review',event_source_availability:'author review',attribution_limitations:'Theme only' } }
    const briefs = await buildSynthesisBriefs({ clientId:'ivan',batchId:'note',directionVersion:'1',
      sourceCutoff:'2026-09-23T00:24:01Z',sources:[note,publicSource] as never,suggestions:[suggestion] })
    expect(briefs[0].production.critical_constraints.join(' ')).toContain('Internal theme exploration only')
    expect(briefs[0].missing_material).toContain('Explicit author review and public-release authorization for author-note themes')
    await expect(buildSynthesisBriefs({ clientId:'ivan',batchId:'note-claim',directionVersion:'1',
      sourceCutoff:'2026-09-23T00:24:01Z',sources:[note] as never,
      suggestions:[{ ...suggestion,source_ids:[note.source_id],claims:[{ ...suggestion.claims[0],
        source_id:note.source_id,supporting_quote:'tennis life' }] }] })).rejects.toThrow(/reuse permission/)
  })
})
