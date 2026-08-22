// Every number this build renders, read back OUT of the DOM, plus the computed
// style of every declaration the build added. Both halves matter: a count that
// is wrong is worse than no count, and a rule written with two .wb classes
// renders at body size and looks correct in review (faithful.css:181).
import { open, settle } from './harness.mjs'

const { browser, page, writes, errors } = await open({ width: 1440, height: 900, theme: 'dark' })
await page.goto('http://127.0.0.1:4187/#exp/v2/content', { waitUntil: 'domcontentloaded' })
await settle(page, 6000)

const rendered = await page.evaluate(() => {
  const t = s => document.querySelector(s)?.textContent?.trim() ?? null
  const rail = {}
  for (const r of document.querySelectorAll('.wb-rail .wb-rj')) {
    const l = r.querySelector('.wb-rj-l')?.textContent?.trim()
    const n = r.querySelector('.wb-rj-n')?.textContent?.trim()
    if (l) rail[l] = n ? +n : 0
  }
  const lanes = {}
  for (const b of document.querySelectorAll('.ct-cmd-lane')) {
    const n = b.querySelector('.ct-cmd-lane-n')?.textContent?.trim()
    lanes[b.textContent.replace(/\d+$/, '').trim()] = n ? +n : 0
  }
  const tabs = {}
  for (const b of document.querySelectorAll('.ct-tab')) {
    tabs[b.querySelector('.ct-tab-t')?.textContent?.trim() ?? '?'] =
      +(b.querySelector('.ct-tab-n')?.textContent?.trim() ?? 0)
  }
  return {
    rollup: t('.wb-rollup-n') === null ? null : +t('.wb-rollup-n'),
    rollupNote: document.querySelector('.wb-rollup')?.getAttribute('title') ?? null,
    rail, lanes, tabs,
    contentNote: [...document.querySelectorAll('.wb-rail .wb-rj')]
      .find(r => r.querySelector('.wb-rj-l')?.textContent === 'Content')?.getAttribute('title') ?? null,
  }
})

// COMPUTED STYLE. Each entry: selector -> the properties the build set on it.
const style = await page.evaluate(() => {
  const want = {
    '.wb-rollup-n': ['fontSize', 'fontWeight', 'color', 'letterSpacing'],
    '.wb-rollup-l': ['fontSize', 'fontWeight', 'color', 'textTransform'],
    '.ct-cmd-lane-n': ['fontSize', 'fontWeight', 'color', 'fontFamily'],
    '.wb-rj-health .wb-rj-ic': ['color'],
    '.wb-rj-health .wb-rj-n': ['color', 'backgroundColor'],
  }
  const out = {}
  for (const [sel, props] of Object.entries(want)) {
    const el = document.querySelector(sel)
    if (!el) { out[sel] = 'NOT RENDERED'; continue }
    const cs = getComputedStyle(el)
    out[sel] = Object.fromEntries(props.map(p => [p, cs[p]]))
  }
  return out
})

// The collapsed rail: the pip must be the thing that survives.
await page.evaluate(() => localStorage.setItem('wb-railmin', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page, 5500)
const collapsed = await page.evaluate(() => {
  const pips = [...document.querySelectorAll('.wb-rj-pip')]
    .filter(p => getComputedStyle(p).display !== 'none')
  const nums = [...document.querySelectorAll('.wb-rj-n')]
    .filter(p => getComputedStyle(p).display !== 'none')
  const p0 = pips[0] && getComputedStyle(pips[0])
  return {
    visiblePips: pips.length,
    visibleNumerals: nums.length,
    pipBox: p0 ? { w: p0.width, h: p0.height, bg: p0.backgroundColor } : null,
    rollupVisible: !!document.querySelector('.wb-rollup'),
    rollupText: document.querySelector('.wb-rollup')?.textContent?.trim() ?? null,
  }
})

// Ops: the automation list, read out of the DOM.
await page.evaluate(() => localStorage.setItem('wb-railmin', '0'))
await page.goto('http://127.0.0.1:4187/#exp/v2/ops', { waitUntil: 'domcontentloaded' })
await settle(page, 6000)
const ops = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.ops-pipe-t')].map(e => e.textContent)
  const block = [...document.querySelectorAll('.ops-pipe')]
    .find(b => b.querySelector('.ops-pipe-t')?.textContent === 'Automations')
  if (!block) return { heads, found: false }
  const rows = [...block.querySelectorAll('.wb-auto-l')].map(r => ({
    name: r.querySelector('.wb-auto-n')?.textContent,
    why: r.querySelector('.wb-auto-w')?.textContent,
  }))
  const nameCs = getComputedStyle(block.querySelector('.wb-auto-n'))
  const whyCs = getComputedStyle(block.querySelector('.wb-auto-w'))
  return {
    heads, found: true,
    n: +(block.querySelector('.ops-pipe-n')?.textContent ?? 0),
    rows,
    tail: [...block.querySelectorAll('.ops-pipe-l')].pop()?.textContent,
    style: {
      '.wb-auto-n': { fontSize: nameCs.fontSize, fontWeight: nameCs.fontWeight, color: nameCs.color },
      '.wb-auto-w': { fontSize: whyCs.fontSize, fontWeight: whyCs.fontWeight, color: whyCs.color },
    },
  }
})

// The phone frame.
await browser.close()
const m = await open({ width: 390, height: 844, theme: 'dark' })
await m.page.goto('http://127.0.0.1:4187/#exp/v2/content', { waitUntil: 'domcontentloaded' })
await settle(m.page, 6000)
const mobile = await m.page.evaluate(() => {
  const roll = document.querySelector('.wb-rib-j .wb-rollup')
  const h = document.querySelector('.wb-rib-health-n')
  const seg = {}
  for (const b of document.querySelectorAll('.wb-ws')) {
    seg[b.childNodes[0]?.textContent?.trim() ?? '?'] = +(b.querySelector('b')?.textContent ?? 0)
  }
  return {
    rollup: roll?.textContent?.trim() ?? null,
    rollupTransform: roll ? getComputedStyle(roll.querySelector('.wb-rollup-l')).textTransform : null,
    health: h?.textContent ?? null,
    healthStyle: h ? { fontSize: getComputedStyle(h).fontSize, color: getComputedStyle(h).color, textTransform: getComputedStyle(h).textTransform } : null,
    workSegment: seg,
  }
})
const allWrites = writes.concat(m.writes)
await m.browser.close()
console.log(JSON.stringify({ rendered, style, collapsed, ops, mobile, writes: allWrites.length, writeList: allWrites, errors: errors.concat(m.errors) }, null, 1))
