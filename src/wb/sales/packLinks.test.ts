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
