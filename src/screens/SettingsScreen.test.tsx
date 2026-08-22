import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsScreen } from './SettingsScreen'

// 🔴 WHY THIS FILE EXISTS. `SettingsScreen` is SHARED: `App.tsx:148` renders it
// for `#exp/stock` and `Shell.tsx:593` renders the same component inside the
// workbench (inventory.md §1). The compact-density merge and the frame-arms
// merge each added an Appearance row without noticing that, so the escape hatch
// grew two controls it has no styles for and Sign out moved 102px down the
// page: 42,551 differing pixels against a 0 noise floor, measured
// pre-run-vs-current at 1440x900 (phase6-verification.md §8).
//
// Both arms only ever reach `.wb` (wbsys.css:1047, wbcal.css:454-470), which
// does not exist in stock, so the controls were also inert there. These tests
// pin the split by markup rather than by pixels, because a pixel gate needs two
// servers and a browser and this needs to fail in CI the moment someone adds a
// third workbench-only row to the shared screen.

// The suite runs in plain Node, no jsdom (vitest.config.ts declares no
// environment). The four browser globals this screen reads on its FIRST render
// are stubbed here rather than in `src/test-setup.ts`, so nothing else in the
// suite changes shape because of this file. `dataset` is left empty on purpose:
// that is exactly the state stock boots in, since `main.tsx` only writes
// `data-density` / `data-frame` when a stored value asks for it.
const g = globalThis as Record<string, unknown>
g.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
g.document ??= { documentElement: { dataset: {} as Record<string, string> } }
g.navigator ??= { userAgent: 'node' }
g.window ??= { matchMedia: () => ({ matches: false }) }
// `__BUILD__` is a vite `define`, not a runtime global, so the test runner has
// to supply it. A fixed string keeps the build stamp out of the comparisons.
g.__BUILD__ ??= 'test'

const stock = () => renderToStaticMarkup(<SettingsScreen />)
const workbench = () => renderToStaticMarkup(<SettingsScreen shell="workbench" />)

describe('SettingsScreen shell scoping', () => {
  it('stock renders no Density control', () => {
    expect(stock()).not.toContain('>Density<')
    expect(stock()).not.toContain('>Compact<')
    expect(stock()).not.toContain('>Comfortable<')
  })

  it('stock renders no Frame control', () => {
    expect(stock()).not.toContain('>Frame<')
    expect(stock()).not.toContain('>Flush<')
    expect(stock()).not.toContain('>Tight<')
  })

  it('the workbench renders both', () => {
    const html = workbench()
    expect(html).toContain('>Density<')
    expect(html).toContain('>Frame<')
    expect(html).toContain('>Compact<')
    expect(html).toContain('>Flush<')
  })

  // Theme predates this run, writes `inbox-theme`, and is read by both shells.
  // Scoping it by accident while scoping its two neighbours would be the exact
  // opposite defect, so it is pinned on BOTH sides.
  it('Theme stays shared', () => {
    for (const html of [stock(), workbench()]) {
      expect(html).toContain('>Theme<')
      expect(html).toContain('>Dark<')
      expect(html).toContain('>Light<')
    }
  })

  // The stock default is what makes the escape hatch safe: a caller that says
  // nothing gets the pre-run screen. `cand-a`/`cand-b`/`cand-c` all mount this
  // component with no prop and none of them carries `.wb` either.
  it('the default is stock, not workbench', () => {
    expect(stock()).toBe(renderToStaticMarkup(<SettingsScreen shell="stock" />))
  })

  // Everything that is NOT Appearance is identical between the two shells, so
  // the split cannot quietly grow past the two rows it is meant to cover.
  it('only the Appearance group differs', () => {
    const strip = (h: string) => h.split('Appearance')[0]
    expect(strip(stock())).toBe(strip(workbench()))
    expect(stock()).toContain('Sign out')
    expect(workbench()).toContain('Sign out')
  })
})
