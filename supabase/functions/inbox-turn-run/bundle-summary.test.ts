import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBundle } from '../inbox-bot-tick/bundle'
import { canSummarize, startSummary, summarizeBundle } from './bundle-summary'

const now = Date.parse('2026-11-25T15:00:00Z')
const prompt = buildBundle([
  { id: 'one', family: 'review', severity: 'attention', tenant: 'rise', title: 'Review the scan', body: 'Content change', created_at: '2026-11-25' },
  { id: 'two', family: 'post', severity: 'info', tenant: 'ivan', title: 'Tuesday post saved', created_at: '2026-11-25' },
], 'Earlier text must stay out of this request.').text
const row = { origin: 'bot', status: 'running', created_at: new Date(now - 1000).toISOString(), prompt }
const callback = { model: '<synthetic>', is_error: true, returncode: 1, num_turns: 1, total_cost_usd: 0, tool_events: [],
  result: "Claude Code can't use your Claude subscription, usually because a payment is past due · Pay or renew at https://claude.ai/settings/billing (if you just paid, try again shortly), or use an Anthropic API key instead" }

afterEach(() => vi.useRealTimers())
describe('scheduled notification-only provider recovery', () => {
  it('accepts only an immediate, untouched synthetic refusal on the live scheduled turn', () => {
    expect(canSummarize(row, callback, now)).toBe(true)
    for (const change of [{ origin: 'operator' }, { status: 'error' }, { status: 'done' }, { status: 'aborted' },
      { error_code: 'bot_bundle_summary_pending' }, { answer: 'Partial answer.' }, { prompt: 'Go publish the post' }]) {
      expect(canSummarize({ ...row, ...change }, callback, now)).toBe(false)
    }
    for (const change of [{ model: 'claude-sonnet-5-5' }, { result: callback.result + '\nI already sent it.' },
      { result: 'timed out' }, { num_turns: 2 }, { total_cost_usd: 0.02 }, { tool_events: [{ name: 'Write' }] }, { tool_events: undefined }]) {
      expect(canSummarize(row, { ...callback, ...change }, now)).toBe(false)
    }
    expect(canSummarize(row, callback, now + 300_000)).toBe(false)
  })

  it('uses the returned model and only displays a selected source headline', async () => {
    const request = vi.fn(async () => Response.json({ type: 'message', provider: 'codex', model: 'gpt-6.2-sol',
      content: [{ type: 'text', text: '[2]' }] }))
    const result = await summarizeBundle(prompt, 'https://test.invalid', 'unreal', request)
    expect(result).toMatchObject({ provider: 'codex', model: 'gpt-6.2-sol', answer: 'From your notifications:\n\n• ivan · Tuesday post saved' })
    const content = JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(content.messages[0].content).toContain('Review the scan')
    expect(content.messages[0].content).not.toContain('Earlier text')
    expect(content.tools).toBeUndefined()
  })

  it('rejects model prose, malformed selections and out-of-range headlines', async () => {
    for (const value of ['I sent it', '[1,1]', '[3]', '["1"]']) {
      const fake = async () => Response.json({ type: 'message', provider: 'codex', model: 'gpt-6.2-sol', content: [{ type: 'text', text: value }] })
      await expect(summarizeBundle(prompt, 'https://test.invalid', 'unreal', fake)).rejects.toThrow()
    }
  })

  it('acknowledges immediately and admits only one summary across a 35-second retry', async () => {
    vi.useFakeTimers()
    let claimed = false
    const claim = async () => { if (claimed) return false; claimed = true; return true }
    const commits = vi.fn()
    const run = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 45_000)); commits() })
    const held: Promise<void>[] = []
    const enqueue = (p: Promise<void>) => { held.push(p) }
    expect(await startSummary(claim, run, enqueue)).toBe(true)
    expect(commits).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(35_000)
    expect(await startSummary(claim, run, enqueue)).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all(held)
    expect(run).toHaveBeenCalledTimes(1)
    expect(commits).toHaveBeenCalledTimes(1)
  })
})
