// Live probe of the phase-2 fix loop's uncertain items before re-shooting.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'http://localhost:4173/'
const browser = await chromium.launch()

async function probe(w, h, route, fn) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(`${BASE}#exp/v2/${route}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2800)
  const out = await page.evaluate(fn)
  await page.close()
  return { out, errors: errors.length }
}

// TODAY 1440: hero segments, legend dots, lane bars, trend span
const today = await probe(1440, 900, 'today', () => {
  const g = s => { const el = document.querySelector(s); return el ? getComputedStyle(el) : null }
  const segs = [...document.querySelectorAll('.td-stack .td-stack-s')].map(e => getComputedStyle(e).backgroundColor)
  const dots = [...document.querySelectorAll('.td-legend .td-lg-d')].map(e => getComputedStyle(e).backgroundColor)
  const bars = [...document.querySelectorAll('.td-lanes .td-bar-f')].map(e => getComputedStyle(e).backgroundColor)
  const barH = g('.td-bar')?.height
  const trend = document.querySelector('.td-tiles .td-tile:nth-child(2) .td-ts span')
  return { segs, dots, bars, barH, trend: trend ? getComputedStyle(trend).color + ' | attr=' + trend.getAttribute('style') : null }
})
console.log('TODAY', JSON.stringify(today, null, 1))

// SENDS 1440: meters, trend, peak bars
const sends = await probe(1440, 900, 'sends', () => {
  const meters = [...document.querySelectorAll('.ov-hero .ov-gauge-fill')].map(e => getComputedStyle(e).backgroundColor)
  const trend = document.querySelector('.ov-hero .ov-tile:first-child .ov-tile-trend')
  const peaks = [...document.querySelectorAll('.ov-kpi .sc-bar.peak')].map(e => getComputedStyle(e).backgroundColor)
  const badge = document.querySelector('.ov-rc-badge')
  return { meters, trend: trend ? getComputedStyle(trend).color : null, peaks, badge: badge ? getComputedStyle(badge).backgroundColor : null }
})
console.log('SENDS', JSON.stringify(sends, null, 1))

// OPS 1440: kind chips
const ops = await probe(1440, 900, 'ops', () => {
  return [...document.querySelectorAll('.ops-kind')].map(e => ({
    t: e.textContent, bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color,
  }))
})
console.log('OPS', JSON.stringify(ops, null, 1))

// INBOX 1440: avatars, band bar height + segs
const inbox = await probe(1440, 900, 'inbox', () => {
  const avs = [...document.querySelectorAll('.rows .av')].slice(0, 8).map(e => ({
    cls: e.className, bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color,
  }))
  const stack = document.querySelector('.wb-ihead .wb-stack')
  const segs = [...document.querySelectorAll('.wb-ihead .wb-stack-seg')].map(e => getComputedStyle(e).backgroundColor)
  const rowsTop = getComputedStyle(document.querySelector('.rows')).borderTopWidth
  return { avs, stackH: stack ? getComputedStyle(stack).height : null, segs, rowsTop }
})
console.log('INBOX', JSON.stringify(inbox, null, 1))

// CONTENT 1440 scrolled: sticky strip geometry vs rows
const content = await probe(1440, 900, 'content', () => {
  const rows = document.querySelector('.rows')
  rows.scrollTop = 900
  const strip = [...document.querySelectorAll('.wb-sech-strip')].find(s => {
    const r = s.getBoundingClientRect(); const pr = rows.getBoundingClientRect()
    return Math.abs(r.top - pr.top) < 8
  })
  const alertN = document.querySelector('.ct-alert-n')
  return {
    stuck: strip ? { w: strip.getBoundingClientRect().width, bg: getComputedStyle(strip).backgroundColor, pos: getComputedStyle(strip).position } : 'none-at-top',
    alertN: alertN ? { br: getComputedStyle(alertN).borderRightWidth + ' ' + getComputedStyle(alertN).borderRightColor, pr: getComputedStyle(alertN).paddingRight } : null,
  }
})
console.log('CONTENT', JSON.stringify(content, null, 1))

// MAGNETS 390: axis labels, cap centering
const magnets = await probe(390, 844, 'magnets', () => {
  const axis = [...document.querySelectorAll('.wb-caps-xl')].map(e => e.innerText.trim())
  const cap = document.querySelector('.wb-cap')
  const capV = document.querySelector('.wb-cap .wb-cap-v')
  let center = null
  if (cap && capV) {
    const c = cap.getBoundingClientRect(), v = capV.getBoundingClientRect()
    center = { capMidY: Math.round(c.top + c.height / 2), valMidY: Math.round(v.top + v.height / 2) }
  }
  return { axis, center, align: cap ? getComputedStyle(cap).alignItems : null }
})
console.log('MAGNETS390', JSON.stringify(magnets, null, 1))

// SENDS 390: labels visible? seats stacked? total wrap; funnel; filter fade on content
const s390 = await probe(390, 844, 'sends', () => {
  const lbls = [...document.querySelectorAll('.ov-tile-lbl')].map(e => ({ t: e.innerText, clipped: e.scrollWidth > e.clientWidth + 1 }))
  const seats = document.querySelector('.ov-seats')
  return { lbls, seatCols: seats ? getComputedStyle(seats).gridTemplateColumns : null }
})
console.log('SENDS390', JSON.stringify(s390, null, 1))

// CONTENT 390: action wrap + fpills mask + settings toggle
const c390 = await probe(390, 844, 'content', () => {
  const ac = document.querySelector('.ct-card .ct-ac')
  const fp = document.querySelector('.ct-fpills')
  return {
    ac: ac ? { col: getComputedStyle(ac).gridColumnStart + '/' + getComputedStyle(ac).gridColumnEnd, row: getComputedStyle(ac).gridRowStart } : null,
    fpMask: fp ? (getComputedStyle(fp).webkitMaskImage || getComputedStyle(fp).maskImage).slice(0, 80) : null,
  }
})
console.log('CONTENT390', JSON.stringify(c390, null, 1))

const settings = await probe(1440, 900, 'settings', () => {
  const sw = document.querySelector('.sw.on') || document.querySelector('.sw')
  return sw ? { cls: sw.className, bg: getComputedStyle(sw).backgroundColor } : null
})
console.log('SETTINGS', JSON.stringify(settings), null, 1)

await browser.close()
