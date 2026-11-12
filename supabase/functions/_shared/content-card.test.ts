import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  buildAskBody, buildWeaveBody, checkWeave, fill, growthBound, proxyCall, proxyUrl, readAsk, readWeave, sha256Hex, textOf, warsawDay,
} from './content-card.ts'

// The pure parts of content-card-ask and content-card-weave (db/20261112b_content_card_question). No proxy, no DB.
const text = (t: string) => ({ content: [{ type: 'text', text: t }] })
const DRAFT = 'Most expert posts only reach people who already follow you.\n\nI told a client exactly that last week.\n\nReach comes from the ones who do not know you yet.'
const ANCHOR = 'I told a client exactly that last week.'
// The prompt rows as the migration inserts them: the bodies the functions fill.
const sql = readFileSync('db/20261112b_content_card_question_prompt.sql', 'utf8')
const row = (slug: string) => {
  const m = sql.match(new RegExp(`select '${slug}', '[^']*', \\$p\\$([\\s\\S]*?)\\$p\\$`))
  if (!m) throw new Error(`no row ${slug}`)
  return m[1]
}

describe('prompt assembly', () => {
  it('the question prompt: one user turn, no system field, the draft, the kind of draft and the hints filled in', () => {
    const b = buildAskBody(row('ivan-card-question'), { body: DRAFT, source: 'x_copy', source_label: 'X outlier by @kevin (900 likes vs own median 10)', hints: ['I have lived in Warsaw for 10 years.', 7] })
    expect('system' in b).toBe(false)
    expect(b.messages).toHaveLength(1)
    expect(b.messages[0].role).toBe('user')
    const c = b.messages[0].content
    expect(c).toContain(DRAFT)
    expect(c).toContain('near word-for-word copy')
    expect(c).toContain('Source: X outlier by @kevin')
    expect(c).toContain('- I have lived in Warsaw for 10 years.')
    expect(c).not.toMatch(/\{\{[A-Z]+\}\}/)
    // the bar: the good and bad examples ride in the prompt
    expect(c).toContain('Kevin says Warsaw is dirty. Do you agree, and what did you see yourself?')
    expect(c).toContain('Could you add a personal story here?')
    expect(buildAskBody(row('ivan-card-question'), { body: DRAFT }).messages[0].content).toContain("What this draft is: Ivan's own post.\n")
    expect(buildAskBody(row('ivan-card-question'), { body: DRAFT, source: 'take' }).messages[0].content).toContain('screenshot')
  })

  it('the weave prompt carries the question, the anchor and his answer; placeholders never run as patterns', () => {
    const b = buildWeaveBody(row('ivan-card-weave'), { body: DRAFT, question: 'What did they say back?', anchor: ANCHOR, answer: 'He said $& and $1, then laughed.' })
    expect('system' in b).toBe(false)
    const c = b.messages[0].content
    expect(c).toContain('QUESTION he was asked: What did they say back?')
    expect(c).toContain(`ANCHOR (the line of the draft the question is about): ${ANCHOR}`)
    expect(c).toContain('HIS ANSWER (typed or dictated on his phone): He said $& and $1, then laughed.')
    expect(c).not.toMatch(/\{\{[A-Z]+\}\}/)
    expect(fill('a {{X}} b {{X}}', { X: '$$' })).toBe('a $$ b $$')
  })

  it('no em dash in the prompts themselves', () => {
    expect(row('ivan-card-question')).not.toContain('—')
    expect(row('ivan-card-weave')).not.toContain('—')
  })
})

describe('textOf: only text blocks, and a refusal or a limit notice is nothing', () => {
  it('reads text blocks and skips thinking', () => {
    expect(textOf({ content: [{ type: 'thinking', thinking: '{"x":1}' }, { type: 'text', text: ' {"a":1} ' }] })).toBe('{"a":1}')
  })
  it('empty, missing, capped', () => {
    expect(textOf({ content: [] })).toBeNull()
    expect(textOf({})).toBeNull()
    expect(textOf(null)).toBeNull()
    expect(textOf(text('   '))).toBeNull()
    expect(textOf(text("You've hit your session limit · resets 3pm (UTC)"))).toBeNull()
  })
})

describe('readAsk', () => {
  const ok = (o: object) => readAsk(text(JSON.stringify(o)), DRAFT)
  const q = { has_lived_detail: false, question: 'You told the client their expert posts only reach existing followers. What did they say back?', anchor: ANCHOR, kind: 'own_words', why: 'No reply is given.' }

  it('a good question is asked; a lead-in before the JSON is fine', () => {
    expect(ok(q)).toEqual({ ok: true, state: 'asked', result: q })
    expect(readAsk(text('Here it is:\n' + JSON.stringify(q)), DRAFT)).toMatchObject({ ok: true, state: 'asked' })
  })

  it('a post that already has his detail: no question, whatever else the model wrote', () => {
    expect(ok({ has_lived_detail: true, question: 'ignored?', anchor: 'x', kind: 'own_take', why: 'He names the client call.' }))
      .toEqual({ ok: true, state: 'none', result: { has_lived_detail: true, question: null, anchor: null, kind: null, why: 'He names the client call.' } })
  })

  it('malformed JSON, refused and empty text are failures', () => {
    expect(readAsk(text('{"has_lived_detail": false, "question": "What'), DRAFT)).toEqual({ ok: false, error: 'malformed' })
    // a refusal in prose is no JSON: a failure, never a question
    expect(readAsk(text('I cannot help with that.'), DRAFT)).toEqual({ ok: false, error: 'malformed' })
    expect(readAsk({ content: [] }, DRAFT)).toEqual({ ok: false, error: 'refused_or_empty' })
    expect(readAsk(text('Usage limit reached, try again later.'), DRAFT)).toEqual({ ok: false, error: 'refused_or_empty' })
    expect(ok({ has_lived_detail: 'no', question: 'What?' })).toEqual({ ok: false, error: 'malformed' })
  })

  it('a question over 22 words is refused', () => {
    const long = 'When you told the client that their expert posts only reach the people who already follow them, what exactly did they say back to you?'
    expect(long.split(' ').length).toBeGreaterThan(22)
    expect(ok({ ...q, question: long })).toMatchObject({ ok: false, error: 'question_too_long' })
  })

  it('an anchor that is not in the body, word for word, is refused', () => {
    expect(ok({ ...q, anchor: 'I told a client that last week.' })).toMatchObject({ ok: false, error: 'anchor_not_in_body' })
    expect(ok({ ...q, anchor: null })).toMatchObject({ ok: false, error: 'anchor_not_in_body' })
  })

  it('an anchor across paragraphs (or the whole post) is refused', () => {
    expect(ok({ ...q, anchor: DRAFT })).toMatchObject({ ok: false, error: 'anchor_spans_paragraphs' })
    expect(ok({ ...q, anchor: 'you.\n\nI told a client' })).toMatchObject({ ok: false, error: 'anchor_spans_paragraphs' })
    // a line break inside one paragraph is fine
    expect(readAsk(text(JSON.stringify({ ...q, anchor: 'Line one\nline two' })), 'Line one\nline two\n\nNext.')).toMatchObject({ ok: true })
    // the same with CRLF, lone CR, U+2028 / U+2029 and blank space between the breaks
    const crlf = 'Line one\r\nline two\r\n\r\nNext one.\r\n \t\r\nLast one.'
    expect(readAsk(text(JSON.stringify({ ...q, anchor: 'Line one\r\nline two' })), crlf)).toMatchObject({ ok: true })
    expect(readAsk(text(JSON.stringify({ ...q, anchor: 'line two\r\n\r\nNext one.' })), crlf)).toMatchObject({ ok: false, error: 'anchor_spans_paragraphs' })
    expect(readAsk(text(JSON.stringify({ ...q, anchor: 'Next one.\r\n \t\r\nLast one.' })), crlf)).toMatchObject({ ok: false, error: 'anchor_spans_paragraphs' })
    for (const sep of ['\r\r', '\u2028\u2028', '\u2029', '\n\u00a0\n']) {
      const post = `First part here.${sep}Second part here.`
      expect(readAsk(text(JSON.stringify({ ...q, anchor: post })), post)).toMatchObject({ ok: false, error: 'anchor_spans_paragraphs' })
    }
  })

  it('two questions, no question mark, an em dash, an unknown kind, no question at all', () => {
    expect(ok({ ...q, question: 'What did they say? And what did you answer?' })).toMatchObject({ ok: false, error: 'two_questions' })
    expect(ok({ ...q, question: 'Tell me what they said.' })).toMatchObject({ ok: false, error: 'not_a_question' })
    expect(ok({ ...q, question: 'The client — what did they say?' })).toMatchObject({ ok: false, error: 'dash' })
    expect(ok({ ...q, kind: 'own_story' })).toMatchObject({ ok: false, error: 'bad_kind' })
    expect(ok({ ...q, question: '' })).toMatchObject({ ok: false, error: 'no_question' })
    // a question mark inside a quote does not end the sentence (the brief's own example)
    expect(ok({ ...q, question: "The prospect replied with just 'GEO?'. What did you answer?" })).toMatchObject({ ok: true, state: 'asked' })
  })
})

describe('checkWeave: the code checks on the woven post', () => {
  const P = ['First paragraph stays.', 'Second paragraph stays.', 'The anchor line is here.', 'Fourth is a neighbour.', 'Fifth stays too.'].join('\n\n')
  const A = 'The anchor line is here.'
  const answer = 'He said he would think about it.'

  it('an added sentence at the anchor passes; so does a light change to a neighbour', () => {
    expect(checkWeave(P, P.replace(A, A + ' He said he would think about it.'), A, answer)).toBeNull()
    expect(checkWeave(P, P.replace('Fourth is a neighbour.', 'Fourth is a neighbour, he said.').replace(A, A + ' He said he would think about it.'), A, answer)).toBeNull()
    // the new sentence as its own paragraph right after the anchor
    expect(checkWeave(P, P.replace(A, A + '\n\nHe said he would think about it.'), A, answer)).toBeNull()
  })

  it('a change to a far paragraph fails', () => {
    expect(checkWeave(P, P.replace('First paragraph stays.', 'First paragraph changed.').replace(A, A + ' He said so.'), A, answer)).toBe('touched_far_paragraph')
    expect(checkWeave(P, P.replace('Fifth stays too.', '').replace(A, A + ' He said so.'), A, answer)).toBe('touched_far_paragraph')
    // anchor in the first paragraph: only the first two may change
    expect(checkWeave(P, P.replace('First paragraph stays.', 'First paragraph stays. Yes.').replace('Fourth is a neighbour.', 'Fourth moved.'), 'First paragraph stays.', answer)).toBe('touched_far_paragraph')
    expect(checkWeave(P, P.replace('First paragraph stays.', 'First paragraph stays. Yes.'), 'First paragraph stays.', answer)).toBeNull()
  })

  it('an anchor across paragraphs never widens the editable region', () => {
    const four = ['One.', 'Two.', 'Three.', 'Four.', 'Five stays.', 'Six stays.'].join('\n\n')
    const span = 'One.\n\nTwo.\n\nThree.\n\nFour.'
    expect(checkWeave(four, four.replace(span, 'All four replaced.'), span, answer)).toBe('anchor_spans_paragraphs')
  })

  it('CRLF and U+2029 posts keep their far paragraphs protected', () => {
    const six = (sep: string) => ['One stays.', 'Two stays.', 'Three is the anchor.', 'Four.', 'Five stays.', 'Six stays.'].join(sep)
    for (const sep of ['\r\n\r\n', '\u2029', '\r\r', '\u2028\u2028', '\r\n \r\n']) {
      const post = six(sep)
      expect(checkWeave(post, post.replace('Six stays.', 'Six changed.').replace('Three is the anchor.', 'Three is the anchor. Yes.'), 'Three is the anchor.', answer)).toBe('touched_far_paragraph')
      expect(checkWeave(post, post.replace('One stays.', 'One changed.').replace('Three is the anchor.', 'Three is the anchor. Yes.'), 'Three is the anchor.', answer)).toBe('touched_far_paragraph')
      expect(checkWeave(post, post.replace('Three is the anchor.', 'Three is the anchor. Yes.'), 'Three is the anchor.', answer)).toBeNull()
    }
    const post = six('\r\n\r\n')
    expect(checkWeave(post, post.replace('Two stays.\r\n\r\nThree is the anchor.', 'Gone.'), 'Two stays.\r\n\r\nThree is the anchor.', answer)).toBe('anchor_spans_paragraphs')
  })

  it('an en dash passes only between two digits', () => {
    expect(checkWeave(P, P.replace(A, A + ' He said yes\u2013maybe.'), A, answer)).toBe('dash')
    expect(checkWeave(P, P.replace(A, A + ' It took 10\u2013twenty days.'), A, answer)).toBe('dash')
    expect(checkWeave(P, P.replace(A, A + ' It took 10\u201320 days.'), A, answer)).toBeNull()
    // an edit next to an existing range that turns it into punctuation
    const range = P.replace('Fourth is a neighbour.', 'Fourth took 10\u201320 days.')
    expect(checkWeave(range, range.replace('10\u201320', '10 \u201320'), A, answer)).toBe('dash')
    expect(checkWeave(range, range.replace('10\u201320', '10\u2013 20'), A, answer)).toBe('dash')
    // and the question itself
    expect(readAsk(text(JSON.stringify({ has_lived_detail: false, question: 'Was it yes\u2013maybe for you?', anchor: ANCHOR, kind: 'own_take', why: '' })), DRAFT))
      .toMatchObject({ ok: false, error: 'dash' })
  })

  it('a dash swapped in: an existing em dash removed and a new one added elsewhere in the region fails', () => {
    const withDash = P.replace('Fourth is a neighbour.', 'Fourth \u2014 a neighbour.')
    const swapped = withDash.replace('Fourth \u2014 a neighbour.', 'Fourth, a neighbour.').replace(A, A + ' He said \u2014 maybe.')
    expect(checkWeave(withDash, swapped, A, answer)).toBe('dash')
    // an en dash used as punctuation is a dash too; a range is not
    expect(checkWeave(P, P.replace(A, A + ' He said \u2013 maybe.'), A, answer)).toBe('dash')
    expect(checkWeave(P, P.replace(A, A + ' It took 10\u201320 days.'), A, answer)).toBeNull()
  })

  it('a new em dash fails; one already in the post may stay', () => {
    expect(checkWeave(P, P.replace(A, A + ' He said — maybe.'), A, answer)).toBe('dash')
    const withDash = P.replace('Fifth stays too.', 'Fifth — stays too.')
    expect(checkWeave(withDash, withDash.replace(A, A + ' He said maybe.'), A, answer)).toBeNull()
  })

  it('a balloon fails: more growth than twice the answer plus 200', () => {
    const extra = ' ' + 'He went on and on. '.repeat(20)
    expect(extra.length).toBeGreaterThan(growthBound(answer))
    expect(checkWeave(P, P.replace(A, A + extra), A, answer)).toBe('too_long')
  })

  it('a closing question, an "X, not Y" contrast, an empty or unchanged result, an anchor not in the post', () => {
    expect(checkWeave(P, P.replace('Fifth stays too.', 'Fifth stays too. What would you do?'), 'Fifth stays too.', answer)).toBe('closing_question')
    expect(checkWeave(P, P.replace(A, A + ' It was a test, not a pitch.'), A, answer)).toBe('contrast')
    expect(checkWeave(P, '  ', A, answer)).toBe('empty')
    expect(checkWeave(P, P, A, answer)).toBe('unchanged')
    expect(checkWeave(P, P + ' x', 'Not in the post.', answer)).toBe('anchor_not_in_body')
  })
})

describe('readWeave', () => {
  it('returns the proposal only when every check passes', () => {
    const body = DRAFT.replace(ANCHOR, ANCHOR + ' She said "so who do we write for then?".')
    expect(readWeave(text(JSON.stringify({ changed: true, body, reason: 'Added.' })), DRAFT, ANCHOR, 'she said so who do we write for then'))
      .toEqual({ ok: true, text: body })
  })
  it('unusable answers, malformed or refused replies, failed checks', () => {
    expect(readWeave(text(JSON.stringify({ changed: false, body: DRAFT, reason: 'The answer is off topic.' })), DRAFT, ANCHOR, 'pizza'))
      .toEqual({ ok: false, error: 'unusable', why: 'The answer is off topic.' })
    expect(readWeave(text('{"changed": true, "body": "trunc'), DRAFT, ANCHOR, 'a')).toEqual({ ok: false, error: 'malformed' })
    expect(readWeave({ content: [{ type: 'thinking', thinking: '{}' }] }, DRAFT, ANCHOR, 'a')).toEqual({ ok: false, error: 'refused_or_empty' })
    expect(readWeave(text(JSON.stringify({ changed: true, body: DRAFT.replace(ANCHOR, ANCHOR + ' Yes — really.') })), DRAFT, ANCHOR, 'yes really'))
      .toMatchObject({ ok: false, error: 'dash' })
    expect(readWeave(text(JSON.stringify({ changed: true, body: DRAFT.replace(ANCHOR, ANCHOR + ' It was a test, not a pitch.') })), DRAFT, ANCHOR, 'it was a test'))
      .toMatchObject({ ok: false, error: 'contrast' })
  })
})

describe('transport helpers', () => {
  it('proxyCall: an HTTP error, a throw and a timeout are failures, never an answer', async () => {
    const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    expect(await proxyCall((async () => res(200, text('{}'))) as typeof fetch, 'u', 'k', {}, 1000)).toEqual({ ok: true, json: text('{}') })
    expect(await proxyCall((async () => res(503, { detail: 'Proxy busy' })) as typeof fetch, 'u', 'k', {}, 1000)).toEqual({ ok: false, error: 'http_503' })
    expect(await proxyCall((async () => { throw new Error('down') }) as typeof fetch, 'u', 'k', {}, 1000)).toEqual({ ok: false, error: 'fetch_failed' })
    const slow = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
    expect(await proxyCall(slow, 'u', 'k', {}, 10)).toEqual({ ok: false, error: 'timeout' })
  })
  it('sends no system field and the proxy headers', async () => {
    let seen: RequestInit | undefined
    await proxyCall((async (_u: string, init: RequestInit) => { seen = init; return new Response('{}') }) as unknown as typeof fetch, 'u', 'key', buildAskBody('x {{DRAFT}}', { body: 'b' }), 1000)
    expect(JSON.parse(String(seen?.body))).not.toHaveProperty('system')
    expect(seen?.headers).toMatchObject({ 'x-api-key': 'key' })
  })
  it('proxyUrl, warsawDay, sha256Hex', async () => {
    expect(proxyUrl('https://p.test/')).toBe('https://p.test/v1/messages')
    expect(proxyUrl('https://p.test/v1/messages')).toBe('https://p.test/v1/messages')
    expect(proxyUrl(null)).toBe('')
    expect(warsawDay(new Date('2026-11-12T23:30:00Z'))).toBe('2026-11-13')
    expect(warsawDay(new Date('2026-11-12T22:30:00Z'))).toBe('2026-11-12')
    // the database's content_card_sha: sha256 of the UTF-8 text, hex
    expect(await sha256Hex('Kraków')).toBe(createHash('sha256').update('Kraków', 'utf8').digest('hex'))
  })
})
