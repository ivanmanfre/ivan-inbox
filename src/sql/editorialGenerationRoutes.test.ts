import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const candidateRoot = '../private/generation-candidates'
const load = (name: string) => JSON.parse(readFileSync(`${candidateRoot}/${name}`, 'utf8'))
const node = (workflow: any, name: string) => workflow.nodes.find((entry: any) => entry.name === name)

describe('staged generation-route repairs', () => {
  it('pins candidates to the fresh workflow identities', () => {
    const lead = load('lead-magnets.candidate.json')
    const video = load('video-script.candidate.json')
    expect([lead.id, lead.versionId]).toEqual(['XQSUuQH2e4YVwLCB', '9bb6a20e-f84e-4812-aadf-de6335be50f4'])
    expect([video.id, video.versionId]).toEqual(['EirEHrbgfN00JDa7', 'b32a2042-8d28-4f97-8cdc-889be584782c'])
  })

  it.each([
    ['Editorial Promo QA', 'Editorial Promo Persist'],
    ['Editorial Resource QA', 'Editorial Resource Persist'],
  ])('binds %s to transport identity and atomically completes exact reviewed bytes', (qaName, persistName) => {
    const workflow = load('lead-magnets.candidate.json')
    const qa = node(workflow, qaName).parameters.jsCode
    const persist = node(workflow, persistName).parameters.jsCode
    expect(qa).toContain('response.id')
    expect(qa).toContain("reviewer_provenance:'provider_response'")
    expect(qa).toContain("decision==='pass'&&result.final_copy===candidate")
    expect(qa).toContain("decision==='revised'?'needs_regenerate'")
    expect(persist).toContain('/rpc/editorial_complete_native_draft')
    expect(persist).toContain('p_final_copy:q.reviewed_copy')
    expect(persist).not.toContain("method:'PATCH'")
  })

  it('routes editorial video around the legacy raw writer and through atomic completion', () => {
    const workflow = load('video-script.candidate.json')
    const qa = node(workflow, 'Editorial Video QA').parameters.jsCode
    const complete = node(workflow, 'Editorial Video Complete').parameters.jsCode
    expect(qa).toContain("decision==='pass'&&qa.final_script===prior.script")
    expect(qa).toContain("decision==='revised'?'needs_regenerate'")
    expect(complete).toContain('/rpc/editorial_complete_native_draft')
    expect(complete).not.toContain("method:'PATCH'")
    expect(workflow.connections['Editorial Video?'].main[0][0].node).toBe('Editorial Video Complete')
    expect(workflow.connections['Editorial Video?'].main[1][0].node).toBe('Update Video Idea')
  })

  it('ships byte-verifiable TypeScript patch mirrors for review', () => {
    for (const stem of ['lead-magnets', 'video-script']) {
      const json = readFileSync(`${candidateRoot}/${stem}.candidate.json`)
      const receipt = load(`${stem}.candidate.receipt.json`)
      expect(createHash('sha256').update(json).digest('hex')).toBe(receipt.candidate_sha256)
      expect(readFileSync(`${candidateRoot}/${stem}.node-patches.ts`, 'utf8')).toContain(receipt.candidate_sha256)
    }
  })
})
