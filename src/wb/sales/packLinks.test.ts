// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { rewritePackLinks } from './packLinks'

const page = '<html><head><title>t</title></head><body><a href="sales-deck.html">deck</a> <a href="./sales-script.html#x">sheet</a> <a href="audience-audit.html">audit</a> <a href="notes.html"><b>notes</b></a> <a href="https://example.com/x">out</a> <a href="#top">top</a></body></html>'
const BASE = 'https://app.example/inbox/'

it('re-points the three sibling files at documents and turns other relative links into text', () => {
  const out = new DOMParser().parseFromString(rewritePackLinks(page, new Set(['deck', 'call_sheet', 'audience_audit']), k => `${BASE}#doc?slug=ada-co&doc=${k}`), 'text/html')
  const hrefs = [...out.querySelectorAll('a')].map(a => a.getAttribute('href'))
  expect(hrefs).toEqual([
    `${BASE}#doc?slug=ada-co&doc=deck`, `${BASE}#doc?slug=ada-co&doc=call_sheet`, `${BASE}#doc?slug=ada-co&doc=audience_audit`,
    'https://example.com/x', '#top',
  ])
  expect(out.querySelector('a')!.getAttribute('target')).toBe('_blank')
  expect(out.body.textContent).toContain('notes')
  expect(out.querySelector('span b')!.textContent).toBe('notes')
})

it('a sibling file with no such document becomes plain text, never a dead link', () => {
  const out = new DOMParser().parseFromString(rewritePackLinks(page, new Set(['deck']), k => `${BASE}#doc?slug=ada-co&doc=${k}`), 'text/html')
  expect([...out.querySelectorAll('a')].map(a => a.textContent)).toEqual(['deck', 'out', 'top'])
  expect(out.body.textContent).toContain('audit')
})

it('javascript, data and vbscript links become plain text', () => {
  const html = '<body><a href="javascript:alert(1)">a</a><a href=" JavaScript:x">b</a><a href="data:text/html,x">c</a><a href="vbscript:x">d</a></body>'
  const out = new DOMParser().parseFromString(rewritePackLinks(html, new Set(), k => k), 'text/html')
  expect(out.querySelectorAll('a').length).toBe(0)
  expect(out.body.textContent).toBe('abcd')
})

it('every absolute http link opens in its own tab and cannot navigate the frame', () => {
  const html = '<body><a href="https://example.com/x">x</a><a href="//cdn.example.com/y" target="_self">y</a><a href="mailto:a@b.co">m</a><a href="#top">t</a></body>'
  const out = new DOMParser().parseFromString(rewritePackLinks(html, new Set(), k => k), 'text/html')
  const [x, y, m, t] = [...out.querySelectorAll('a')]
  for (const a of [x, y]) {
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  }
  expect(m.getAttribute('target')).toBeNull()
  expect(t.getAttribute('target')).toBeNull()
})
