// Phase 4b key proof. Drives REAL keypresses in the authed browser and asserts
// against the DOM after each one. A key that "should" work is not a key that
// works.
//
//   node keys-probe.mjs --vw 1440 [--shots DIR]
//
// Carries probe.mjs's write interceptor unchanged: PATCH / PUT / DELETE and any
// non-rpc POST are fulfilled locally and counted. Attempted writes must stay 0.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const vw = Number(arg('vw', 1440))
const shots = arg('shots', null)
const PORT = arg('port', '4177')
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
if (shots) mkdirSync(shots, { recursive: true })

const blocked = []
const consoleErrors = []
const results = []
let failures = 0

function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail })
  if (!pass) failures += 1
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    blocked.push(m + ' ' + q.url().split('/rest/v1/')[1].slice(0, 70))
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})

// ---- DOM readers -----------------------------------------------------------

const snap = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.wb-work [data-wbrow]')].filter(e => e.offsetParent !== null)
  const focused = rows.findIndex(e => e.getAttribute('data-wbfocus') === '1')
  const sel = rows.filter(e => e.getAttribute('data-wbsel') === '1')
  const bulk = document.querySelector('.wb-bulk')
  const active = document.activeElement
  return {
    rows: rows.length,
    focusIndex: focused,
    focusCount: rows.filter(e => e.getAttribute('data-wbfocus') === '1').length,
    selCount: sel.length,
    marks: document.querySelectorAll('.wb-selmark').length,
    bulk: bulk ? bulk.querySelector('.wb-bulk-n')?.textContent?.trim() ?? '' : null,
    bulkActs: bulk ? [...bulk.querySelectorAll('.wb-bulk-acts .wb-bulk-b')].map(b => `${b.textContent.trim()}${b.disabled ? ' [refused]' : ''}`) : [],
    palette: !!document.querySelector('.wb-cmdk'),
    sheet: !!document.querySelector('.wb-keys'),
    takeover: !!document.querySelector('.wb-tkscrim'),
    activeTag: active ? active.tagName : null,
    activeCls: active ? (active.className || '').toString().slice(0, 40) : null,
  }
})

const paletteRows = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.wb-cmdk-row')]
  return {
    total: rows.length,
    withKey: rows.filter(r => (r.querySelector('.wb-cmdk-k')?.textContent ?? '').trim().length > 0).length,
    dimmed: rows.filter(r => r.classList.contains('off')).length,
    dimmedWithReason: rows.filter(r => r.classList.contains('off')
      && (r.querySelector('.wb-cmdk-h')?.textContent ?? '').trim().length > 0).length,
    // The printed legend, sampled.
    sample: rows.slice(0, 6).map(r => ({
      t: r.querySelector('.wb-cmdk-t')?.textContent?.trim(),
      k: r.querySelector('.wb-cmdk-k')?.textContent?.trim(),
      off: r.classList.contains('off'),
      why: r.classList.contains('off') ? r.querySelector('.wb-cmdk-h')?.textContent?.trim() : undefined,
    })),
    groups: [...document.querySelectorAll('.wb-cmdk-grph')].map(e => e.textContent.trim()),
    none: !!document.querySelector('.wb-cmdk-none'),
  }
})

// 🔴 RELOAD, not a hash change. Two of these lanes differ from the last only in
// the fragment, and a fragment-only goto does not reload the document, so at
// 390 the full-screen peer opened by the previous lane's Enter test was still
// covering the work surface and every later lane measured zero rows. That was a
// false failure hiding a real one: Escape had no way to close a mobile peer.
const goto = async lane => {
  await page.goto(`http://localhost:${PORT}/#exp/v2/${lane}`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
}

const blur = () => page.evaluate(() => document.activeElement?.blur())

// Clearing the box has to go through a real input event. Setting `.value` from
// evaluate() does not fire React's onChange, so the query stays in state, the
// list stays filtered, and every later check reads an empty list. That mistake
// caused nine false failures on the first run of this probe.
const clearSearch = async () => {
  const f = page.locator('.wb-work input.ct-fsearch-in, .wb-work input.search-in, .wb-work input[type=search]').first()
  if (await f.count() > 0) { await f.fill(''); await page.waitForTimeout(600) }
  await blur()
}

// ---------------------------------------------------------------------------
console.log(`\n=== KEY PROOF @ ${vw}px ===\n`)

for (const lane of ['dms', 'content', 'magnets']) {
  await goto(lane)
  await clearSearch()
  if (lane === 'content') {
    // The lane opens on Needs review, which holds ONE row today. j/k has
    // nothing to prove on a list of one, so the walk is measured on the tab
    // this phase's acceptance case names.
    try {
      await page.locator('.ct-tab', { hasText: 'Errors' }).first().click()
      await page.waitForTimeout(1000)
    } catch { /* the tab bar may not have rendered yet */ }
  }
  let s = await snap()
  check(`${lane}: rows carry data-wbrow`, s.rows > 0, { rows: s.rows })
  if (s.rows === 0) continue

  await page.keyboard.press('j')
  s = await snap()
  check(`${lane}: j focuses the first row`, s.focusIndex === 0 && s.focusCount === 1, { at: s.focusIndex, n: s.focusCount })

  await page.keyboard.press('j')
  s = await snap()
  check(`${lane}: j moves down one row`, s.focusIndex === 1 && s.focusCount === 1, { at: s.focusIndex })

  await page.keyboard.press('k')
  s = await snap()
  check(`${lane}: k moves back up one row`, s.focusIndex === 0, { at: s.focusIndex })

  await page.keyboard.press('x')
  s = await snap()
  check(`${lane}: x selects the focused row`, s.selCount === 1, { selected: s.selCount })
  check(`${lane}: the bulk bar appears and names the count`, !!s.bulk && /^1 /.test(s.bulk), { bar: s.bulk })

  await page.keyboard.press('x')
  s = await snap()
  check(`${lane}: x again deselects`, s.selCount === 0 && s.bulk === null, { selected: s.selCount, bar: s.bulk })

  await page.keyboard.press('x')
  await page.keyboard.press('Escape')
  s = await snap()
  check(`${lane}: Escape clears the selection`, s.selCount === 0, { selected: s.selCount })

  // ---- the field guard ----
  await page.keyboard.press('/')
  s = await snap()
  const inSearch = s.activeTag === 'INPUT'
  check(`${lane}: / puts the cursor in the search field`, inSearch, { tag: s.activeTag, cls: s.activeCls })

  if (inSearch) {
    // The proof is two-sided: the layer did nothing (no sheet, no palette, no
    // selection, the cursor never left the field) AND the characters landed in
    // the box, so the keys really were delivered rather than swallowed.
    for (const k of ['j', 'k', 'x', '?']) await page.keyboard.press(k)
    const after = await snap()
    const typed = await page.evaluate(() => {
      const a = document.activeElement
      return a && 'value' in a ? String(a.value) : null
    })
    check(`${lane}: no key fires while an input has focus`,
      after.selCount === 0 && !after.sheet && !after.palette
      && after.activeTag === 'INPUT' && typed === 'jkx?',
      { sel: after.selCount, sheet: after.sheet, palette: after.palette, active: after.activeTag, typed })
    await clearSearch()
  }
  // The keyboard focus is re-seeded after the field test: typing into search
  // changes the scope, and a scope change drops the focus by design.
  await page.keyboard.press('j')

  // ---- the shortcut sheet ----
  await page.keyboard.press('?')
  s = await snap()
  check(`${lane}: ? opens the shortcut sheet`, s.sheet, { sheet: s.sheet })
  const keys = await page.evaluate(() => [...document.querySelectorAll('.wb-keys-row')]
    .map(r => ({ k: r.querySelector('.wb-keys-k')?.textContent?.trim(), t: r.querySelector('.wb-keys-t')?.textContent?.trim() })))
  check(`${lane}: every sheet row prints a key`, keys.length > 0 && keys.every(r => r.k && r.k.length > 0), { rows: keys.length })
  if (lane === 'content') console.log('   sheet:', JSON.stringify(keys))
  await page.keyboard.press('Escape')
  s = await snap()
  check(`${lane}: Escape closes the sheet`, !s.sheet)

  // ---- the palette ----
  await page.keyboard.press('Meta+k')
  s = await snap()
  check(`${lane}: Meta+K opens the palette`, s.palette)
  const p = await paletteRows()
  check(`${lane}: every palette row prints its shortcut`, p.total > 0 && p.withKey === p.total,
    { rows: p.total, withKey: p.withKey })
  check(`${lane}: unavailable commands are listed and dimmed with a reason`,
    p.dimmed > 0 && p.dimmed === p.dimmedWithReason, { dimmed: p.dimmed, withReason: p.dimmedWithReason })
  if (lane === 'content') console.log('   palette groups:', JSON.stringify(p.groups), '\n   sample:', JSON.stringify(p.sample, null, 1))

  // no-match must NOT close it
  await page.keyboard.type('zzqq')
  const p2 = await paletteRows()
  const s2 = await snap()
  check(`${lane}: a query that matches nothing keeps the palette open`, s2.palette && p2.none, { open: s2.palette, said: p2.none })
  await page.keyboard.press('Escape')
  s = await snap()
  check(`${lane}: Escape closes the palette`, !s.palette)
  check(`${lane}: the palette lists the rows on screen by name`, p.groups.includes('Open'), { groups: p.groups })

  // ---- Enter opens ----
  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  s = await snap()
  const opened = s.takeover || (await page.evaluate(() => !!document.querySelector('.wb-peer, .wb-take')))
  check(`${lane}: Enter opens the focused row`, opened, { takeover: s.takeover })

  // Escape has to walk back out of what Enter opened, or a keyboard operator is
  // stuck on the phone, where the peer is the whole screen.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const stillOpen = await page.evaluate(() => !!document.querySelector('.wb-tkscrim, .wb-take, .wb-peer'))
  check(`${lane}: Escape walks back out of the opened row`, !stillOpen, { open: stillOpen })
}

// ---- the acceptance case: the Errors tab in one pass -----------------------
await goto('content')
await clearSearch()
try {
  await page.locator('.ct-tab', { hasText: 'Errors' }).first().click()
  await page.waitForTimeout(1200)
} catch (e) { console.log('   errors tab click failed:', String(e).slice(0, 80)) }

let s = await snap()
check('errors tab: rows are on screen', s.rows > 0, { rows: s.rows })

// The row anatomy, measured BEFORE anything is selected. The card is a fixed
// seven-column grid, so a mark in the normal flow would move every cell one
// column right; this is the number that proves it does not.
const anatomy = () => page.evaluate(() => {
  const card = document.querySelector('.wb-work .ct-card')
  const title = card?.querySelector('.ct-title')
  const mark = card?.querySelector('.wb-selmark')
  return {
    titleX: title ? Math.round(title.getBoundingClientRect().x) : null,
    cardH: card ? Math.round(card.getBoundingClientRect().height) : null,
    markPos: mark ? getComputedStyle(mark).position : null,
  }
})
const before = await anatomy()

await page.keyboard.press('j')
await page.keyboard.press('x')
s = await snap()
const rowsOnTab = s.rows
try {
  await page.locator('.wb-bulk-tail .wb-bulk-b', { hasText: 'Select all' }).first().click()
  await page.waitForTimeout(300)
} catch (e) { console.log('   select-all click failed:', String(e).slice(0, 80)) }
s = await snap()
check('errors tab: select-all takes every row on the tab in one pass',
  s.selCount === rowsOnTab && s.bulk === `${rowsOnTab} drafts selected`,
  { selected: s.selCount, rows: rowsOnTab, bar: s.bulk })
check('errors tab: the bar offers the actions valid for the selection', s.bulkActs.length > 0, { actions: s.bulkActs })
console.log('   bulk actions:', JSON.stringify(s.bulkActs))

const after = await anatomy()
check('selecting every row does not move the row anatomy',
  after.titleX === before.titleX && after.cardH === before.cardH,
  { before, after })
check('the mark is taken out of the grid flow', after.markPos === 'absolute', { position: after.markPos })

if (shots) await page.screenshot({ path: `${shots}/bulkbar-errors-${vw}.png` })

// selection must not survive a tab change
try {
  await page.locator('.ct-tab', { hasText: 'Published' }).first().click()
  await page.waitForTimeout(900)
} catch { /* the tab may not be on this lane */ }
s = await snap()
check('a selection does not survive a tab change', s.selCount === 0 && s.bulk === null, { selected: s.selCount, bar: s.bulk })

// ---- computed styles: the ONE RULE ----------------------------------------
await page.keyboard.press('Meta+k')
await page.waitForTimeout(250)
if (shots) await page.screenshot({ path: `${shots}/palette-${vw}.png` })
const css = await page.evaluate(() => {
  const g = sel => {
    const e = document.querySelector(sel)
    if (!e) return null
    const c = getComputedStyle(e)
    return { fs: c.fontSize, lh: c.lineHeight, fw: c.fontWeight, z: c.zIndex, pos: c.position, bg: c.backgroundColor }
  }
  return {
    scrim: g('.wb-cmdk-scrim'), box: g('.wb-cmdk'), key: g('.wb-cmdk-k'),
    title: g('.wb-cmdk-t'), hint: g('.wb-cmdk-h'), off: g('.wb-cmdk-row.off'),
  }
})
console.log('\n   computed (palette):', JSON.stringify(css, null, 1))
check('the palette is a real overlay above the takeover layer',
  css.scrim?.pos === 'fixed' && Number(css.scrim?.z) >= 70, { z: css.scrim?.z, pos: css.scrim?.pos })
check('the printed key is NOT flattened to body size',
  css.key !== null && css.key.fs !== css.box.fs, { key: css.key?.fs, box: css.box?.fs })
await page.keyboard.press('Escape')

await page.keyboard.press('?')
await page.waitForTimeout(250)
if (shots) await page.screenshot({ path: `${shots}/shortcuts-${vw}.png` })
const sheetCss = await page.evaluate(() => {
  const e = document.querySelector('.wb-keys-k')
  const n = document.querySelector('.wb-keys-note')
  const c = e ? getComputedStyle(e) : null
  return { key: c ? { fs: c.fontSize, fw: c.fontWeight } : null, note: n ? n.textContent.trim() : null }
})
console.log('   computed (sheet):', JSON.stringify(sheetCss))
await page.keyboard.press('Escape')

// ---------------------------------------------------------------------------
console.log('\n--- totals ---')
console.log('checks:', results.length, 'failed:', failures)
console.log('console errors:', consoleErrors.length, consoleErrors.slice(0, 3))
console.log('ATTEMPTED WRITES:', blocked.length, blocked)
await browser.close()
process.exit(failures > 0 ? 1 : 0)
