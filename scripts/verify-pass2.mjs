// Interactive verification for the 2nd polish pass. Injects the minted session,
// clicks through to each new surface, and captures screenshots + console errors.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const TARGET = process.argv[2] ?? 'http://localhost:4319/'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/62765410-08bf-42b8-b779-226c2424d3c2/scratchpad'
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => {
  localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
}, [session])

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  shot -> ${name}.png`)
}

// 1. Inbox loaded
await shot('p2-inbox')

// 2. Drafts tab
await page.getByText('Drafts', { exact: true }).click()
await page.waitForTimeout(600)
await shot('p2-drafts')

// 3. Confirm sheet — click first "Approve & send" button in a draft card
const approveBtn = page.locator('.qc .btn.p').first()
if (await approveBtn.count()) {
  await approveBtn.click()
  await page.waitForTimeout(500)
  await shot('p2-confirm-sheet')
  // Dismiss with Cancel so NOTHING is approved/sent.
  await page.locator('.sheet-btn.cancel').click()
  await page.waitForTimeout(400)
  console.log('  confirm sheet dismissed via Cancel (no send)')
} else {
  console.log('  NO draft cards present to test confirm sheet')
}

// 4. Mouse-drag swipe (desktop fallback) — drag a card right, capture mid-gesture
const card = page.locator('.qc').first()
if (await card.count()) {
  const box = await card.boundingBox()
  const cy = box.y + box.height / 2
  await page.mouse.move(box.x + 40, cy)
  await page.mouse.down()
  await page.mouse.move(box.x + 40 + 55, cy, { steps: 6 })
  await page.waitForTimeout(150)
  await shot('p2-swipe-mousedrag')
  // Release below threshold so it springs back (no confirm triggered).
  await page.mouse.up()
  await page.waitForTimeout(350)
  console.log('  mouse-drag swipe sprang back (below threshold)')
}

// 5. Sends tab
await page.getByText('Sends', { exact: true }).click()
await page.waitForTimeout(900)
await shot('p2-sends')

// 6. Sends drill-in — tap first lane card
const lane = page.locator('.sc').first()
if (await lane.count()) {
  await lane.click()
  await page.waitForTimeout(1200)
  await shot('p2-sends-drilldown')
  console.log('  drilled into lane')
} else {
  console.log('  NO lane cards present')
}

console.log(errors.length ? `CONSOLE ERRORS:\n  ${errors.join('\n  ')}` : 'console clean')
await browser.close()
