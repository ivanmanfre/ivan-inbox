// shot.mjs — screenshot the app with the minted session injected before load.
// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [hashRoute]
// Requires .session.json from scripts/dev-login.mjs. Console errors are printed.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [url, out, w = '393', h = '852', route = ''] = process.argv.slice(2)
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +w, height: +h } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
}, [session])
await page.goto(url + route, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: out })
console.log(`shot -> ${out}`)
if (errors.length) { console.log('CONSOLE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
else console.log('console clean')
await browser.close()
