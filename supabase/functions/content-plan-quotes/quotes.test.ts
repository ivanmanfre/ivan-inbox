import { buildBody, MODEL, readAnswer } from './quotes.ts'

Deno.test('body has no system field and puts the instruction in the user turn', () => {
  const b = buildBody('Mislim da je to dobro.')
  if ('system' in b) throw new Error('system field present')
  if (b.messages.length !== 1 || b.messages[0].role !== 'user') throw new Error('not one user turn')
  if (!String(b.messages[0].content).includes('Mislim da je to dobro.')) throw new Error('quote missing')
  if (b.model !== MODEL) throw new Error('model')
})

Deno.test('reads only text blocks and refuses empty or refused answers', () => {
  if (readAnswer({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '  I think it is good.  ' }] }, 'Mislim da je to dobro.') !== 'I think it is good.') throw new Error('text block')
  if (readAnswer({ content: [] }, 'Mislim da je to dobro.') !== null) throw new Error('empty')
  if (readAnswer({ content: [{ type: 'text', text: "I can't help with that." }] }, 'Mislim da je to dobro.') !== null) throw new Error('refusal')
})

Deno.test('strips wrapping quotation marks', () => {
  if (readAnswer({ content: [{ type: 'text', text: '"I think it is good."' }] }, 'Mislim da je to dobro.') !== 'I think it is good.') throw new Error('quotes')
  if (readAnswer({ content: [{ type: 'text', text: '“I think it is good.”' }] }, 'Mislim da je to dobro.') !== 'I think it is good.') throw new Error('curly quotes')
})

Deno.test('a proxy limit notice or an over-long answer is not a quote', () => {
  if (readAnswer({ content: [{ type: 'text', text: 'Usage limit reached, try again later.' }] }, 'Mislim da je to dobro.') !== null) throw new Error('limit notice')
  if (readAnswer({ content: [{ type: 'text', text: 'x'.repeat(1201) }] }, 'Mislim da je to dobro.') !== null) throw new Error('too long')
  if (readAnswer({}, 'Mislim da je to dobro.') !== null) throw new Error('no content')
})

Deno.test('an answer identical to the source quote is kept even when it reads like a refusal or a limit notice', () => {
  const sorry = "Sorry, we never got the shipping threshold right."
  if (readAnswer({ content: [{ type: 'text', text: '  ' + sorry + ' ' }] }, sorry) !== sorry) throw new Error('sorry quote')
  const limit = 'We hit the rate limit on Meta every Friday.'
  if (readAnswer({ content: [{ type: 'text', text: limit }] }, '  ' + limit) !== limit) throw new Error('limit quote')
  // A refusal that is not the source is still refused.
  if (readAnswer({ content: [{ type: 'text', text: "I'm sorry, I can't translate that." }] }, sorry) !== null) throw new Error('refusal')
  if (readAnswer({ content: [{ type: 'text', text: '   ' }] }, '') !== null) throw new Error('empty source')
})
