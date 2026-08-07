// p4b-final2.mjs — candidate B (dense-operator), POST-BALLOT fix pass.
// Navigate + screenshot ONLY. Never clicks an action button.
//
// It measures the three things the ballot's fix spec named, plus the floors
// that must not move:
//   1. the command strip wraps rather than truncating below ~1200px
//      (measured at 1100 as well as 1440);
//   2. the error chip stays inside the viewport after the mobile strip's
//      scroller is driven to its end — a pinned alarm, not a scrolled one;
//   3. the QA tab's default height against the rail's own column.
//
// Usage: node scripts/p4b-final2.mjs <outDir> <baseUrl> [tag]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:4183/'
const tag = process.argv[4] ?? ''
mkdirSync(outDir, { recursive: true })
const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null

const D = { w: 1440, h: 900, t: 'desktop' }
const N = { w: 1100, h: 900, t: 'narrow' }
const M = { w: 390, h: 844, t: 'mobile' }

const MEASURE = function () {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }
  }
  const firstRow = (() => {
    const el = [...document.querySelectorAll('.ct-card, .ct-idea')].find(vis)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), h: Math.round(r.height) }
  })()
  const rowsInView = [...document.querySelectorAll('.ct-card')].filter((el) => {
    if (!vis(el)) return false
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  }).length
  const leaves = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
  const smallText = leaves
    .map((el) => ({ px: +(parseFloat(getComputedStyle(el).fontSize) || 0).toFixed(1), c: el.className, t: (el.textContent ?? '').trim().slice(0, 28) }))
    .filter((x) => x.px > 0 && x.px < 11)
  const tinyTaps = [...document.querySelectorAll('button, a, [role="button"], summary, .tb, .wb-rj')]
    .filter(vis).map((el) => {
      const r = el.getBoundingClientRect()
      return { c: String(el.className).slice(0, 34), w: Math.round(r.width), h: Math.round(r.height) }
    }).filter((x) => x.h < 32)
  const clipped = leaves.filter((el) => el.scrollWidth > el.clientWidth + 1)
    .filter((el) => {
      const s = getComputedStyle(el)
      return s.textOverflow === 'clip' && s.overflowX !== 'auto' && s.overflowX !== 'scroll'
    }).map((el) => `${el.className}: ${(el.textContent ?? '').trim().slice(0, 30)}`)
  // ITEM 1 — the strip's own geometry. `lines` counts distinct flex rows by
  // grouping the strip's laid-out children on their top edge; a self-truncating
  // search field is a field whose scrollWidth exceeds its box.
  const cmd = document.querySelector('.ct-cmd')
  const strip = (() => {
    if (!cmd) return null
    const tops = new Set()
    const walk = (el) => {
      for (const c of el.children) {
        if (getComputedStyle(c).display === 'contents') { walk(c); continue }
        if (!vis(c)) continue
        tops.add(Math.round(c.getBoundingClientRect().top))
      }
    }
    walk(cmd)
    const search = document.querySelector('.ct-cmd-f .ct-fsearch')
    const r = cmd.getBoundingClientRect()
    return {
      h: Math.round(r.height),
      lines: tops.size,
      lineTops: [...tops].sort((a, b) => a - b),
      searchW: search ? Math.round(search.getBoundingClientRect().width) : null,
      searchPlaceholderCut: search ? search.scrollWidth > search.clientWidth + 1 : null,
      cadText: (document.querySelector('.ct-cmd-cad')?.textContent ?? '').trim(),
      totText: (document.querySelector('.ct-cmd-tot')?.textContent ?? '').trim(),
    }
  })()
  const d = document.documentElement
  const insp = document.querySelector('.dw-insp')
  const tabbody = document.querySelector('.dw-tabbody')
  return {
    docOverflow: d.scrollWidth > d.clientWidth,
    loginVisible: !!document.body.textContent?.includes('Send me a code'),
    bands: { cmd: box('.ct-cmd'), sech: box('.wb-sech-strip') },
    firstRow, rowsInView, strip,
    smallText: smallText.slice(0, 12), tinyTaps: tinyTaps.slice(0, 12), clipped: clipped.slice(0, 8),
    insp: insp ? { scrollH: insp.scrollHeight, clientH: insp.clientHeight } : null,
    // ITEM 3 — the QA panel's own default height, against the rail's column.
    qaTab: tabbody
      ? {
        activeTab: (document.querySelector('.dw-tab.on .dw-tab-n')?.textContent ?? '').trim(),
        bodyH: Math.round(tabbody.getBoundingClientRect().height),
        bodyScrollH: tabbody.scrollHeight,
        railClientH: insp ? insp.clientHeight : null,
        screens: insp && insp.clientHeight
          ? +(insp.scrollHeight / insp.clientHeight).toFixed(2) : null,
        // Every evidence fold, and whether it is shut in the default state —
        // the rewrite is the one the spec named, so it is called out by itself.
        folds: [...document.querySelectorAll('.dw-tabbody details')].map(
          (el) => ({ s: (el.querySelector('summary')?.textContent ?? '').trim().slice(0, 60), open: el.open })),
        rewriteFolded: (() => {
          const f = [...document.querySelectorAll('.dw-tabbody details.qa-fold')]
            .find((el) => /applied rewrite/i.test(el.querySelector('summary')?.textContent ?? ''))
          return f ? !f.open : null
        })(),
      }
      : null,
  }
}

// ITEM 2 — drive the mobile strip's scroller to its end and ask whether the
// alarm is still on screen. A pinned chip does not move; a scrolled one leaves.
const PIN_PROBE = function () {
  const sc = document.querySelector('.ct-cmd-scroll')
  const chip = document.querySelector('.ct-alert-chip')
  if (!chip) return { present: false }
  const before = chip.getBoundingClientRect()
  let scrolled = 0
  if (sc) {
    sc.scrollLeft = sc.scrollWidth
    scrolled = sc.scrollLeft
  }
  const after = chip.getBoundingClientRect()
  return {
    present: true,
    scrollerMax: sc ? sc.scrollWidth - sc.clientWidth : null,
    scrolledTo: scrolled,
    beforeLeft: Math.round(before.left), afterLeft: Math.round(after.left),
    afterRight: Math.round(after.right),
    // the whole chip, inside the viewport, after the scroller has been driven
    visibleAfterScroll: after.left >= -0.5 && after.right <= window.innerWidth + 0.5
      && after.width > 0,
  }
}

const SHOTS = [
  { name: 'content', hash: '#exp/v2c/content', at: [D, N, M], pin: true },
  { name: 'draftpane', hash: '#exp/v2c/content', at: [D, M], open: true },
  { name: 'sends', hash: '#exp/v2c/sends', at: [M] },
  { name: 'dms', hash: '#exp/v2c/dms', at: [M, D] },
  { name: 'styles', hash: '#exp/v2c/styles', at: [D] },
  { name: 'magnets', hash: '#exp/v2c/magnets', at: [D] },
  { name: 'today', hash: '#exp/v2c/today', at: [D] },
  { name: 'ops', hash: '#exp/v2c/ops', at: [D] },
]

// Only the three the ballot asked to see are written under the FINAL2 name.
const KEEP = new Set(['content-desktop', 'content-mobile', 'draftpane-desktop'])

const browser = await chromium.launch()
const report = []
for (const s of SHOTS) {
  for (const vp of s.at) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
    if (session) {
      await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
        ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
    }
    await page.goto(`${baseUrl}${s.hash}`, { waitUntil: 'networkidle', timeout: 60000 })
      .catch((e) => errors.push(`goto: ${String(e).slice(0, 120)}`))
    await page.waitForTimeout(2600)
    if (s.open) {
      // Opening a draft is NAVIGATION (it renders a read pane); it writes
      // nothing. Never touches Approve/Skip/Regenerate/Delete.
      try {
        const row = page.locator('#wb-s-review .ct-card, .ct-card:not(.ct-idea)').first()
        await row.click({ timeout: 8000 })
        await page.waitForTimeout(2200)
      } catch (e) { errors.push(`open: ${String(e).slice(0, 90)}`) }
    }
    const m = await page.evaluate(MEASURE)
    const key = `${s.name}-${vp.t}`
    const file = KEEP.has(key) ? `${outDir}/${tag}${vp.t}-${s.name}.png` : `${outDir}/_${key}.png`
    await page.screenshot({ path: file })
    let pin = null
    if (s.pin && vp.t === 'mobile') {
      pin = await page.evaluate(PIN_PROBE)
      await page.screenshot({ path: `${outDir}/_pin-after-scroll-mobile.png` })
    }
    report.push({ shot: s.name, vp: vp.t, file, ...m, pin, errors })
    console.log(
      `${key} firstRow=${m.firstRow?.top} rows=${m.rowsInView} stripH=${m.strip?.h} lines=${m.strip?.lines}`
      + ` searchCut=${m.strip?.searchPlaceholderCut} small=${m.smallText.length} tiny=${m.tinyTaps.length}`
      + ` clip=${m.clipped.length} err=${errors.length} qa=${m.qaTab?.screens}`
      + (pin ? ` pin=${pin.visibleAfterScroll}` : ''))
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${outDir}/${tag}measure.json`, JSON.stringify(report, null, 2))
console.log(`→ ${outDir}/${tag}measure.json`)
