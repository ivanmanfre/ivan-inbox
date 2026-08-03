// Open the draft takeover window on a given base URL and shoot it at 1440 + 390.
// Also opens a lead magnet. Usage: node _shots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'https://ivanmanfre.github.io/ivan-inbox/'
const OUT = process.argv[3] ?? './before'
mkdirSync(OUT, { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

const browser = await chromium.launch()
const report = {}

async function shoot(w, h, job, sel, name) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
  }, [session])
  await page.goto(`${BASE}#exp/v2/${job}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(5000)
  // open the first row
  const row = await page.$(sel)
  if (!row) { report[name] = { error: `no row for ${sel}`, errors }; await page.close(); return }
  await row.click()
  await page.waitForTimeout(3500)
  const tk = await page.$('.wb-tk')
  if (!tk) { report[name] = { error: 'window did not open', errors }; await page.close(); return }
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await tk.screenshot({ path: `${OUT}/${name}-win.png` }).catch(() => {})
  // full-height of the window body
  const m = await page.evaluate(() => {
    const tk = document.querySelector('.wb-tk')
    const body = document.querySelector('.wb-tk-body')
    const col = document.querySelector('.wb-tk-col')
    const r = tk?.getBoundingClientRect()
    return {
      windowW: r ? Math.round(r.width) : null,
      windowH: r ? Math.round(r.height) : null,
      scrollH: body ? body.scrollHeight : null,
      clientH: body ? body.clientHeight : null,
      colW: col ? Math.round(col.getBoundingClientRect().width) : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      blocks: [...document.querySelectorAll('.wb-tk .dd-blk, .wb-tk [class*="blk"]')].length,
    }
  })
  report[name] = { ...m, errors }
  await page.close()
}

await shoot(1440, 900, 'content', '.ct-card', 'draft-1440')
await shoot(390, 844, 'content', '.ct-card', 'draft-390')
await shoot(1440, 900, 'magnets', '.ct-card, .lm-card, [class*="card"]', 'magnet-1440')
await shoot(390, 844, 'magnets', '.ct-card, .lm-card, [class*="card"]', 'magnet-390')

console.log(JSON.stringify(report, null, 2))
await browser.close()
