// Phase 0 baseline capture — the ten worst workbench surfaces, authed, real
// data, BEFORE any polish work lands. Re-run verbatim (same SURFACES array,
// same viewport math) against the same build for the "after" set so the two
// runs are the same instrument pointed at two different builds.
//
// Auth: injects the live Supabase session from .session.json into
// localStorage key sb-bjbvqvzbzczjbatgmccb-auth-token, exactly like
// goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs (lines 13-19).
// Safety: EVERY context installs the write interceptor below BEFORE any
// navigation — it fulfils PATCH/PUT/DELETE and non-/rpc/ POST against
// **/rest/v1/** with {status:200, body:'[]'} instead of letting them reach
// Supabase, because opening a thread stamps read_at on a live row. Every
// intercepted call is counted and the total is printed at the end.
//
// Usage: node capture.mjs [baseUrl] [outDir]
//   baseUrl defaults to http://localhost:4173/
//   outDir  defaults to ../before (relative to this file) — pass ../after
//           for the after-run.

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:4173/'
const OUT_DIR = process.argv[3]
  ? join(__dirname, process.argv[3])
  : join(__dirname, '..', 'before')
const EVIDENCE_DIR = __dirname

mkdirSync(OUT_DIR, { recursive: true })

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

// ---------------------------------------------------------------------------
// The surface list — a DATA ARRAY so the after-run is the identical script
// pointed at a different build. Each entry:
//   id        — used in the output filename, NN-<id>
//   label     — human label for baseline.md
//   hash      — the fresh-load URL (route.ts: #exp/v2/<job>[/chat])
//   act(page) — optional extra steps AFTER the base hash load (click a tab,
//               open a row, open a peer). Runs once per viewport/theme combo,
//               because the takeover/peer state is not part of the hash for
//               a draft/thread (route.ts: "a thread/draft peer key is a
//               database id, and a URL that pretends to restore one would
//               404 into an empty pane" — so we click to it every time).
//   viewports — extra viewports beyond the default two, per the brief
//               (2560x1440 for surfaces 2 and 3 only)
//   themes    — 'dark' always; 'light' added only where the brief says
//               (2, 3, 7) to keep runtime down, as permitted by the brief.
//   fullPage  — true for list surfaces, false (viewport-only) for
//               takeovers/overlays
//   crops     — optional extra named crops: {name, selector} pairs,
//               captured once at 1440x900 and 390x844, dark only
//   hoverTooltip — optional extra shot: hover a selector, screenshot at
//               1440x900 dark only (surface 2's named defect)
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
]
const WIDE_VIEWPORT = { w: 2560, h: 1440 }

export const SURFACES = [
  {
    id: '01-content-list',
    label: 'Content lane, List tab',
    hash: '#exp/v2/content',
    fullPage: true,
    themes: ['dark'],
  },
  {
    id: '02-content-calendar',
    label: 'Content lane, Calendar tab',
    hash: '#exp/v2/content',
    act: async page => {
      await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
      await page.waitForTimeout(600)
    },
    fullPage: true,
    themes: ['dark', 'light'],
    extraViewports: [WIDE_VIEWPORT],
    hoverTooltip: { selector: '.cal-chip-t', viewport: { w: 1440, h: 900 }, theme: 'dark' },
  },
  {
    id: '03-draft-window',
    label: 'A draft opened in the draft window / takeover',
    hash: '#exp/v2/content',
    act: async page => {
      await page.locator('.ct-card').first().click().catch(() => {})
      await page.waitForTimeout(900)
    },
    fullPage: false,
    themes: ['dark', 'light'],
    extraViewports: [WIDE_VIEWPORT],
    crops: [
      { name: 'actions', selector: '.dw-acts' },
      { name: 'inspector', selector: '.dw-insp' },
    ],
  },
  {
    id: '04-content-strategy',
    label: 'Content lane, Strategy tab',
    hash: '#exp/v2/strategy',
    fullPage: true,
    themes: ['dark'],
  },
  {
    id: '05-content-styles',
    label: 'Content lane, Styles tab',
    hash: '#exp/v2/styles',
    fullPage: true,
    themes: ['dark'],
  },
  {
    id: '06-ops-lane',
    label: 'Ops lane (default view)',
    hash: '#exp/v2/ops',
    fullPage: true,
    themes: ['dark'],
  },
  {
    id: '07-dms-list',
    label: 'DMs lane, list',
    hash: '#exp/v2/dms',
    fullPage: true,
    themes: ['dark', 'light'],
  },
  {
    id: '08-dms-thread',
    label: 'DMs lane, a thread opened (ThreadPeer)',
    hash: '#exp/v2/dms',
    act: async page => {
      await page.locator('.rows .r').first().click().catch(() => {})
      await page.waitForTimeout(900)
    },
    fullPage: false,
    themes: ['dark'],
  },
  {
    id: '09-magnets-lane',
    label: 'Magnets lane',
    hash: '#exp/v2/magnets',
    fullPage: true,
    themes: ['dark'],
  },
  {
    id: '10a-command-palette',
    label: 'The command palette open',
    hash: '#exp/v2/dms',
    act: async page => {
      await page.keyboard.press('Meta+k').catch(() => {})
      await page.waitForTimeout(150)
      // Ctrl+k too, in case the recorded browser isn't macOS-mapped.
      const hasPalette = await page.locator('.wb-palette, [class*=palette]').count()
      if (!hasPalette) {
        await page.keyboard.press('Control+k').catch(() => {})
        await page.waitForTimeout(300)
      }
    },
    fullPage: false,
    themes: ['dark'],
  },
  {
    id: '10b-claude-chat',
    label: 'The Claude chat pane open',
    hash: '#exp/v2/dms',
    act: async page => {
      await page.keyboard.press('Escape').catch(() => {})
      await page.locator('.wb-rj-peer').first().click({ timeout: 3000 }).catch(async () => {
        // mobile: the Claude tab in the bottom bar
        await page.getByText('Claude', { exact: true }).last().click().catch(() => {})
      })
      await page.waitForTimeout(900)
    },
    fullPage: false,
    themes: ['dark'],
  },
]

// ---------------------------------------------------------------------------
// Write interceptor — installed BEFORE every navigation, per page context.
// Copied verbatim in spirit from chip-probe.mjs lines 13-19.
// ---------------------------------------------------------------------------
let interceptedWrites = 0
async function installInterceptor(page) {
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      interceptedWrites++
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
}

async function setTheme(ctx, theme) {
  if (theme === 'light') {
    await ctx.addInitScript(() => { localStorage.setItem('inbox-theme', 'light') })
  }
}

async function newPage(browser, viewport, theme) {
  const ctx = await browser.newContext({ viewport: { width: viewport.w, height: viewport.h } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  await setTheme(ctx, theme)
  const page = await ctx.newPage()
  await installInterceptor(page)
  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(String(err)))
  return { ctx, page, consoleErrors }
}

// Overflow probe: any element with scrollWidth > clientWidth + 2 that is NOT
// itself a child of an overflow-x:auto scroller.
async function measurePage(page) {
  return page.evaluate(() => {
    const overflow = []
    const all = document.querySelectorAll('body *')
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue
      const parentOverflowX = el.parentElement
        ? getComputedStyle(el.parentElement).overflowX
        : 'visible'
      if (parentOverflowX === 'auto' || parentOverflowX === 'scroll') continue
      if (el.scrollWidth > el.clientWidth + 2) {
        overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })
      }
    }
    return {
      pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      overflow: overflow.slice(0, 40), // cap noise
      overflowCount: overflow.length,
    }
  })
}

async function shootCrop(page, selector, path) {
  const loc = page.locator(selector).first()
  const count = await loc.count()
  if (!count) return false
  const box = await loc.boundingBox().catch(() => null)
  if (!box) return false
  await page.screenshot({ path, quality: 82, type: 'jpeg', clip: box })
  return true
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const browser = await chromium.launch()
  const metrics = {}
  const shots = []

  for (const surf of SURFACES) {
    const viewports = [...DEFAULT_VIEWPORTS, ...(surf.extraViewports || [])]
    for (const vp of viewports) {
      for (const theme of surf.themes) {
        const vpTag = `${vp.w}x${vp.h}`
        const shotName = `${surf.id}-${vpTag}-${theme}.jpg`
        const { ctx, page, consoleErrors } = await newPage(browser, vp, theme)
        try {
          await page.goto(BASE + surf.hash, { waitUntil: 'networkidle', timeout: 30000 })
          await page.waitForTimeout(1200)
          if (surf.act) await surf.act(page)
          await page.waitForTimeout(300)

          const shotPath = join(OUT_DIR, shotName)
          await page.screenshot({ path: shotPath, quality: 82, type: 'jpeg', fullPage: !!surf.fullPage })
          shots.push(shotName)

          const m = await measurePage(page)
          metrics[`${surf.id}-${vpTag}-${theme}`] = {
            label: surf.label,
            viewport: vpTag,
            theme,
            consoleErrorCount: consoleErrors.length,
            consoleErrors: consoleErrors.slice(0, 20),
            pageHeight: m.pageHeight,
            overflowCount: m.overflowCount,
            overflow: m.overflow,
          }

          // crops — only at the default two viewports, dark theme, as scoped
          if (surf.crops && theme === 'dark' && (vp.w === 1440 || vp.w === 390)) {
            for (const crop of surf.crops) {
              const cropName = `${surf.id}-${crop.name}-${vpTag}-${theme}.jpg`
              const ok = await shootCrop(page, crop.selector, join(OUT_DIR, cropName))
              if (ok) shots.push(cropName)
            }
          }

          // hover-tooltip extra shot — once, at its specified viewport/theme
          if (surf.hoverTooltip && vp.w === surf.hoverTooltip.viewport.w && theme === surf.hoverTooltip.theme) {
            const el = page.locator(surf.hoverTooltip.selector).first()
            if (await el.count()) {
              await el.hover().catch(() => {})
              await page.waitForTimeout(700)
              const hoverName = `${surf.id}-hover-${vpTag}-${theme}.jpg`
              await page.screenshot({ path: join(OUT_DIR, hoverName), quality: 82, type: 'jpeg', fullPage: false })
              shots.push(hoverName)
            }
          }

          console.log(`OK  ${shotName}  console_errors=${consoleErrors.length}  overflow=${m.overflowCount}  h=${m.pageHeight}`)
        } catch (e) {
          console.error(`FAIL ${surf.id} ${vpTag} ${theme}:`, e.message)
          metrics[`${surf.id}-${vpTag}-${theme}`] = { label: surf.label, viewport: vpTag, theme, error: String(e.message) }
        } finally {
          await ctx.close()
        }
      }
    }
  }

  await browser.close()

  writeFileSync(join(EVIDENCE_DIR, 'baseline-metrics.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    base: BASE,
    interceptedWrites,
    shots,
    metrics,
  }, null, 2))

  console.log(`\nDONE. ${shots.length} shots. Intercepted writes: ${interceptedWrites}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
