// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { BrainStrip as Strip, PlanRead } from '../../../lib/contentPlan'
import ivanFx from './fixtures/ivan.json'
import riseFx from './fixtures/risedtc.json'
import archFx from './fixtures/arch.json'

const api = vi.hoisted(() => ({ decideProposal: vi.fn(), undoRuleChange: vi.fn() }))
vi.mock('../../../lib/contentPlan', async o => ({ ...await o<typeof import('../../../lib/contentPlan')>(), decideProposal: api.decideProposal, undoRuleChange: api.undoRuleChange }))
import { BrainStrip, IdeaStockPopover } from './BrainStrip'

const stripOf = (fx: unknown) => structuredClone((fx as PlanRead).brain_strip) as Strip
const ivan = () => stripOf(ivanFx), rise = () => stripOf(riseFx), arch = () => stripOf(archFx)
const BAD = /—|\bundefined\b|\bNaN\b|\bnull\b|\boutliers?\b|\busual\b|\bprimer\b|\bpillars?\b|\bcadence\b|\breview draft\b|\bniche winners?\b|\bpatterns?\b|\bbreakouts?\b|\bICP\b|\bQA\b|\bholdout\b|\brecipe\b|\bslots?\b/i

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('BrainStrip tiles', () => {
  it('has the four tiles in order', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    const heads = [...document.querySelectorAll('.pl2-tile h3')].map(h => h.textContent)
    expect(heads).toEqual(['What moves views', 'Next brain check', 'Brain guesses, next 2 weeks', 'Views per post, 12 weeks'])
  })

  it('rules: filled for the ones we follow, hollow for the ones being tested, legend in plain words', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    const tile = document.querySelector('.pl2-t-rules')!
    expect(within(tile as HTMLElement).getByText('Rules we follow')).toBeTruthy()
    expect(within(tile as HTMLElement).getByText('Testing, not used yet')).toBeTruthy()
    // live with a measured range: no links, 2 to 4 posts, weekdays only. Testing with one: carousels, picture, question.
    expect(tile.querySelectorAll('.pl2-ch-fill').length).toBe(3)
    expect(tile.querySelectorAll('.pl2-ch-hollow').length).toBe(3)
    expect(tile.querySelectorAll('[data-live="true"]').length).toBe(6)
    expect(tile.querySelectorAll('[data-live="false"]').length).toBe(5)
  })

  it('Ivan: all six live rules, including the ones that are only his rule', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    for (const n of ['No links in the post', '2 to 4 posts a week', 'Weekdays only', 'Open with something you did or saw', 'More than 50 words', 'A photo only if it fits']) expect(screen.getByText(n)).toBeTruthy()
    expect(screen.getAllByText('your rule').length).toBe(3)
    expect(screen.getByText('13% more views')).toBeTruthy()
  })

  it('says when the data is not clear, and when a rule did not hold on the newest posts', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    expect(screen.getByText('your rule, not clear in the data')).toBeTruthy()
    expect(screen.getAllByText(/did not hold on the newest posts, kept because you set it/i).length).toBe(2)
  })

  it('never renders a zz- test rule', () => {
    const s = ivan()
    s.rules.push({ rule_id: 'zz-selftest-20261012T122939Z', name: 'Self test rule', metric: 'views', gain: 9, lo: 1, hi: 17, status: 'shadow', unclear: false, held_latest: true, your_rule: false, enforcer: 'writer', creators: 3 })
    s.next_check.proposals.push({ id: 5, rule_id: 'zz-selftest-1', name: 'Self test proposal', to_status: 'live', reason: null })
    s.next_check.recent.push({ rule_id: 'zz-selftest-1', name: 'Self test change', to_status: 'live', at: '2026-10-12T12:00:00Z', undo_token: 'abc' })
    const { container } = renderInFrame(<BrainStrip strip={s} acct="ivan" />)
    expect(container.textContent).not.toMatch(/self test/i)
    expect(container.textContent).not.toMatch(/zz-/)
  })

  it('Arch has no rule in force: says so, and still shows what is being tested', () => {
    renderInFrame(<BrainStrip strip={arch()} acct="arch" />)
    const tile = document.querySelector('.pl2-t-rules') as HTMLElement
    expect(within(tile).getByText('None proven yet')).toBeTruthy()
    expect(tile.querySelectorAll('.pl2-ch-hollow').length).toBe(4)
    expect(screen.getByText('Carousels')).toBeTruthy()
  })
})

describe('Next brain check', () => {
  it('says the day and what is under watch', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    expect(screen.getByText('Mon 2 Nov. Under watch: more than 50 words and weekdays only.')).toBeTruthy()
  })

  it('a held change shows Accept and Dismiss, which call the gated RPC and say what happened', async () => {
    const s = rise()
    s.next_check.proposals.push({ id: 41, rule_id: 'R01-image-risedtc', name: 'Add a picture', to_status: 'live', reason: 'machine words' })
    api.decideProposal.mockResolvedValue(undefined)
    const changed = vi.fn()
    renderInFrame(<BrainStrip strip={s} acct="risedtc" onChanged={changed} />)
    expect(screen.getByText('Start following: add a picture')).toBeTruthy()
    expect(screen.queryByText(/machine words/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(api.decideProposal).toHaveBeenCalledWith(41, true))
    expect(await screen.findByText('Now following: add a picture.')).toBeTruthy()
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('Dismiss calls the RPC with accept=false', async () => {
    const s = rise()
    s.next_check.proposals.push({ id: 42, rule_id: 'R01-image-risedtc', name: 'Add a picture', to_status: 'live', reason: null })
    api.decideProposal.mockResolvedValue(undefined)
    renderInFrame(<BrainStrip strip={s} acct="risedtc" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(api.decideProposal).toHaveBeenCalledWith(42, false))
    expect(await screen.findByText('Dismissed. The rule stays as it is.')).toBeTruthy()
  })

  it('a refused change says nothing changed and does not re-read', async () => {
    const s = rise()
    s.next_check.proposals.push({ id: 43, rule_id: 'R01-image-risedtc', name: 'Add a picture', to_status: 'live', reason: null })
    api.decideProposal.mockRejectedValue(Object.assign(new Error('x'), { code: 'not_open' }))
    const changed = vi.fn()
    renderInFrame(<BrainStrip strip={s} acct="risedtc" onChanged={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('That change is no longer waiting. Nothing changed.')).toBeTruthy()
    expect(changed).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('recent changes carry Undo, which puts the rule back', async () => {
    const s = rise()
    s.next_check.recent.push({ rule_id: 'R01-image-risedtc', name: 'Add a picture', to_status: 'live', at: '2026-10-12T12:00:00Z', undo_token: '11111111-2222-3333-4444-555555555555' })
    s.next_check.recent.push({ rule_id: 'R10-hashtag-risedtc', name: 'No hashtags', to_status: 'shadow', at: '2026-10-10T12:00:00Z', undo_token: null })
    api.undoRuleChange.mockResolvedValue(undefined)
    renderInFrame(<BrainStrip strip={s} acct="risedtc" />)
    expect(screen.getByText('Add a picture: now followed, Mon 12 Oct')).toBeTruthy()
    expect(screen.getByText('No hashtags: back to testing, Sat 10 Oct')).toBeTruthy()
    const undo = screen.getAllByRole('button', { name: 'Undo' })
    expect(undo.length).toBe(1)
    fireEvent.click(undo[0])
    await waitFor(() => expect(api.undoRuleChange).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555'))
    expect(await screen.findByText('Put back: add a picture.')).toBeTruthy()
  })
})

describe('Brain guesses and views', () => {
  it('not proven guesses are grey; a proven one with few examples is hollow and says so', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    const tile = document.querySelector('.pl2-t-reads') as HTMLElement
    expect(tile.querySelectorAll('circle[data-proven="false"]').length).toBe(8)
    expect(tile.querySelectorAll('.pl2-ch-grey').length).toBe(8)
    expect(within(tile).getByText(/Not proven yet\. The brain needs more of your recent posts\./)).toBeTruthy()
    expect(within(tile).getByText('8 of 13 read')).toBeTruthy()
    cleanup()
    renderInFrame(<BrainStrip strip={arch()} acct="arch" />)
    const a = document.querySelector('.pl2-t-reads') as HTMLElement
    expect(a.querySelectorAll('circle[data-small="true"]').length).toBe(8)
    expect(within(a).getByText(/8 of 8 proven on recent posts, but few examples\./)).toBeTruthy()
  })

  it('the predictions line is under the guesses', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    expect(screen.getByText(/Predictions start at 20 measured posts: Ivan 17 of 20\./)).toBeTruthy()
  })

  it('views: a normal-post line, a 3x line, hollow young dots, the footer', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" today="2026-10-12" />)
    const tile = document.querySelector('.pl2-t-views') as HTMLElement
    expect(tile.querySelector('.pl2-ch-median')).toBeTruthy()
    expect(tile.querySelector('.pl2-ch-three')).toBeTruthy()
    expect(tile.querySelectorAll('circle[data-young="true"]').length).toBeGreaterThan(0)
    expect([...tile.querySelectorAll('circle[data-young="true"]')].every(c => c.classList.contains('pl2-ch-hollow'))).toBe(true)
    expect(within(tile).getByText('Last 90 days: 166 views on a normal post · viral = 3x that')).toBeTruthy()
    expect(within(tile).getByText('7 of 29 went viral')).toBeTruthy()
  })

  it('every chart has a text list too', () => {
    renderInFrame(<BrainStrip strip={rise()} acct="risedtc" today="2026-10-12" />)
    expect(document.querySelectorAll('.pl2-t-reads ul.pl2-sr li').length).toBe(9)
    expect(document.querySelectorAll('.pl2-t-views ul.pl2-sr li').length).toBeGreaterThan(5)
  })
})

describe('under the strip', () => {
  it('the source line from the collection size', () => {
    renderInFrame(<BrainStrip strip={rise()} acct="risedtc" />)
    expect(screen.getByText('From 10,996 posts by 141 creators.')).toBeTruthy()
  })
  it('the Rise note, until Ivan decides', () => {
    renderInFrame(<BrainStrip strip={rise()} acct="risedtc" />)
    expect(screen.getByText(/Tested, not used yet: no weekend posts \(19% more views\)/)).toBeTruthy()
  })
  it('Ivan has no plan note', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    expect(document.querySelector('.pl2-strip-note')).toBeNull()
  })
})

describe('charts: size and words', () => {
  it('every SVG text is at least 12 px', () => {
    for (const [s, a] of [[ivan(), 'ivan'], [rise(), 'risedtc'], [arch(), 'arch']] as const) {
      renderInFrame(<BrainStrip strip={s} acct={a} today="2026-10-12" />)
      const texts = [...document.querySelectorAll('svg text')]
      expect(texts.length).toBeGreaterThan(5)
      for (const t of texts) expect(Number(t.getAttribute('font-size'))).toBeGreaterThanOrEqual(12)
      cleanup()
    }
  })
  it('no banned word, no em dash, no NaN or undefined on any seat', () => {
    for (const [s, a] of [[ivan(), 'ivan'], [rise(), 'risedtc'], [arch(), 'arch']] as const) {
      const { container } = renderInFrame(<BrainStrip strip={s} acct={a} today="2026-10-12" />)
      // Post titles are the writers' own words; only the strip's own sentences are checked.
      const own = [...container.querySelectorAll('.pl2-tile h3, .pl2-tile p, .pl2-rr li, .pl2-strip-src, .pl2-strip-note')].map(e => e.textContent ?? '').join('\n')
      expect(own.match(BAD)).toBeNull()
      expect(container.innerHTML).not.toMatch(/NaN|undefined/)
      cleanup()
    }
  })
})

describe('empty and broken data', () => {
  it('an empty strip says so and never throws', () => {
    const empty = { rules: [], next_check: { date: null, watch: [], proposals: [], recent: [] }, reads: { items: [], total: 0 }, predictions: { measured: 0, need: 0, validated: false }, views: { median: null, breakouts: 0, measured: 0, posts: [] }, idea_stock: [], collection: null, note: null } as Strip
    const { container } = renderInFrame(<BrainStrip strip={empty} acct="arch" />)
    expect(screen.getByText('None proven yet')).toBeTruthy()
    expect(screen.getByText('No brain guesses yet')).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|undefined|null/)
    expect(document.querySelectorAll('.pl2-tile').length).toBe(4)
  })
  it('a strip with only some keys still renders', () => {
    const { container } = renderInFrame(<BrainStrip strip={{ rules: [] } as unknown as Strip} acct="arch" />)
    expect(screen.getByText('None proven yet')).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|undefined|null/)
  })
  it('no strip (the brain data failed to load) renders nothing', () => {
    const { container } = renderInFrame(<BrainStrip strip={null} acct="ivan" />)
    expect(container.querySelector('.pl2-strip')).toBeNull()
    cleanup()
    const b = renderInFrame(<BrainStrip strip={undefined} acct="ivan" />)
    expect(b.container.querySelector('.pl2-strip')).toBeNull()
  })
})

describe('ideas in stock', () => {
  it('the strip offers the popover for a client seat with an empty topic', () => {
    const open = vi.fn()
    renderInFrame(<BrainStrip strip={rise()} acct="risedtc" onIdeaStock={open} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ideas in stock' }))
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('Ivan has no idea stock, so no key', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" onIdeaStock={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Ideas in stock' })).toBeNull()
  })
  it('the popover draws a bar and a used tick per topic, amber when empty', () => {
    const close = vi.fn()
    renderInFrame(<IdeaStockPopover strip={rise()} onClose={close} />)
    const dlg = screen.getByRole('dialog', { name: 'Ideas in stock' })
    expect(within(dlg).getByText('Teardowns')).toBeTruthy()
    expect(dlg.querySelectorAll('g[data-empty="true"]').length).toBe(2)
    expect(dlg.querySelectorAll('.pl2-ch-bar').length).toBe(4)
    expect([...dlg.querySelectorAll('.pl2-ch-name')].map(e => e.textContent)).toEqual(['Teardowns', 'Expert posts', 'Proof posts', 'Founder stories', 'Posts that bring new followers', 'Sales posts'])
    expect(dlg.querySelectorAll('.pl2-ch-tick').length).toBe(6)
    expect(dlg.querySelector('ul.pl2-sr')!.textContent).toContain('Sales posts: out of ideas, 3 used in 8 weeks.')
    expect(within(dlg).getByText(/bar = ideas in stock/i)).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalled()
  })
  it('the popover with no stock data says so', () => {
    renderInFrame(<IdeaStockPopover strip={null} onClose={() => {}} />)
    expect(screen.getByText('No idea stock to show yet.')).toBeTruthy()
  })
})

describe('reduced motion', () => {
  afterEach(() => document.documentElement.classList.remove('brief-motion-off'))
  it('motion on: the tiles come in one after another, 30 ms apart', () => {
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    expect([...document.querySelectorAll<HTMLElement>('.pl2-tile')].map(t => t.style.getPropertyValue('--pl2-d'))).toEqual(['0ms', '30ms', '60ms', '90ms'])
    expect(document.querySelector('.pl2-strip')!.getAttribute('data-motion')).toBe('full')
  })
  it('motion off: no delay on any tile', async () => {
    document.documentElement.classList.add('brief-motion-off')
    renderInFrame(<BrainStrip strip={ivan()} acct="ivan" />)
    await act(async () => {})
    expect([...document.querySelectorAll<HTMLElement>('.pl2-tile')].map(t => t.style.getPropertyValue('--pl2-d'))).toEqual(['0ms', '0ms', '0ms', '0ms'])
    expect(document.querySelector('.pl2-strip')!.getAttribute('data-motion')).toBe('off')
  })
})
