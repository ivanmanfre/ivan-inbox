// Phase 5 (layout) probe. Its own file rather than an edit to probe.mjs, which
// two other passes were still driving while this one ran.
//
// The one instrument that matters here is GLYPH AREA (`fillPct`): measure.mjs's
// platePct hit-tests elements and reported 96% on a pane that carried 703
// characters, because a row container spans the pane whether or not it holds a
// word. Known limit, carried from phase 0: glyph area over-reports on a
// horizontally scrolling table (rects outside the scroller still count), so it
// is only read on non-scrolling surfaces.
//
//   node probe5.mjs --base http://localhost:4176/ --vw 2560 --lane dms --mode fill
//   modes: fill | table | dmh | takeover | rail | scrim
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('base', 'http://localhost:4176/')
const vw = Number(arg('vw', 1440))
const lane = arg('lane', 'content')
const mode = arg('mode', 'fill')
const peer = arg('peer', '')          // 'chat' docks the Claude peer via the hash
const shot = arg('shot', '')
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const blocked = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 120)))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)) })
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    blocked.push(m + ' ' + q.url().split('/rest/v1/')[1].slice(0, 70))
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
const hash = `#exp/v2/${lane}${peer ? '/' + peer : ''}`
await page.goto(BASE + hash, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

// ---- the glyph-area reader, shared by every mode ----
const FILL = () => {
  const work = document.querySelector('.wb-work') || document.body
  const wr = work.getBoundingClientRect()
  let textArea = 0, maxRight = 0, chars = 0
  const RECTS = []
  for (const el of work.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    if (!own) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    chars += own.length
    const rng = document.createRange(); rng.selectNodeContents(el)
    for (const q of rng.getClientRects()) { maxRight = Math.max(maxRight, q.right); textArea += q.width * q.height; RECTS.push(q) }
  }
  const h = Math.min(wr.height, innerHeight)
  // COVERAGE, the number that actually answers "does the layout fill the
  // canvas". fillPct is INK: it sums glyph rects, so a layout that stops a
  // snippet wrapping onto a second line lowers it while showing MORE of the
  // conversation. Coverage instead cuts the plate into 24px cells and counts
  // the cells a glyph rect touches, which is insensitive to line count and to
  // type size, and is not the discredited element hit-test (it reads glyph
  // rects, never elementFromPoint).
  const STEP = 24
  const cols = Math.max(1, Math.ceil(wr.width / STEP)), rws = Math.max(1, Math.ceil(h / STEP))
  const cells = new Set()
  for (const q of RECTS) {
    if (q.width <= 0 || q.height <= 0) continue
    const x0 = Math.max(0, Math.floor((q.left - wr.left) / STEP)), x1 = Math.min(cols - 1, Math.floor((q.right - wr.left) / STEP))
    const y0 = Math.max(0, Math.floor((q.top - wr.top) / STEP)), y1 = Math.min(rws - 1, Math.floor((q.bottom - wr.top) / STEP))
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) cells.add(i * 10000 + j)
  }
  return {
    workW: Math.round(wr.width), workH: Math.round(h),
    fillPct: Math.round((textArea / (wr.width * h)) * 1000) / 10,
    coveragePct: Math.round((cells.size / (cols * rws)) * 1000) / 10,
    colsUsed: (() => { const s = new Set(); for (const k of cells) s.add(Math.floor(k / 10000)); return s.size })(),
    colsTotal: cols,
    bodyChars: chars,
    unusedRightPx: Math.round(wr.right - maxRight),
    panes: [...document.querySelectorAll('.wb-work,.wb-peer')].map(e => ({
      c: (e.className || '').toString().slice(0, 34), w: Math.round(e.getBoundingClientRect().width),
    })),
  }
}

const click = async (sel, ms = 1400) => {
  try { await page.locator(sel).first().click({ timeout: 6000 }); await page.waitForTimeout(ms); return true }
  catch { return false }
}

// The pre-phase-5 geometry, re-injected so before and after are read off the
// SAME page and the SAME rows. Restoring the deleted rule is more honest than
// comparing two builds against a live database that moves between runs.
const OLD_GEOMETRY = `
.wb.wb.wb.dt .wb-solo .nav,.wb.wb.wb.dt .wb-solo .draftbanner,.wb.wb.wb.dt .wb-solo .stalebar,
.wb.wb.wb.dt .wb-solo .seg,.wb.wb.wb.dt .wb-solo .swipehint,
.wb.wb.wb.dt .wb-solo .rows > *{max-width:860px !important;margin-left:auto !important;margin-right:auto !important}
.wb.wb.wb .wb-solo .rows{display:block !important}
.wb.wb.wb .wb-solo .rows > .r{box-shadow:none !important}
`

let out = {}
if (mode === 'fill') {
  const after = await page.evaluate(FILL)
  if (shot) { mkdirSync(shot.replace(/\/[^/]+$/, ''), { recursive: true }); await page.screenshot({ path: shot, type: 'jpeg', quality: 78 }) }
  await page.addStyleTag({ content: OLD_GEOMETRY })
  await page.waitForTimeout(400)
  const before = await page.evaluate(FILL)
  out = { before, after }
} else if (mode === 'table') {
  out = await page.evaluate(() => {
    const head = document.querySelector('.ct-cols-head')
    const card = document.querySelector('.ct-card')
    const box = e => e ? { w: Math.round(e.getBoundingClientRect().width), grid: getComputedStyle(e).gridTemplateColumns } : null
    const title = document.querySelector('.ct-card .ct-mid, .ct-card .ct-title')
    const work = document.querySelector('.wb-work')
    // a cell is CLIPPED when its scrollWidth exceeds the box it was given
    const clipped = [...document.querySelectorAll('.ct-card .ct-colv,.ct-card .ct-title,.ct-cols-head > span')]
      .filter(e => e.scrollWidth > Math.ceil(e.getBoundingClientRect().width) + 1)
      .map(e => ({ c: (e.className || '').toString().slice(0, 20) || e.tagName, w: Math.round(e.getBoundingClientRect().width), need: e.scrollWidth, t: e.textContent.trim().slice(0, 18) }))
    return {
      workW: work ? Math.round(work.getBoundingClientRect().width) : null,
      workCls: work ? work.className : null,
      head: box(head), card: box(card),
      titleW: title ? Math.round(title.getBoundingClientRect().width) : null,
      colvN: document.querySelectorAll('.ct-card .ct-colv').length,
      colvShown: [...document.querySelectorAll('.ct-card .ct-colv')].filter(e => e.getBoundingClientRect().width > 0).length,
      clippedN: clipped.length, clipped: clipped.slice(0, 8),
      rowOverflow: (() => { const r = document.querySelector('.ct-rows'); return r ? r.scrollWidth - r.clientWidth : null })(),
    }
  })
} else if (mode === 'dmh') {
  const before = await page.evaluate(() => ({
    bodyChars: document.body.innerText.trim().length,
    controls: document.querySelectorAll('button,a,input,[role=button]').length,
    rows: document.querySelectorAll('.dmh-r').length,
  }))
  await click('text=DM history')
  const after = await page.evaluate(() => ({
    bodyChars: document.body.innerText.trim().length,
    controls: document.querySelectorAll('button,a,input,[role=button]').length,
    rows: document.querySelectorAll('.dmh-r').length,
    more: (document.querySelector('.dmh-more')?.textContent ?? '').trim().slice(0, 80),
    head: (document.querySelector('.dmh-m')?.textContent ?? '').trim().slice(0, 90),
  }))
  out = { before, after }
} else if (mode === 'takeover') {
  await click('.ct-card.ct-tap', 2200)
  out = await page.evaluate(() => {
    const g = document.querySelector('.dw-cols')
    const li = document.querySelector('.li-card')
    const main = document.querySelector('.dw-main-in') || document.querySelector('.dw-main')
    const insp = document.querySelector('.dw-insp')
    const q = document.querySelector('.dw-queue')
    const w = e => e ? Math.round(e.getBoundingClientRect().width) : null
    // widest prose line actually painted inside the inspector
    let inspMax = 0
    if (insp) for (const el of insp.querySelectorAll('*')) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
      if (own.length < 40) continue
      const rng = document.createRange(); rng.selectNodeContents(el)
      for (const r of rng.getClientRects()) inspMax = Math.max(inspMax, r.width)
    }
    return {
      open: !!g, grid: g ? getComputedStyle(g).gridTemplateColumns : null,
      queueW: w(q), mainW: w(main), mainColW: w(document.querySelector('.dw-main')),
      liCardW: w(li), inspW: w(insp), inspProseMaxPx: Math.round(inspMax),
    }
  })
} else if (mode === 'rail') {
  await click('.ct-card.ct-tap', 2200)
  out = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.dw-qrow')]
    const heights = rows.map(r => Math.round(r.getBoundingClientRect().height))
    const titles = rows.slice(0, 6).map(r => {
      const t = r.querySelector('.dw-qrow-t'); const m = r.querySelector('.dw-qrow-m')
      const lines = e => e ? Math.round(e.getBoundingClientRect().height / (parseFloat(getComputedStyle(e).lineHeight) || 18)) : 0
      return {
        titleW: t ? Math.round(t.getBoundingClientRect().width) : null,
        titleLines: lines(t), metaLines: lines(m),
        shown: t ? t.textContent.trim().slice(0, 30) : null,
        clipped: t ? t.scrollWidth > Math.ceil(t.getBoundingClientRect().width) + 1 : null,
      }
    })
    return { n: rows.length, hMin: Math.min(...heights), hMax: Math.max(...heights), distinctH: [...new Set(heights)].slice(0, 8), titles, railW: rows[0] ? Math.round(rows[0].parentElement.getBoundingClientRect().width) : null }
  })
} else if (mode === 'scrim') {
  const ok = await click('.ct-fpill', 900)
  out = await page.evaluate((clicked) => {
    const scrim = document.querySelector('.ct-fsheet-scrim')
    const tabs = document.querySelector('.tabbar') || document.querySelector('.wb .tabbar')
    const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) } }
    const sb = r(scrim), tb = r(tabs)
    // does the scrim actually paint over the tab bar? hit-test the tab bar's centre
    let hitCls = null
    if (tb) {
      const el = document.elementFromPoint((tb.l + tb.r) / 2, (tb.t + tb.b) / 2 - 2)
      hitCls = el ? (el.className || '').toString().slice(0, 40) + '/' + el.tagName : null
    }
    const work = document.querySelector('.wb-work')
    return {
      clicked, scrimOpen: !!scrim, scrim: sb, tabbar: tb,
      scrimCoversTabbar: !!(sb && tb && sb.b >= tb.b - 1 && sb.t <= tb.t),
      hitAtTabbarCentre: hitCls,
      workContainerType: work ? getComputedStyle(work).containerType : null,
      workContain: work ? getComputedStyle(work).contain : null,
    }
  }, ok)
} else if (mode === 'chrome') {
  out = await page.evaluate(() => {
    // Every horizontal band above the first content row, top to bottom.
    const plate = document.querySelector('.wb-plate')
    const rows = document.querySelector('.rows') || document.querySelector('.ct-rows')
    const firstRow = rows ? rows.getBoundingClientRect().top : null
    const bands = [...document.querySelectorAll('.wb-ribbon,.wb-workhead,.wb-workseg,.nav,.chips,.ct-fr,.ct-filters,.ihead,.wb-ihead,.seg')]
      .map(e => { const b = e.getBoundingClientRect(); return { c: (e.className || '').toString().slice(0, 26), t: Math.round(b.top), h: Math.round(b.height), sw: e.scrollWidth, cw: Math.round(e.clientWidth) } })
      .filter(b => b.h > 0 && b.t < (firstRow ?? 9999) + 4)
    const clipped = [...document.querySelectorAll('.wb-ws,.chip,.ct-fpill,.wb-fpill')]
      .filter(e => e.scrollWidth > Math.ceil(e.getBoundingClientRect().width) + 1)
      .map(e => ({ c: (e.className || '').toString().slice(0, 20), t: e.textContent.trim().slice(0, 16), w: Math.round(e.getBoundingClientRect().width), need: e.scrollWidth }))
    return { plateH: plate ? Math.round(plate.getBoundingClientRect().height) : null, firstRowTop: firstRow ? Math.round(firstRow) : null, bands, clippedN: clipped.length, clipped }
  })
}

if (shot && mode !== 'fill') { mkdirSync(shot.replace(/\/[^/]+$/, ''), { recursive: true }); await page.screenshot({ path: shot, type: 'jpeg', quality: 78 }) }
console.log(JSON.stringify({ lane, vw, mode, peer: peer || null, ...out }, null, 1))
console.log('blocked writes:', blocked.length, blocked)
console.log('console errors:', errors.length, errors.slice(0, 3))
await browser.close()
