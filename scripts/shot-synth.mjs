// shot-synth.mjs — capture Sends > Overview (synthesis) for Ivan + Rise at
// mobile + desktop. Injects the minted session, clicks Sends, toggles the chip,
// asserts no horizontal overflow (documentElement + inner scroller), then
// screenshots. The app scrolls an inner container (.rows.ov) inside a fixed
// height .app, so we mount with a very tall viewport — the inner scroller then
// fits all content without scrolling and a fullPage shot grabs the whole page.
// (No DOM mutation: expanding .app on desktop remounts the view → refetch.)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://localhost:4334/'
const OUT = process.argv[3] || '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/sends-kpi-elevation-2026-07-24/phase-ui/judge-crops'
const session = readFileSync(new globalThis.URL('../.session.json', import.meta.url), 'utf8')

const TALL = 3400
const shots = [
  { name: 's-ivan-mobile', w: 393, chip: 'Ivan' },
  { name: 's-ivan-desktop', w: 1280, chip: 'Ivan' },
  { name: 's-rise-mobile', w: 393, chip: 'Rise' },
  { name: 's-rise-desktop', w: 1280, chip: 'Rise' },
]

const browser = await chromium.launch()
let anyFail = false
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: TALL }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(([tok]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', tok)
  }, [session])
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.getByText('Sends', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(700)
  await page.getByText(s.chip, { exact: true }).first().click().catch(() => {})
  // The chip switch re-fetches; a heavy 4000-row inbox query competes, so wait
  // for the last section (Seats) and confirm the Loading placeholder is gone.
  await page.waitForSelector('.ov-seats', { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(
    () => { const o = document.querySelector('.ov'); return o && !o.innerText.includes('Loading') },
    { timeout: 30000 },
  ).catch(() => {})
  await page.waitForTimeout(900)

  // Overflow asserts — width-based, so a tall viewport doesn't affect them.
  const of = await page.evaluate(() => {
    const de = document.documentElement
    const sc = document.querySelector('.ov') || de
    return { docW: de.scrollWidth, docC: de.clientWidth, scW: sc.scrollWidth, scC: sc.clientWidth }
  })
  const docOK = of.docW === of.docC
  const scOK = of.scW === of.scC
  if (!docOK || !scOK) anyFail = true

  // Clip to actual content height (tall viewport leaves dead space below).
  const clipH = await page.evaluate(() => {
    const o = document.querySelector('.ov')
    const b = o ? o.getBoundingClientRect().bottom : document.body.scrollHeight
    return Math.ceil(b + 16)
  })
  const path = `${OUT}/${s.name}.png`
  await page.screenshot({ path, clip: { x: 0, y: 0, width: s.w, height: clipH } })
  console.log(
    `${s.name} [${s.w}px] -> ${path}\n` +
    `   doc ${of.docW}===${of.docC} ${docOK ? 'OK' : 'FAIL'} | scroller ${of.scW}===${of.scC} ${scOK ? 'OK' : 'FAIL'} | ` +
    `${errors.length ? 'CONSOLE ERRORS: ' + errors.slice(0, 5).join(' | ') : 'console clean'}`
  )
  await page.close()
  await ctx.close()
}
await browser.close()
process.exit(anyFail ? 1 : 0)
