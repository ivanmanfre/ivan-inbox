// _shots.mjs — both lanes, both widths, list AND the open draft window.
//
// Run it against the LIVE deploy for the before-shots and again after the
// deploy lands, so the pair is the same script against the same rows.
//
// Usage: node _shots.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'https://ivanmanfre.github.io/ivan-inbox/'
mkdirSync(outDir, { recursive: true })
const session = readFileSync(new URL('../../.session.json', import.meta.url), 'utf8')

const M = { w: 390, h: 852, tag: '390' }
const D = { w: 1440, h: 900, tag: '1440' }
const browser = await chromium.launch()
const report = []

async function shot(name, vp, body) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await page.goto(`${baseUrl}#exp/v2/content`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(3000)
  let claims = {}
  try { claims = (await body(page)) ?? {} } catch (e) { claims = { harnessError: String(e).slice(0, 160) } }
  await page.screenshot({ path: `${outDir}/${name}-${vp.tag}.png`, fullPage: false })
  report.push({ name, tag: vp.tag, errors, ...claims })
  console.log(`${name}/${vp.tag}  err=${errors.length}  ${JSON.stringify(claims).slice(0, 300)}`)
  await ctx.close()
}

const laneChip = (page, label) => page.locator('.chips .chip', { hasText: label }).first()
// Every visible decision control in the open window, verbatim.
const ACTS = () => [...document.querySelectorAll('.dw-acts .dw-key, .wb-delbtn, .dw-clientnote')]
  .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())

for (const vp of [D, M]) {
  await shot('ivan-list', vp, async page => ({
    sections: (await page.locator('.wb-sech-t').allInnerTexts()).slice(0, 10).map(s => s.replace(/\s+/g, ' ')),
    cards: await page.locator('.ct-card:not(.ct-idea)').count(),
  }))
}

for (const vp of [D, M]) {
  await shot('mattan-list', vp, async page => {
    await laneChip(page, 'Mattan Danino').click()
    await page.waitForTimeout(3000)
    return {
      hero: (await page.locator('.wb-pipe-big').first().innerText().catch(() => '')),
      heroLbl: (await page.locator('.wb-pipe-lbl').first().innerText().catch(() => '')).replace(/\s+/g, ' '),
      sections: (await page.locator('.wb-sech-t').allInnerTexts()).slice(0, 12).map(s => s.replace(/\s+/g, ' ')),
      cards: await page.locator('.ct-card:not(.ct-idea)').count(),
    }
  })
}

// The WINDOW on a Mattan row — the surface Ivan says has no actions.
for (const vp of [D, M]) {
  await shot('mattan-window', vp, async page => {
    await laneChip(page, 'Mattan Danino').click()
    await page.waitForTimeout(3000)
    await page.locator('.ct-card:not(.ct-idea)').first().click()
    await page.waitForTimeout(2500)
    return {
      title: (await page.locator('.dw-cap-t').first().innerText().catch(() => '')).slice(0, 70),
      chips: (await page.locator('.dw-main-in .ct-chip, .dw-main-in .ct-lane').allInnerTexts()).slice(0, 6),
      actions: await page.evaluate(ACTS),
    }
  })
}

// …and on an Ivan row, so the 44c84c7 lane is proven untouched.
for (const vp of [D]) {
  await shot('ivan-window', vp, async page => {
    await page.locator('.ct-card:not(.ct-idea)').first().click()
    await page.waitForTimeout(2500)
    return { actions: await page.evaluate(ACTS) }
  })
}

console.log(`\n${JSON.stringify(report, null, 2)}`)
await browser.close()
