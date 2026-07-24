// shot-overview.mjs — capture the new Sends > Overview at mobile + desktop for
// Ivan and Rise. Injects the minted session, clicks the Sends tab, toggles the
// person chip, screenshots. Prints console errors per shot.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const APP_URL = process.argv[2] || 'http://localhost:5173/'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/719688d6-6609-48c7-9161-61c2ec6a606d/scratchpad'
const session = readFileSync(new globalThis.URL('../.session.json', import.meta.url), 'utf8')

const shots = [
  { name: 'ivan-mobile', w: 393, h: 852, chip: 'Ivan' },
  { name: 'ivan-desktop', w: 1280, h: 900, chip: 'Ivan' },
  { name: 'rise-desktop', w: 1280, h: 900, chip: 'Rise' },
]

const browser = await chromium.launch()
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(([tok]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', tok)
  }, [session])
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  // click the Sends tab
  await page.getByText('Sends', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  // select the person chip (All / Ivan / Rise)
  await page.getByText(s.chip, { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  const path = `${OUT}/ov-${s.name}.png`
  await page.screenshot({ path, fullPage: true })
  console.log(`shot -> ${path}  [${errors.length ? 'ERRORS: ' + errors.slice(0, 5).join(' | ') : 'console clean'}]`)
  await page.close()
}
await browser.close()
