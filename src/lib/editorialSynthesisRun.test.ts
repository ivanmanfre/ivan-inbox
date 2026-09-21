import { describe, expect, it, vi } from 'vitest'
import { runSynthesis, SynthesisAttemptsFailed } from './editorialSynthesisRun'
const messages = [{ role: 'user', content: 'Exact input' }]
describe('bounded synthesis correction', () => {
  it('retains rejected reply and sends exact error before accepting whole corrected batch', async () => {
    const provider = vi.fn().mockResolvedValueOnce({raw:'{"metric":"m (label)"}',model:'local',response_id:'one'})
      .mockResolvedValueOnce({raw:'{"metric":"m"}',model:'local',response_id:'two'})
    const result = await runSynthesis({messages,correctionContext:'Allowed: m',provider,
      validate:async (v: unknown)=>{if ((v as {metric:string}).metric!=='m') throw Error('metric key differs');return v}})
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0].validation_error).toBe('metric key differs')
    expect(provider.mock.calls[1][0][1].content).toBe('{"metric":"m (label)"}')
    expect(provider.mock.calls[1][0][2].content).toContain('metric key differs')
    expect(result.reply.response_id).toBe('two')
  })
  it('shares the same two-attempt budget across transport and content failure', async () => {
    const provider=vi.fn().mockRejectedValueOnce(Error('network timeout')).mockResolvedValueOnce({raw:'not JSON',model:'local'})
    try {await runSynthesis({messages,correctionContext:'',provider,validate:async v=>v});throw Error('unexpected accept')}
    catch (e) {expect(e).toBeInstanceOf(SynthesisAttemptsFailed);expect((e as SynthesisAttemptsFailed).attempts).toHaveLength(2)}
    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls[1][0]).toEqual(messages)
  })
  it('does not call provider when correction would exceed the input ceiling',async()=>{
    const provider=vi.fn().mockResolvedValue({raw:JSON.stringify({x:'x'.repeat(199990)}),model:'local'})
    await expect(runSynthesis({messages,correctionContext:'',provider,validate:async()=>{throw Error('reject')}})).rejects.toThrow('200000')
    expect(provider).toHaveBeenCalledTimes(1)
  })
})
