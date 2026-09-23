import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeVerifiedCall } from './editorialCollectorBridge'
import { prepareSynthesisContext } from './editorialSynthesisContext'
import {
  classifyCallSpeaker,
  extractCallQuoteAttributions,
  projectSourceForSynthesis,
} from './editorialCallAttribution'

describe('call passage attribution', () => {
  const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  it('distinguishes the exact lane author from third-party and ambiguous speakers', () => {
    expect(classifyCallSpeaker('ivan', 'Ivan Manfredi')).toBe('author')
    expect(classifyCallSpeaker('risedtc', 'External Buyer')).toBe('third_party')
    expect(classifyCallSpeaker('arch', 'Davorin Smit')).toBe('author')
    expect(classifyCallSpeaker('ivan', 'External Buyer')).toBe('third_party')
    expect(classifyCallSpeaker('ivan', 'Unattributed')).toBe('ambiguous')
    expect(classifyCallSpeaker('arch', 'Speaker 10000')).toBe('ambiguous')
  })

  it('binds each quote to one exact JSON segment, speaker, range, and transcript hash', async () => {
    const transcriptJson = [
      { speaker: 'Mattan Danino', start: 4.25, end: 8.5, text: 'We changed the landing page.' },
      { speaker: 'Buyer Name', start: 9, end: 14, text: 'Our repeat orders are the difficult part.' },
    ]
    const result = await extractCallQuoteAttributions({
      clientId: 'risedtc', transcriptId: 'call-1', transcriptSource: 'fathom-risedtc',
      transcriptSha256: 'a'.repeat(64), transcriptText: 'retained transcript', transcriptJson,
      quotes: [{ candidateId: 'candidate-1', text: 'repeat orders', permissionState: 'unknown' }],
    })
    expect(result).toEqual([expect.objectContaining({
      candidate_id: 'candidate-1', transcript_id: 'call-1',
      excerpt: 'repeat orders', speaker_name: 'Buyer Name', speaker_role: 'third_party',
      attribution_state: 'verified', segment_index: 1, segment_start: '9', segment_end: '14',
      quote_start: 4, quote_end: 17,
    })])
  })

  it('changes the transcript binding when structured speaker evidence changes with identical text', async () => {
    const base = { clientId:'risedtc' as const, transcriptId:'call-binding', transcriptSource:'fathom-risedtc',
      transcriptText:'same rendered text', quotes:[{ candidateId:'c', text:'same quote', permissionState:'unknown' as const }] }
    const author = (await extractCallQuoteAttributions({ ...base,
      transcriptJson:[{ speaker:'Mattan Danino', text:'same quote' }] }))[0]
    const buyer = (await extractCallQuoteAttributions({ ...base,
      transcriptJson:[{ speaker:'Buyer Name', text:'same quote' }] }))[0]
    expect(author.transcript_text_sha256).toBe(buyer.transcript_text_sha256)
    expect(author.transcript_json_sha256).not.toBe(buyer.transcript_json_sha256)
    expect(author.transcript_sha256).not.toBe(buyer.transcript_sha256)
    expect([author.speaker_role, buyer.speaker_role]).toEqual(['author', 'third_party'])
  })

  it('parses speaker-prefixed transcript text conservatively and refuses duplicate matches', async () => {
    const base = {
      clientId: 'arch' as const, transcriptId: 'call-2', transcriptSource: 'fireflies-arch',
      transcriptSha256: 'b'.repeat(64), transcriptJson: { recording_id: 'recording-2' },
      quotes: [{ candidateId: 'candidate-2', text: 'specific example', permissionState: 'unknown' as const }],
    }
    expect((await extractCallQuoteAttributions({ ...base,
      transcriptText: 'Davorin Smit: Here is one specific example from delivery.\nOther Person: Different words.',
    }))[0]).toMatchObject({ speaker_name: 'Davorin Smit', speaker_role: 'author',
      attribution_state: 'verified', segment_index: 0, quote_start: 12, quote_end: 28 })
    expect((await extractCallQuoteAttributions({ ...base,
      transcriptText: 'Davorin Smit: specific example\nOther Person: specific example',
    }))[0]).toMatchObject({ speaker_name: null, speaker_role: 'ambiguous',
      attribution_state: 'ambiguous_multiple_segments' })
  })

  it('quarantines legacy and corrupt call heads before synthesis while preserving attributed buyer research', async () => {
    const legacy = await projectSourceForSynthesis({ source_id: 'urn:transcript:old', source_kind: 'call',
      passage: 'Legacy quote', limitation: 'Old call bundle', gap_state: null, candidate_fields: {} })
    expect(legacy).toMatchObject({ passage: null, gap_state: { reason: 'partial' } })
    expect(String(legacy.limitation)).toContain('speaker attribution')

    const excerpt = 'Buyer pain'
    const excerptHash = await digest(excerpt)
    const bodyHash = await digest(excerpt)
    const buyerFields = { transcript_sha256:'b'.repeat(64), transcript_text_sha256:'c'.repeat(64),
      transcript_json_sha256:'d'.repeat(64), passage_attributions: [{
        attribution_state: 'verified', speaker_name: 'Buyer Name', speaker_role: 'third_party',
        transcript_sha256: 'b'.repeat(64), transcript_text_sha256:'c'.repeat(64),
        transcript_json_sha256:'d'.repeat(64), excerpt, excerpt_sha256: excerptHash,
        segment_index: 3, quote_start: 0, quote_end: 10,
      }] }
    const buyer = await projectSourceForSynthesis({ source_id: 'call-3', source_kind: 'call', passage: excerpt,
      body_sha256: bodyHash, limitation: 'Internal only', gap_state: null, candidate_fields: buyerFields })
    expect(buyer.passage).toBe('Buyer pain')
    expect(buyer.candidate_fields).toMatchObject({ first_person_eligible: false,
      attribution_use: 'attributed_research_only' })

    for (const corrupt of [
      { passage:'Buyer pain altered' },
      { candidate_fields:{ ...buyerFields, passage_attributions:[{ ...buyerFields.passage_attributions[0], quote_end:0 }] } },
      { candidate_fields:{ ...buyerFields, passage_attributions:[{ ...buyerFields.passage_attributions[0], excerpt_sha256:'e'.repeat(64) }] } },
    ]) {
      const projected = await projectSourceForSynthesis({ source_id:'corrupt', source_kind:'call', passage:excerpt,
        body_sha256:bodyHash, limitation:null, gap_state:null, candidate_fields:buyerFields, ...corrupt })
      expect(projected).toMatchObject({ passage:null, candidate_fields:{ attribution_use:'quarantined' } })
      expect(projected.limitation).toContain('speaker attribution')
    }
  })

  it('normalizes only verified attributable passages and retains exact attribution in the source body contract', async () => {
    const source = await normalizeVerifiedCall('risedtc', [{
      candidate_id: 'candidate-1', transcript_id: 'call-4', transcript_date: '2026-09-01T10:00:00Z',
      transcript_sha256: 'd'.repeat(64), transcript_text_sha256:'f'.repeat(64),
      transcript_json_sha256:'a'.repeat(64), excerpt: 'A buyer described a real constraint.',
      excerpt_sha256: 'e'.repeat(64), permission_state: 'unknown', participants: ['Private Person'],
      transcript_source: 'fathom-risedtc', speaker_name: 'Buyer Name', speaker_role: 'third_party',
      attribution_state: 'verified', segment_index: 12, segment_start: '00:01:10', segment_end: null,
      quote_start: 0, quote_end: 34,
    }])
    expect(source.owner).toBe('Buyer Name, on a private RISE DTC call')
    expect(source.candidate_fields).toMatchObject({ first_person_eligible: false,
      attribution_use: 'attributed_research_only', passage_attributions: [expect.objectContaining({
        speaker_name: 'Buyer Name', speaker_role: 'third_party', segment_index: 12,
        quote_start: 0, quote_end: 34, transcript_sha256: 'd'.repeat(64),
      })] })
    expect(source.limitation).toContain('never first-person experience')
  })

  it('carries the exact attribution binding through the bounded model projection', () => {
    const binding = { candidate_id:'candidate-1', transcript_id:'call-5', transcript_sha256:'a'.repeat(64),
      transcript_text_sha256:'c'.repeat(64), transcript_json_sha256:'d'.repeat(64), excerpt:'Buyer words',
      excerpt_sha256:'b'.repeat(64), speaker_name:'Buyer Name', speaker_role:'third_party',
      attribution_state:'verified', segment_index:7, segment_start:'00:00:30', segment_end:null,
      quote_start:3, quote_end:14 }
    const result = prepareSynthesisContext({ sources: [{ source_id:'call-5', source_kind:'call',
      owner:'Buyer Name, on a private call', passage:'Buyer words', captured_at:'2026-09-01T00:00:00Z',
      candidate_fields:{ body_state:'excerpt', transcript_sha256:'a'.repeat(64),
        transcript_text_sha256:'c'.repeat(64), transcript_json_sha256:'d'.repeat(64),
        passage_attributions:[binding], first_person_eligible:false,
        attribution_use:'attributed_research_only', raw_context:'must not survive' } }], outcomes: [],
      render: parts => [{ role:'user', content:JSON.stringify(parts.selected) }] })
    expect(result.selected[0].candidate_fields).toMatchObject({ transcript_sha256:'a'.repeat(64),
      passage_attributions:[binding], first_person_eligible:false,
      attribution_use:'attributed_research_only' })
    expect(result.messages[0].content).toContain('attributed_research_only')
    expect(result.messages[0].content).not.toContain('must not survive')
    expect(result.selected[0].candidate_fields?.raw_context).toBeUndefined()
  })
})

const rawFixturePath = '../private/attribution-probe.json'
const sourceHeadsPath = '../private/current-call-source-heads.json'
const expectedFixturePath = '../private/attribution-expected.json'
const realFixture = existsSync(rawFixturePath) && existsSync(sourceHeadsPath) && existsSync(expectedFixturePath) ? it : it.skip

describe('real retained call fixture', () => {
  realFixture('reproduces the four known speaker findings without exposing transcript text', async () => {
    const probes = JSON.parse(readFileSync(rawFixturePath, 'utf8')) as Array<Record<string, unknown>>
    const heads = JSON.parse(readFileSync(sourceHeadsPath, 'utf8')) as Array<Record<string, unknown>>
    const expected = (JSON.parse(readFileSync(expectedFixturePath, 'utf8')) as {
      real_fixture: { findings: Record<string,string[]> }
    }).real_fixture.findings
    const laneBySource: Record<string, 'ivan' | 'risedtc' | 'arch'> = {
      'ivan-listener': 'ivan', 'fathom-risedtc': 'risedtc', 'fireflies-arch': 'arch',
    }
    const findings: Record<string, string[]> = {}
    for (const probe of probes) {
      const transcriptId = String(probe.id)
      const clientId = laneBySource[String(probe.source)]
      const head = heads.find(row => row.client_id === clientId && row.source_id === transcriptId)
      if (!head) continue
      const quotes = String(head.passage).split('\n\n[Verified separate passage from the same call]\n\n')
        .map((text, index) => ({ candidateId: `${transcriptId}:${index}`, text, permissionState: 'unknown' as const }))
      findings[transcriptId] = (await extractCallQuoteAttributions({ clientId, transcriptId,
        transcriptSource: String(probe.source), transcriptSha256: String(head.candidate_fields &&
          (head.candidate_fields as Record<string, unknown>).transcript_sha256),
        transcriptText: String(probe.transcript_text), transcriptJson: probe.transcript_json, quotes,
      })).map(item => `${item.speaker_name ?? 'null'}:${item.speaker_role}:${item.attribution_state}`)
    }
    for (const [transcriptId, expectedFindings] of Object.entries(expected))
      expect(findings[transcriptId]).toEqual(expectedFindings)
  })
})
