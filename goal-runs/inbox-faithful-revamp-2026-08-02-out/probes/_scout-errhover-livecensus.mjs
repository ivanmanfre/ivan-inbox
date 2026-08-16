import { chromium } from 'playwright'
import fs from 'fs'

const ROOT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'
const BASE = 'http://localhost:5431'
const session = JSON.parse(fs.readFileSync(ROOT + '/.session.json', 'utf8'))

async function settleInbox(page) {
  for (let i = 0; i < 60; i++) {
    const realRows = await page.locator('.r:not(.sk-r)').count()
    const failed = await page.locator('.wb-failed-t').count()
    if (realRows > 0 || failed > 0) return
    await page.waitForTimeout(1000)
  }
}

async function styleOf(el) {
  return el.evaluate(node => {
    const cs = getComputedStyle(node)
    return {
      tag: node.tagName,
      tabIndex: node.tabIndex,
      background: cs.backgroundColor,
      color: cs.color,
      boxShadow: cs.boxShadow,
      outline: cs.outlineStyle + ' ' + cs.outlineColor + ' ' + cs.outlineWidth,
      cursor: cs.cursor,
      transitionProp: cs.transitionProperty,
      transitionDur: cs.transitionDuration,
    }
  })
}

async function testEl(page, label, selector, opts = {}) {
  const loc = opts.text ? page.locator(selector).filter({ hasText: opts.text }).first() : page.locator(selector).first()
  const count = await loc.count()
  if (count === 0) return { label, selector, found: false }
  const box = await loc.boundingBox().catch(() => null)
  if (!box) return { label, selector, found: true, visible: false }

  const rest = await styleOf(loc)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(150)
  const hovered = await styleOf(loc)
  await page.mouse.move(2, 2) // move away
  await page.waitForTimeout(150)

  // focusability: try native .focus() and see if it actually took (only works if focusable)
  const focusResult = await loc.evaluate(node => {
    node.focus()
    return document.activeElement === node
  })
  let focusStyle = null
  if (focusResult) {
    focusStyle = await styleOf(loc)
  }

  const changed = (a, b, keys) => keys.some(k => a[k] !== b[k])
  return {
    label, selector, found: true, visible: true,
    tag: rest.tag, tabIndexRest: rest.tabIndex, cursor: rest.cursor,
    hoverChanged: changed(rest, hovered, ['background', 'color', 'boxShadow']),
    restBg: rest.background, hoverBg: hovered.background,
    restBoxShadow: rest.boxShadow, hoverBoxShadow: hovered.boxShadow,
    transitionAtRest: rest.transitionProp + ' ' + rest.transitionDur,
    nativelyFocusable: focusResult,
    focusOutline: focusStyle?.outline ?? null,
  }
}

async function run() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(session)])
  const page = await context.newPage()

  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' })
  await settleInbox(page)
  await page.waitForTimeout(500)

  const results = []
  // rail + chrome
  results.push(await testEl(page, 'Rail job item (.wb-rj)', '.wb-rj'))
  results.push(await testEl(page, 'Rail sync (.wb-rail-sync)', '.wb-rail-sync'))
  // inbox row
  results.push(await testEl(page, 'Inbox row (.r)', '.r:not(.sk-r)'))
  // filter chip
  results.push(await testEl(page, 'Filter chip (.chip)', '.chip'))

  // open a thread peer to get pane-x, wb-ask
  const row = page.locator('.r:not(.sk-r)').first()
  await row.click().catch(() => {})
  await page.waitForTimeout(800)
  results.push(await testEl(page, 'Pane close (.wb-pane-x)', '.wb-pane-x'))
  results.push(await testEl(page, 'Ask Claude button (.wb-ask)', '.wb-ask'))

  // chat: model button, composer send
  results.push(await testEl(page, 'Model button (.wb-modelbtn)', '.wb-modelbtn'))
  results.push(await testEl(page, 'Composer send (.csend)', '.csend'))

  // Content route: ct-card row, ct-f filter chip, lane chip, ct-ac buttons
  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  results.push(await testEl(page, 'Content row (.ct-card)', '.ct-card'))
  results.push(await testEl(page, 'Content filter chip (.ct-f)', '.ct-f'))
  results.push(await testEl(page, 'Lane switch chip (.chip in content)', '.chip'))
  results.push(await testEl(page, 'Review action btn (.ct-ac .btn)', '.ct-ac .btn'))
  results.push(await testEl(page, 'Section header toggle (.wb-sech.tap)', '.wb-sech.tap'))

  // Ops route
  await page.goto(`${BASE}/#exp/v2/ops`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  results.push(await testEl(page, 'Ops section header (.ops-sechdr, wb-sech)', '.wb-sech'))

  // Settings route: switch
  await page.goto(`${BASE}/#exp/v2/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  results.push(await testEl(page, 'Settings switch (.sw)', '.sw'))

  await page.screenshot({ path: OUT + '/errhover-livecensus-settings.png' })

  fs.writeFileSync(ROOT + '/scripts/_scout-errhover-livecensus-results.json', JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}

run().catch(e => { console.error(e); process.exit(1) })
