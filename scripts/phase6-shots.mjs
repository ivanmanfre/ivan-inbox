// Phase 6 capture + live checks.
// node scripts/phase6-shots.mjs <baseUrl> <outDir>
//
// Wait discipline per spine §12: domcontentloaded, poll until skeletons gone +
// no literal "Loading" + innerText settled. NEVER networkidle — this app holds
// an open realtime socket and can never satisfy it. A skeleton crop is a failed
// capture, never a design verdict.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5431'
const outDir = process.argv[3] ?? '/tmp/phase6-shots'
mkdirSync(outDir, { recursive: true })
const session = JSON.parse(readFileSync(new URL('../.session.json', import.meta.url), 'utf8'))

const settle = async (page) => {
  await page.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 70; i++) {
    const s = await page.evaluate(() => ({
      sk: document.querySelectorAll('.sk').length,
      loading: /\bLoading\b/.test(document.body.innerText),
      len: document.body.innerText.length,
    }))
    if (s.sk === 0 && !s.loading && s.len > 800) {
      const a = s.len
      await page.waitForTimeout(400)
      const b = await page.evaluate(() => document.body.innerText.length)
      if (a === b) return true
    }
    await page.waitForTimeout(300)
  }
  return false
}

const browser = await chromium.launch()
const errors = []
const report = {}

for (const vp of [{ w: 1440, h: 900, tag: '1440' }, { w: 390, h: 844, tag: '390' }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${vp.tag}] ${m.text().slice(0, 200)}`) })
  await page.goto(base)
  await page.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(s)), session)

  for (const route of ['content', 'sends']) {
    await page.goto(`${base}/#exp/v2/${route}`)
    await page.reload()
    const ok = await settle(page)
    await page.screenshot({ path: `${outDir}/${route}-${vp.tag}-dark.png` })

    if (route === 'content') {
      // Proof shots + the structural facts the asks are graded on.
      const facts = await page.evaluate(() => {
        const t = (el) => (el?.textContent ?? '').trim()
        const ideas = document.querySelector('#wb-s-ideas')
        const lane = document.querySelector('#wb-lm-lane')
        const chips = [...document.querySelectorAll('.ct-card:not(.ct-idea):not(.ct-res-row) .ct-meta')]
          .map(m => m.querySelectorAll(':scope > *').length)
        const ideaChips = [...document.querySelectorAll('.ct-idea .ct-idea-h .ct-meta')]
          .map(m => m.querySelectorAll(':scope > *').length)
        return {
          ideasHeader: t(ideas?.querySelector('.wb-sech')),
          ideasCollapsed: ideas ? ideas.querySelectorAll('.ct-idea').length === 0 : null,
          lmLanePresent: !!lane,
          lmLaneHeader: t(lane?.querySelector('.ct-lane-h')),
          lmCapsules: lane ? lane.querySelectorAll('.wb-caps .wb-cap, .wb-caps .wb-cap-0').length : 0,
          lmStageLabels: lane ? [...lane.querySelectorAll('.wb-caps-xl')].map(t) : [],
          lmSections: lane ? [...lane.querySelectorAll('.wb-sech')].map(t) : [],
          postChipCountsMax: chips.length ? Math.max(...chips) : null,
          postChipCountsMin: chips.length ? Math.min(...chips) : null,
          ideaChipCountsMax: ideaChips.length ? Math.max(...ideaChips) : null,
          postBarLegend: [...document.querySelectorAll('.wb-chartcard .wb-cardf .wb-legend-l')].map(t),
          qaDots: (() => {
            const o = { pass: 0, fail: 0, none: 0 }
            for (const a of document.querySelectorAll('.ct-anchor[data-qa]')) o[a.getAttribute('data-qa')]++
            return o
          })(),
        }
      })
      report[`content-${vp.tag}`] = { settled: ok, ...facts }

      // open the ideas section and shoot the proof
      const head = await page.$('#wb-s-ideas .wb-sech')
      if (head) { await head.click(); await page.waitForTimeout(600) }
      report[`content-${vp.tag}`].ideaChipsOpen = await page.evaluate(() =>
        [...document.querySelectorAll('.ct-idea .ct-idea-h .ct-meta')]
          .map(m => m.querySelectorAll(':scope > *').length))
      report[`content-${vp.tag}`].lmRowChips = await page.evaluate(() =>
        [...document.querySelectorAll('.ct-res-row .ct-meta')]
          .map(m => m.querySelectorAll(':scope > *').length))
      await page.screenshot({ path: `${outDir}/content-${vp.tag}-ideas-open.png` })
      if (head) { await head.click(); await page.waitForTimeout(300) }

      // Scroll the lane's own TOP into view (boundary rule + header + chart),
      // not just any part of it: scrollIntoViewIfNeeded landed mid-list and the
      // capture proved nothing about the lane's structure.
      await page.evaluate(() => document.querySelector('#wb-lm-lane')
        ?.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${outDir}/content-${vp.tag}-lm-lane.png` })
    }
    if (route === 'sends') {
      report[`sends-${vp.tag}`] = await page.evaluate(() => ({
        segRows: document.querySelectorAll('.seg').length,
        rangePill: (document.querySelector('.wb-fpill')?.textContent ?? '').trim(),
      }))
    }
  }

  // The slash palette, on the content route with the peer docked (1440 only).
  if (vp.tag === '1440') {
    await page.goto(`${base}/#exp/v2/content`)
    await page.reload()
    await settle(page)
    const field = await page.$('.cfield')
    if (field) {
      await field.click()
      await field.type('/')
      await page.waitForTimeout(300)
      report.palette = await page.evaluate(() => ({
        open: !!document.querySelector('.wb-palette'),
        options: [...document.querySelectorAll('.wb-pal-n')].map(e => e.textContent),
        active: document.querySelector('.wb-pal-opt.on .wb-pal-n')?.textContent ?? null,
      }))
      await page.screenshot({ path: `${outDir}/content-1440-palette.png` })
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(150)
      report.paletteAfterArrow = await page.evaluate(() =>
        document.querySelector('.wb-pal-opt.on .wb-pal-n')?.textContent ?? null)
      await field.fill('/ret')
      await page.waitForTimeout(250)
      report.paletteFiltered = await page.evaluate(() =>
        [...document.querySelectorAll('.wb-pal-n')].map(e => e.textContent))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
      report.paletteAfterEsc = await page.evaluate(() => ({
        open: !!document.querySelector('.wb-palette'),
        field: document.querySelector('.cfield')?.value ?? null,
      }))
    }
  }
  await ctx.close()
}
await browser.close()
report.consoleErrors = errors
console.log(JSON.stringify(report, null, 2))
