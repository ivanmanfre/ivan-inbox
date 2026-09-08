/// <reference types="node" />
// The node types are pulled in for THIS file only: tsconfig.app declares
// `types: ["vite/client"]`, and vitest stubs `.css` modules (css:false), so a
// `?raw` import of a stylesheet resolves to an empty module here. The sheets
// have to be read off disk to be read at all.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// W3-1. The confirm sheet raised from inside a takeover painted BEHIND the
// takeover it was raised from: `.a-confirm` resolved to 60 (the ds Sheet
// layer) and `.a-tk-scrim` to 70 (the dialog layer), so elementFromPoint at the
// centre of "Schedule it" returned the takeover's own date input and Schedule
// appeared to do nothing.
//
// The fix is a token, so the guard is a token check: whatever `.a-confirm`
// resolves to has to outrank EVERY authored `.a-tk-scrim` z-index, in every
// sheet under src/. This reads the SHIPPED css through the same `?raw` import
// the bundler resolves, so a new takeover that names its own layer is caught
// here and not on a phone.

/** Comments are stripped first: several of these rules explain their own layer
 * in a comment sitting between the previous declaration and `z-index`, which a
 * declaration-level match would otherwise read straight past. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const SRC = join(process.cwd(), 'src')

function cssFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...cssFiles(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

const sheets = cssFiles(SRC)
const all = sheets.map(f => strip(readFileSync(f, 'utf8'))).join('\n')

/** The `--ds-z-*` ladder, as tokens.css declares it. */
const tokens: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  const tokensCss = readFileSync(join(SRC, 'ds/tokens.css'), 'utf8')
  for (const m of strip(tokensCss).matchAll(/(--ds-z-[a-z]+)\s*:\s*(\d+)/g)) out[m[1]] = Number(m[2])
  return out
})()

/** Every authored z-index on a rule whose selector names `cls`, resolved. */
function zFor(cls: string): number[] {
  const found: number[] = []
  // Rule bodies only: `<selectors> { ... }`. Nothing in this codebase nests.
  for (const m of all.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].includes(cls)) continue
    const z = m[2].match(/(?:^|;)\s*z-index\s*:\s*([^;}]+)/)
    if (!z) continue
    const raw = z[1].trim()
    const named = raw.match(/var\(\s*(--ds-z-[a-z]+)\s*\)/)
    if (named) {
      expect(tokens[named[1]], `${named[1]} is declared in tokens.css`).toBeTypeOf('number')
      found.push(tokens[named[1]])
    } else if (/^\d+$/.test(raw)) {
      found.push(Number(raw))
    }
  }
  return found
}

describe('the floating layer ladder', () => {
  it('reads every css sheet in src', () => {
    expect(sheets.length).toBeGreaterThan(10)
  })

  it('declares a confirm layer above the dialog and sheet layers', () => {
    expect(tokens['--ds-z-confirm']).toBeGreaterThan(tokens['--ds-z-dialog'])
    expect(tokens['--ds-z-confirm']).toBeGreaterThan(tokens['--ds-z-sheet'])
  })

  it('puts .a-confirm above every takeover scrim', () => {
    const confirm = zFor('.a-confirm')
    const scrims = zFor('.a-tk-scrim')
    expect(confirm.length, 'at least one .a-confirm z-index is authored').toBeGreaterThan(0)
    expect(scrims.length, 'at least one .a-tk-scrim z-index is authored').toBeGreaterThan(0)
    expect(Math.min(...confirm)).toBeGreaterThan(Math.max(...scrims))
  })

  it('raises the confirm together with the scrim it opens with', () => {
    // chrome.css names the sheet's immediate previous sibling, so the pair
    // travels as one and neither half can be left under a window.
    expect(all).toMatch(/\.ds-scrim:has\(\s*\+\s*\.a-confirm\s*\)/)
  })

  it('leaves every ds sheet at or above its own scrim layer', () => {
    const sheetZ = zFor('.ds-sheet')
    expect(sheetZ.length).toBeGreaterThan(0)
    expect(Math.min(...sheetZ)).toBeGreaterThanOrEqual(tokens['--ds-z-sheet'])
  })
})
