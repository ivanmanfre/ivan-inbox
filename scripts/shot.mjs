// shot.mjs — screenshot the app with the minted session injected before load.
// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [hashRoute]
// Special: node scripts/shot.mjs <url> <outPrefix> --today
//   captures Today tab at 390 and 1280 widths, outputting:
//   <outPrefix>-390.png and <outPrefix>-1280.png
// Requires .session.json from scripts/dev-login.mjs. Console errors are printed.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const url = args[0]
const outOrPrefix = args[1]
const widthOrFlag = args[2]
const heightOrIgnored = args[3]
const routeOrIgnored = args[4]

const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

// Special handling for --today flag: capture at both 390 and 1280 widths
if (widthOrFlag === '--today') {
  const browser = await chromium.launch()
  const widths = [390, 1280]

  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 852 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.addInitScript(([s]) => {
      localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    }, [session])

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    // Navigate to Today tab using the hash route
    await page.goto(url + '#today', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const out = `${outOrPrefix}-${width}.png`
    await page.screenshot({ path: out })
    console.log(`shot -> ${out}`)
    if (errors.length) { console.log('CONSOLE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
    else console.log('console clean')

    await page.close()
  }

  await browser.close()
} else {
  // Standard single-screenshot mode
  const w = widthOrFlag || '393'
  const h = heightOrIgnored || '852'
  const route = routeOrIgnored || ''

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
  await page.screenshot({ path: outOrPrefix })
  console.log(`shot -> ${outOrPrefix}`)
  if (errors.length) { console.log('CONSOLE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
  else console.log('console clean')
  await browser.close()
}
