import { describe, expect, it, vi } from 'vitest'
import { buildSynthesisCorrection, renderCanonicalPromptBodies } from './editorialSynthesisContext'
import { runSynthesis, SynthesisAttemptsFailed } from './editorialSynthesisRun'

describe('stateless synthesis corrections retain canonical voice', () => {
  const canon = renderCanonicalPromptBodies([{ id: 'lane-voice', slug: 'author-voice', version: 30,
    body: 'Speak plainly. No borrowed first-person stories.\n' + 'voice instruction\n'.repeat(6000) }])
  it('delivers exact canonical bytes and rejected evidence on the actual second provider call', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce({ raw: '{"invalid":true}', model: 'fixture' })
      .mockResolvedValueOnce({ raw: '{"valid":true}', model: 'fixture' })
    const result = await runSynthesis({
      messages: [{ role: 'system', content: canon }, { role: 'user', content: 'Evidence: original post A.' }],
      provider, correctionContext: 'Metric comments=0; views unknown.',
      buildCorrection: ({ raw, directive }) => buildSynthesisCorrection(canon,
        `Evidence: original post A.\nRejected JSON: ${raw}\n${directive}`),
      validate: async value => { if (!(value as { valid?: boolean }).valid) throw new Error('invalid shape'); return value },
    })
    const second = provider.mock.calls[1][0]
    expect(second[1].content).toContain(canon)
    expect(second[2].content).toContain('{"invalid":true}')
    expect(second[2].content).toContain('Metric comments=0; views unknown.')
    expect(result.attempts[1].messages).toEqual(second)
    expect(provider).toHaveBeenCalledTimes(2)
  })
  it('retains the failed attempt without dispatch when full correction cannot fit', async () => {
    const provider = vi.fn().mockResolvedValue({ raw: '{"invalid":true}', model: 'fixture' })
    let failure: unknown
    try {
      await runSynthesis({ messages: [{ role: 'user', content: 'initial' }], provider,
        correctionContext: '', validate: async () => { throw new Error('rejected') },
        buildCorrection: ({ raw }) => buildSynthesisCorrection(canon, raw + 'x'.repeat(200_000)) })
    } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(SynthesisAttemptsFailed)
    expect((failure as SynthesisAttemptsFailed).attempts[0].reply?.raw).toBe('{"invalid":true}')
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('refuses a canonical-reference-only correction', () => {
    expect(() => buildSynthesisCorrection('', 'voice row v30 still applies')).toThrow('canonical voice')
  })
})
