import { buildBody, MODEL, readAnswer } from './read.ts'

Deno.test('body has no system field and puts the instruction and the post in the one user turn', () => {
  const b = buildBody('More riots in Warsaw today.')
  if ('system' in b) throw new Error('system field present')
  if (b.messages.length !== 1 || b.messages[0].role !== 'user') throw new Error('not one user turn')
  if (!String(b.messages[0].content).includes('More riots in Warsaw today.')) throw new Error('post missing')
  if (!/Politics, migration and strong opinions about Poland count/.test(String(b.messages[0].content))) throw new Error('polemic rule missing')
  if (b.model !== MODEL) throw new Error('model')
})

Deno.test('reads a clean verdict from text blocks only', () => {
  const r = readAnswer({ content: [{ type: 'thinking', thinking: '{"poland": false}' }, { type: 'text', text: '{"poland": true, "why": "About Warsaw."}' }] })
  if (!r || r.poland !== true || r.why !== 'About Warsaw.') throw new Error('text block verdict')
  const f = readAnswer({ content: [{ type: 'text', text: 'Here you go:\n{"poland": false, "why": "About Rome."}' }] })
  if (!f || f.poland !== false) throw new Error('false verdict with lead-in')
})

Deno.test('anything that is not one boolean verdict writes nothing', () => {
  if (readAnswer({ content: [] }) !== null) throw new Error('empty')
  if (readAnswer({}) !== null) throw new Error('no content')
  if (readAnswer({ content: [{ type: 'text', text: "I can't help with that." }] }) !== null) throw new Error('refusal')
  if (readAnswer({ content: [{ type: 'text', text: 'Usage limit reached, try again later.' }] }) !== null) throw new Error('limit')
  if (readAnswer({ content: [{ type: 'text', text: '{"poland": "yes"}' }] }) !== null) throw new Error('string verdict')
  if (readAnswer({ content: [{ type: 'text', text: '{"poland": true' }] }) !== null) throw new Error('broken json')
})
