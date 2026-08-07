// p4b-shots.mjs — candidate B (dense-operator) verification.
// Navigate + screenshot ONLY. Never clicks an action button.
// Usage: node scripts/p4b-shots.mjs <outDir> <baseUrl> [tag]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:4183/'
const tag = process.argv[4] ?? ''
mkdirSync(outDir, { recursive: true })
const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null

const D = { w: 1440, h: 900, t: 'desktop' }
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
  // rows fully inside the first viewport
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
  const tinyTaps = [...document.querySelectorAll('button, a, [role="button"], .tb, .wb-rj')]
    .filter(vis).map((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      const ext = s.getPropertyValue('--hit') // informational only
      return { c: String(el.className).slice(0, 34), w: Math.round(r.width), h: Math.round(r.height), ext }
    }).filter((x) => x.h < 32)
  const clipped = leaves.filter((el) => el.scrollWidth > el.clientWidth + 1)
    .filter((el) => {
      const s = getComputedStyle(el)
      return s.textOverflow === 'clip' && s.overflowX !== 'auto' && s.overflowX !== 'scroll'
    }).map((el) => `${el.className}: ${(el.textContent ?? '').trim().slice(0, 30)}`)
  const d = document.documentElement
  const insp = document.querySelector('.dw-insp')
  return {
    docOverflow: d.scrollWidth > d.clientWidth,
    loginVisible: !!document.body.textContent?.includes('Send me a code'),
    bands: {
      workhead: box('.wb-workhead'), head: box('.nav.wb-head'), cmd: box('.ct-cmd'),
      alert: box('.ct-alert'), chart: box('.wb-chartcard'), filters: box('.ct-filters'),
      sech: box('.wb-sech-strip'),
    },
    firstRow, rowsInView,
    smallText: smallText.slice(0, 12), tinyTaps: tinyTaps.slice(0, 12), clipped: clipped.slice(0, 8),
    insp: insp ? { scrollH: insp.scrollHeight, clientH: insp.clientHeight } : null,
  }
}

const SHOTS = [
  { name: 'content', hash: '#exp/v2c/content', at: [D, M] },
  { name: 'draftpane', hash: '#exp/v2c/content', at: [D, M], open: true },
  { name: 'sends', hash: '#exp/v2c/sends', at: [M] },
  { name: 'dms', hash: '#exp/v2c/dms', at: [M, D] },
  { name: 'styles', hash: '#exp/v2c/styles', at: [D] },
  { name: 'magnets', hash: '#exp/v2c/magnets', at: [D] },
  { name: 'today', hash: '#exp/v2c/today', at: [D] },
  { name: 'ops', hash: '#exp/v2c/ops', at: [D] },
]

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
      // Opening a draft is NAVIGATION (it renders a read pane); it writes nothing.
      // Never touches Approve/Skip/Regenerate/Delete.
      try {
        // A DRAFT row, never the ideas band above it (an idea card expands in
        // place; it is not the draft window). Falls back to any draft card.
        const row = page.locator('#wb-s-review .ct-card, .ct-card:not(.ct-idea)').first()
        await row.click({ timeout: 8000 })
        await page.waitForTimeout(2200)
      } catch (e) { errors.push(`open: ${String(e).slice(0, 90)}`) }
    }
    const m = await page.evaluate(MEASURE)
    const file = `${outDir}/${tag}${s.name}-${vp.t}.png`
    await page.screenshot({ path: file })
    report.push({ shot: s.name, vp: vp.t, file, ...m, errors })
    console.log(`${s.name}/${vp.t} firstRow=${m.firstRow?.top} rowsInView=${m.rowsInView} small=${m.smallText.length} tiny=${m.tinyTaps.length} clip=${m.clipped.length} err=${errors.length} insp=${m.insp?.scrollH}`)
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${outDir}/${tag}measure.json`, JSON.stringify(report, null, 2))
console.log(`→ ${outDir}/${tag}measure.json`)
