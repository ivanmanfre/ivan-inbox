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

async function styleOf(loc) {
  return loc.evaluate(node => {
    const cs = getComputedStyle(node)
    return {
      tag: node.tagName,
      tabIndex: node.tabIndex,
      background: cs.backgroundColor,
      color: cs.color,
      boxShadow: cs.boxShadow,
      cursor: cs.cursor,
      transitionProp: cs.transitionProperty,
      transitionDur: cs.transitionDuration,
      matchesHover: node.matches(':hover'),
    }
  })
}

async function testEl(page, label, selector, nth = 0) {
  const loc = page.locator(selector).nth(nth)
  const count = await page.locator(selector).count()
  if (count === 0) return { label, selector, found: false }
  const visible = await loc.isVisible().catch(() => false)
  if (!visible) return { label, selector, found: true, visible: false, count }

  const rest = await styleOf(loc)
  await loc.hover({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(150)
  const hovered = await styleOf(loc)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(100)

  const focusResult = await loc.evaluate(node => {
    node.focus()
    return document.activeElement === node
  })
  let focusStyle = null
  if (focusResult) {
    focusStyle = await loc.evaluate(node => {
      const cs = getComputedStyle(node)
      return cs.outlineStyle + ' ' + cs.outlineColor + ' ' + cs.outlineWidth
    })
    await loc.evaluate(node => node.blur())
  }

  const changed = (a, b, keys) => keys.some(k => a[k] !== b[k])
  return {
    label, selector, found: true, visible: true, count,
    tag: rest.tag, tabIndexRest: rest.tabIndex, cursor: rest.cursor,
    hoverMatched: hovered.matchesHover,
    hoverChanged: changed(rest, hovered, ['background', 'color', 'boxShadow']),
    restBg: rest.background, hoverBg: hovered.background,
    restColor: rest.color, hoverColor: hovered.color,
    restBoxShadow: rest.boxShadow, hoverBoxShadow: hovered.boxShadow,
    transitionAtRest: rest.transitionProp + ' ' + rest.transitionDur,
    nativelyFocusable: focusResult,
    focusOutline: focusStyle,
  }
}

async function run() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(session)])
  const page = await context.newPage()
  const results = []

  await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' })
  await settleInbox(page)
  await page.waitForTimeout(500)
  results.push(await testEl(page, 'Rail job item (.wb-rj)', '.wb-rj'))
  results.push(await testEl(page, 'Rail Claude peer (.wb-rj-peer)', '.wb-rj-peer'))
  results.push(await testEl(page, 'Rail sync (.wb-rail-sync)', '.wb-rail-sync'))
  results.push(await testEl(page, 'Inbox row (.r)', '.r:not(.sk-r)'))
  results.push(await testEl(page, 'Filter tab chip (.chip)', '.chip'))

  const row = page.locator('.r:not(.sk-r)').first()
  await row.click().catch(() => {})
  await page.waitForTimeout(800)
  results.push(await testEl(page, 'Pane close X (.wb-pane-x)', '.wb-pane-x'))
  results.push(await testEl(page, 'Ask Claude button (.wb-ask)', '.wb-ask'))
  results.push(await testEl(page, 'Model button (.wb-modelbtn)', '.wb-modelbtn'))
  results.push(await testEl(page, 'Composer send (.csend)', '.csend'))

  await page.goto(`${BASE}/#exp/v2/content`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.locator('.ct-rows').evaluate(el => { el.scrollTop = 300 }).catch(() => {})
  await page.waitForTimeout(300)
  results.push(await testEl(page, 'Content row (.ct-card)', '.ct-card', 2))
  results.push(await testEl(page, 'Content filter facet chip (.ct-f)', '.ct-f'))
  results.push(await testEl(page, 'Lane switch chip (.chip@content)', '.chip'))
  results.push(await testEl(page, 'Review action btn (.ct-ac .btn)', '.ct-ac .btn'))
  results.push(await testEl(page, 'Filter clear link (.ct-fclear)', '.ct-fclear'))
  const secToggle = page.locator('.wb-sech.tap')
  if (await secToggle.count() > 0) results.push(await testEl(page, 'Section header toggle (.wb-sech.tap)', '.wb-sech.tap'))
  const alert = page.locator('.ct-alert')
  if (await alert.count() > 0) results.push(await testEl(page, 'Alert strip toggle (.ct-alert)', '.ct-alert'))

  await page.goto(`${BASE}/#exp/v2/ops`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  results.push(await testEl(page, 'Ops refresh row (.wb-ofresh)', '.wb-ofresh'))

  await page.goto(`${BASE}/#exp/v2/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  results.push(await testEl(page, 'Settings switch (.sw)', '.sw'))

  await page.goto(`${BASE}/#exp/v2/sends`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  results.push(await testEl(page, 'Sends segmented control (.seg .sg)', '.seg .sg'))

  fs.writeFileSync(ROOT + '/scripts/_scout-errhover-livecensus2-results.json', JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}

run().catch(e => { console.error(e); process.exit(1) })
