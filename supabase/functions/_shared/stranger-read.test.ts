import { describe, expect, it } from 'vitest'
import { buildStrangerBody, combine, READS, readStranger, type ReadResult } from './stranger-read.ts'

// The pure parts of content-stranger-read (db/20261114f_content_stranger_read). No proxy, no DB.
const text = (t: string) => ({ content: [{ type: 'text', text: t }] })
const pass = (topic = 'Post length studies disagree, so check your own history.'): ReadResult =>
  ({ ok: true, read: { verdict: 'pass', topic, missing: '', blocking: [] } })
const fail = (missing = 'The stranger never sees the DM.'): ReadResult =>
  ({ ok: true, read: { verdict: 'fail', topic: 'Answer jargon with a yes.', missing, blocking: ['What did the DM say?'] } })

describe('readStranger', () => {
  it('reads a clean pass and a clean fail', () => {
    expect(readStranger(text('{"topic":"A point.","blocking":[],"verdict":"pass","missing":""}'))).toEqual(
      { ok: true, read: { verdict: 'pass', topic: 'A point.', missing: '', blocking: [] } })
    const r = readStranger(text('Here: {"topic":"T","blocking":["What did the DM say?"],"verdict":"fail","missing":"No DM shown."}'))
    expect(r).toEqual({ ok: true, read: { verdict: 'fail', topic: 'T', missing: 'No DM shown.', blocking: ['What did the DM say?'] } })
  })
  it('anything else is an error, never a verdict', () => {
    expect(readStranger(text(''))).toEqual({ ok: false, error: 'empty_or_refused' })
    expect(readStranger(text('You have hit your usage limit. Try again later.'))).toEqual({ ok: false, error: 'empty_or_refused' })
    expect(readStranger({ content: [{ type: 'thinking', thinking: '{"verdict":"pass","topic":"x","missing":"","blocking":[]}' }] })).toEqual({ ok: false, error: 'empty_or_refused' })
    expect(readStranger(text('pass'))).toEqual({ ok: false, error: 'no_json' })
    expect(readStranger(text('{"verdict":"maybe","topic":"x"}'))).toEqual({ ok: false, error: 'bad_verdict' })
    expect(readStranger(text('{"verdict":"pass","topic":"","missing":"","blocking":[]}'))).toEqual({ ok: false, error: 'no_topic' })
    expect(readStranger(text('{"verdict":"fail","topic":"x","missing":"M","blocking":[]}'))).toEqual({ ok: false, error: 'fail_without_reason' })
  })
  it('wrong types and contradictions are errors', () => {
    expect(readStranger(text('{"verdict":"pass","topic":"x"}'))).toEqual({ ok: false, error: 'bad_fields' })
    expect(readStranger(text('{"verdict":"fail","topic":"x","missing":3,"blocking":["q"]}'))).toEqual({ ok: false, error: 'bad_fields' })
    expect(readStranger(text('{"verdict":"fail","topic":"x","missing":"m","blocking":"q"}'))).toEqual({ ok: false, error: 'bad_fields' })
    expect(readStranger(text('{"verdict":"fail","topic":"x","missing":"m","blocking":[1]}'))).toEqual({ ok: false, error: 'bad_fields' })
    expect(readStranger(text('{"verdict":"pass","topic":"x","missing":"","blocking":["What did the DM say?"]}'))).toEqual({ ok: false, error: 'pass_with_gaps' })
    expect(readStranger(text('{"verdict":"pass","topic":"x","missing":"No DM.","blocking":[]}'))).toEqual({ ok: false, error: 'pass_with_gaps' })
  })
})

describe('combine', () => {
  it('two reads are taken', () => expect(READS).toBe(2))
  it('passes only when both reads pass', () => {
    expect(combine([fail('A'), fail('B')])).toMatchObject({ verdict: 'fail', reason: 'A' })
    expect(combine([pass('T'), fail('B')])).toMatchObject({ verdict: 'fail', reason: 'B' })
    expect(combine([pass('T'), pass('U')])).toMatchObject({ verdict: 'pass', reason: 'T' })
  })
  it('fewer than two clean reads is no verdict', () => {
    expect(combine([fail(), { ok: false, error: 'timeout' }])).toEqual({ verdict: null, error: 'timeout' })
    expect(combine([pass()])).toEqual({ verdict: null, error: 'too_few_reads' })
  })
  it('a fail with no missing sentence uses its first blocking question', () => {
    const r = combine([{ ok: true, read: { verdict: 'fail', topic: 't', missing: '', blocking: ['Q1'] } }, fail('M')])
    expect(r).toMatchObject({ verdict: 'fail', reason: 'Q1' })
  })
})

describe('buildStrangerBody', () => {
  it('one user turn, no system field, the post filled in literally', () => {
    const b = buildStrangerBody('Read:\n<post>\n{{BODY}}\n</post>', 'Price is $5 and {{x}} stays.')
    expect(Object.keys(b).sort()).toEqual(['max_tokens', 'messages', 'model'])
    expect(b.messages).toEqual([{ role: 'user', content: 'Read:\n<post>\nPrice is $5 and {{x}} stays.\n</post>' }])
  })
})
