// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

const rows = (kinds: string[]) => kinds.map(kind => ({ id: kind, prospect_slug: 'ada-co', kind, title: 't', mime: 'text/html', source_path: null, source_mtime: null, call_at: null, meta: {}, updated_at: '2026-10-07T09:00:00Z' }))
let kinds = ['deck', 'call_sheet']
vi.mock('../../lib/salesPacks', async orig => ({
  ...(await orig<typeof import('../../lib/salesPacks')>()),
  fetchPackIndex: async () => rows(kinds),
  fetchPackBody: async (_s: string, kind: string) => ({ ...rows([kind])[0], body: kind === 'deck' ? '<!doctype html><script>1</script>deck' : '<!doctype html><a href="sales-deck.html">deck</a>' }),
  subscribePacks: () => () => {},
}))
import { SalesDoc, DECK_SANDBOX } from './Doc'

beforeEach(() => { kinds = ['deck', 'call_sheet'] })
afterEach(() => { cleanup(); location.hash = '' })

it('the deck frame has allow-scripts and nothing else, so it cannot reach the app session', async () => {
  location.hash = '#doc?slug=ada-co&doc=deck'
  const { container } = render(<SalesDoc />)
  await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())
  const f = container.querySelector('iframe')!
  expect(f.getAttribute('sandbox')).toBe('allow-scripts')
  expect(DECK_SANDBOX).toBe('allow-scripts')
  expect(f.getAttribute('srcdoc')).toContain('<script>1</script>')
})

it('a call sheet stays script-less and its sales-deck link opens the deck document', async () => {
  location.hash = '#doc?slug=ada-co&doc=call_sheet'
  const { container } = render(<SalesDoc />)
  await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy())
  const f = container.querySelector('iframe')!
  expect(f.getAttribute('sandbox')).not.toContain('allow-scripts')
  expect(f.getAttribute('srcdoc')).toContain('#doc?slug=ada-co&amp;doc=deck')
})
