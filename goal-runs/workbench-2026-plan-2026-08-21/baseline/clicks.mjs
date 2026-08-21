import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/e92e01da-e5fc-432a-abed-6fa98817c85a/scratchpad/audit'
mkdirSync(OUT + '/clicks', { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/#exp/v2/'
const log = []
const blocked = []
const L = (s) => { log.push(s); console.log(s) }

const probe = () => {
  const vw = innerWidth
  const txt = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').length
  const type = new Map(); const tiny = []; const long = []
  for (const el of document.querySelectorAll('body *')) {
    const c = txt(el); if (!c) continue
    const cs = getComputedStyle(el)
    const size = Math.round(parseFloat(cs.fontSize) * 10) / 10
    const lh = cs.lineHeight === 'normal' ? 'n' : Math.round(parseFloat(cs.lineHeight) * 10) / 10
    type.set(`${size}/${lh}/${cs.fontWeight}`, (type.get(`${size}/${lh}/${cs.fontWeight}`) || 0) + c)
    if (size < 11) tiny.push({ cls: (el.className || '').toString().slice(0, 32), size })
    const r = el.getBoundingClientRect()
    if (c > 60 && r.width > 0) { const ch = Math.round(r.width / (size * 0.5)); if (ch > 85) long.push(ch) }
  }
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 2 || r.left < -2) {
      const cs = getComputedStyle(el); if (cs.position === 'fixed' && r.width <= vw + 4) continue
      let p = el.parentElement, ins = false
      while (p && p !== document.body) { const pc = getComputedStyle(p); if (pc.overflowX === 'auto' || pc.overflowX === 'scroll') { ins = true; break } p = p.parentElement }
      if (!ins) over.push((el.className || '').toString().slice(0, 40) + '@' + Math.round(r.right))
    }
  }
  const ctrls = [...document.querySelectorAll('button,a,input,textarea,[role=button]')].map(e => {
    const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), l: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18) }
  }).filter(c => c.w > 0 && c.h > 0)
  const panes = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 250 && r.width > 140 }).map(e => ({ c: (e.className || '').toString().slice(0, 26), w: Math.round(e.getBoundingClientRect().width) })).slice(0, 8)
  return {
    typeN: type.size, top: [...type.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + '=' + v),
    tinyN: tiny.length, tiny: tiny.slice(0, 4), longN: long.length, maxCh: long.length ? Math.max(...long) : 0,
    overN: over.length, over: over.slice(0, 4),
    ctrlN: ctrls.length, u32: ctrls.filter(c => c.h < 32).length, u24: ctrls.filter(c => c.h < 24).slice(0, 5),
    panes, chars: document.body.innerText.trim().length,
    head: document.body.innerText.trim().slice(0, 260).replace(/\n+/g, ' | ')
  }
}

const mk = async (browser, w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  page.on('pageerror', e => L('  !! PAGEERROR ' + String(e).slice(0, 90)))
  page.on('console', m => { if (m.type() === 'error') L('  !! CONSOLE ' + m.text().slice(0, 90)) })
  // WRITE BLOCKER: nothing this audit clicks may mutate production data.
  await page.route('**/rest/v1/**', async route => {
    const req = route.request(); const m = req.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !req.url().includes('/rpc/'))) {
      blocked.push(m + ' ' + req.url().split('/rest/v1/')[1].slice(0, 90) + ' :: ' + (req.postData() || '').slice(0, 160))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/rpc/operator_*', async route => {
    blocked.push('RPC ' + route.request().url().split('/rpc/')[1])
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  return page
}

const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/clicks/${name}.png` }) }
const step = async (page, name, fn) => {
  try { await fn(); await page.waitForTimeout(2200); await shot(page, name)
    const m = await page.evaluate(probe); L(`\n### ${name}\n` + JSON.stringify(m))
  } catch (e) { L(`\n### ${name}\n  FAILED: ${String(e).slice(0, 130)}`) }
}
const goto = async (page, job) => { await page.goto(BASE + job, { waitUntil: 'networkidle' }).catch(() => { }); await page.waitForTimeout(6200) }

const browser = await chromium.launch()

/* ============ A. DMs deep ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'dms')
  await step(page, 'A1-thread-open', async () => {
    const r = page.locator('.r').first()
    if (!await r.count()) throw new Error('no .r rows')
    await r.click({ timeout: 6000 })
  })
  await step(page, 'A2-context-sheet', async () => {
    const h = page.locator('.wb-peer .thhdr, .wb-peer header, .thhdr').first()
    if (await h.count()) await h.click({ timeout: 4000 })
    else throw new Error('no thread header')
  })
  await page.keyboard.press('Escape').catch(() => { })
  await goto(page, 'dms')
  await step(page, 'A3-dm-history', async () => {
    await page.getByText(/DM HISTORY/i).first().click({ timeout: 5000 })
  })
  await goto(page, 'dms')
  await step(page, 'A4-pushed-later', async () => {
    await page.getByRole('button', { name: /^Open$/ }).first().click({ timeout: 5000 })
  })
  await goto(page, 'dms')
  await step(page, 'A5-search', async () => {
    const s = page.locator('input[type=search], input[placeholder*="Search people" i]').first()
    await s.fill('scan', { timeout: 5000 })
  })
  await goto(page, 'dms')
  await step(page, 'A6-filter-rise', async () => {
    await page.getByRole('button', { name: /^Rise$/ }).first().click({ timeout: 5000 })
  })
  await step(page, 'A7-filter-email', async () => {
    await page.getByRole('button', { name: /^Email$/ }).first().click({ timeout: 5000 })
  })
  await page.close()
}

/* ============ B. Content deep ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'content')
  for (const [id, label] of [['B1-ideas', /^Ideas/], ['B2-errors', /^Errors/], ['B3-published', /^Published/], ['B4-archived', /^Archived/]]) {
    await step(page, id, async () => { await page.getByRole('button', { name: label }).first().click({ timeout: 5000 }) })
  }
  await step(page, 'B5-calendar', async () => { await page.getByRole('button', { name: /^Calendar$/ }).first().click({ timeout: 5000 }) })
  await goto(page, 'content')
  await step(page, 'B6-mattan-lane', async () => { await page.getByRole('button', { name: /Mattan/ }).first().click({ timeout: 5000 }) })
  await step(page, 'B7-davorin-lane', async () => { await page.getByRole('button', { name: /Davorin/ }).first().click({ timeout: 5000 }) })
  await goto(page, 'content')
  await step(page, 'B8-filters-open', async () => { await page.getByRole('button', { name: /Filters/ }).first().click({ timeout: 5000 }) })
  await page.close()
}

/* ============ C. Draft window inspector tabs ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'content')
  await step(page, 'C0-open-draft', async () => { await page.locator('.ct-card').first().click({ timeout: 6000 }) })
  for (const t of ['Artifact', 'Fields', 'Source', 'Log', 'QA']) {
    await step(page, 'C-tab-' + t, async () => { await page.getByRole('button', { name: new RegExp('^' + t + '$', 'i') }).first().click({ timeout: 4000 }) })
  }
  await page.close()
}

/* ============ D. Magnets deep ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'magnets')
  await step(page, 'D1-magnet-window', async () => {
    const rows = page.locator('.ct-card')
    const n = await rows.count(); if (!n) throw new Error('no magnet rows')
    await rows.nth(Math.min(6, n - 1)).click({ timeout: 6000 })
  })
  await goto(page, 'magnets')
  await step(page, 'D2-magnet-published', async () => { await page.getByRole('button', { name: /^Published/ }).first().click({ timeout: 5000 }) })
  await page.close()
}

/* ============ E. Sends deep ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'sends')
  await step(page, 'E1-lanes', async () => { await page.getByRole('button', { name: /^Lanes$/ }).first().click({ timeout: 5000 }) })
  await step(page, 'E2-lane-drill', async () => {
    const c = page.locator('.ov-lane, .lane-card, [class*=lane]').first()
    if (!await c.count()) throw new Error('no lane card'); await c.click({ timeout: 5000 })
  })
  await goto(page, 'sends')
  await step(page, 'E3-log', async () => { await page.getByRole('button', { name: /^Log$/ }).first().click({ timeout: 5000 }) })
  await goto(page, 'sends')
  await step(page, 'E4-range-menu', async () => { await page.getByRole('button', { name: /Range/ }).first().click({ timeout: 5000 }) })
  await page.close()
}

/* ============ F. Ops + Strategy + Claude ============ */
{
  const page = await mk(browser, 1440, 900)
  await goto(page, 'ops')
  await step(page, 'F1-ops-done-expand', async () => { await page.getByText(/Done · \d+/).first().click({ timeout: 5000 }) })
  await page.close()

  const p2 = await mk(browser, 1440, 900)
  await goto(p2, 'strategy')
  await step(p2, 'F2-strategy-edit', async () => {
    const b = p2.locator('.wb-strat-b, [class*=strat] p, .wb-strat-sec').first()
    await b.click({ timeout: 5000 })
  })
  await p2.close()

  const p3 = await mk(browser, 1440, 900)
  await goto(p3, 'dms/chat')
  await step(p3, 'F3-slash-palette', async () => {
    const i = p3.locator('input[placeholder*="Ask Claude" i], textarea').first()
    await i.click({ timeout: 5000 }); await i.type('/', { delay: 90 })
  })
  await step(p3, 'F4-model-picker', async () => { await p3.getByRole('button', { name: /default/i }).first().click({ timeout: 4000 }) })
  await p3.close()
}

/* ============ G. Mobile deep ============ */
{
  const page = await mk(browser, 390, 844)
  await goto(page, 'dms')
  await step(page, 'G1-m-thread', async () => { await page.locator('.r').first().click({ timeout: 6000 }) })
  await goto(page, 'content')
  await step(page, 'G2-m-draft-window', async () => { await page.locator('.ct-card').first().click({ timeout: 6000 }) })
  await goto(page, 'sends')
  await step(page, 'G3-m-lanes', async () => { await page.getByRole('button', { name: /^Lanes$/ }).first().click({ timeout: 5000 }) })
  await page.close()
}

L('\n\n======== BLOCKED WRITES (' + blocked.length + ') ========')
blocked.forEach(b => L('  ' + b))
writeFileSync(`${OUT}/clicks.txt`, log.join('\n'))
await browser.close()
