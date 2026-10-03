import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { DROP_REASONS, captureOrigin, reasonLabel, setVerdict } from './verdicts'

beforeEach(() => rpc.mockReset())

describe('verdicts', () => {
  it('Drop reasons end with Skip, and Skip is a reason slug the database accepts', () => {
    expect(DROP_REASONS.map(r => r[0])).toEqual(['invented_fact', 'not_my_voice', 'generic', 'wrong_topic', 'too_long', 'already_said', 'other', 'skip'])
    expect(reasonLabel('skip')).toBe('Skip')
  })

  it('setVerdict sends the time to verdict as p_ms_to_verdict, null when unknown', async () => {
    rpc.mockResolvedValue({ data: { draft_id: 'd1', verdict: 'edited', edit_chars: 12 }, error: null })
    const saved = await setVerdict('d1', 'keep', { msToVerdict: 4200, invocation: 'i' })
    expect(rpc).toHaveBeenCalledWith('cb39_verdict_set', { p_draft: 'd1', p_verdict: 'keep', p_reasons: [], p_note: null, p_invocation: 'i', p_ms_to_verdict: 4200 })
    expect(saved.verdict).toBe('edited')
    await setVerdict('d1', 'keep')
    expect(rpc.mock.calls[1][1].p_ms_to_verdict).toBeNull()
  })

  it('captureOrigin calls the rpc and throws on an error', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null })
    await expect(captureOrigin('d1')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('cb39_capture_origin', { p_draft: 'd1' })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(captureOrigin('d1')).rejects.toThrow('permission denied')
  })
})
