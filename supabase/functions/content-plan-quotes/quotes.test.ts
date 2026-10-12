import { buildBody, MODEL, readAnswer } from './quotes.ts'

Deno.test('body has no system field and puts the instruction in the user turn', () => {
  const b = buildBody('Mislim da je to dobro.')
  if ('system' in b) throw new Error('system field present')
  if (b.messages.length !== 1 || b.messages[0].role !== 'user') throw new Error('not one user turn')
  if (!String(b.messages[0].content).includes('Mislim da je to dobro.')) throw new Error('quote missing')
  if (b.model !== MODEL) throw new Error('model')
})

Deno.test('reads only text blocks and refuses empty or refused answers', () => {
  if (readAnswer({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '  I think it is good.  ' }] }) !== 'I think it is good.') throw new Error('text block')
  if (readAnswer({ content: [] }) !== null) throw new Error('empty')
  if (readAnswer({ content: [{ type: 'text', text: "I can't help with that." }] }) !== null) throw new Error('refusal')
})

Deno.test('strips wrapping quotation marks', () => {
  if (readAnswer({ content: [{ type: 'text', text: '"I think it is good."' }] }) !== 'I think it is good.') throw new Error('quotes')
  if (readAnswer({ content: [{ type: 'text', text: '“I think it is good.”' }] }) !== 'I think it is good.') throw new Error('curly quotes')
})

Deno.test('a proxy limit notice or an over-long answer is not a quote', () => {
  if (readAnswer({ content: [{ type: 'text', text: 'Usage limit reached, try again later.' }] }) !== null) throw new Error('limit notice')
  if (readAnswer({ content: [{ type: 'text', text: 'x'.repeat(1201) }] }) !== null) throw new Error('too long')
  if (readAnswer({}) !== null) throw new Error('no content')
})
