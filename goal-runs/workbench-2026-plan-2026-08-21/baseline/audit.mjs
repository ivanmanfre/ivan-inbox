import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/e92e01da-e5fc-432a-abed-6fa98817c85a/scratchpad/audit'
mkdirSync(OUT + '/shots', { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/#exp/v2/'
const JOBS = ['today', 'dms', 'content', 'magnets', 'styles', 'strategy', 'sends', 'ops', 'settings']
const VIEWPORTS = [[1440, 900, 'd1440'], [390, 844, 'm390'], [1024, 768, 't1024'], [2560, 1440, 'w2560']]
const CENSUS_VPS = new Set(['d1440', 'm390'])

const probe = () => {
  const vw = innerWidth
  const txt = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').length

  // ---- type census: family|weight|style|size|lh -> chars
  const type = new Map()
  const tiny = []
  const lineLens = []
  for (const el of document.querySelectorAll('body *')) {
    const chars = txt(el)
    if (!chars) continue
    const cs = getComputedStyle(el)
    const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
    const size = Math.round(parseFloat(cs.fontSize) * 10) / 10
    const lh = cs.lineHeight === 'normal' ? 'normal' : Math.round(parseFloat(cs.lineHeight) * 10) / 10
    const k = `${fam}|${cs.fontWeight}|${cs.fontStyle}|${size}|${lh}`
    type.set(k, (type.get(k) || 0) + chars)
    if (size < 11) tiny.push({ cls: (el.className || '').toString().slice(0, 40), size, sample: el.textContent.trim().slice(0, 30) })
    const r = el.getBoundingClientRect()
    if (chars > 60 && r.width > 0) lineLens.push({ w: Math.round(r.width), size, ch: Math.round(r.width / (size * 0.5)) })
  }

  // ---- color census
  const bg = new Map(), fg = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      const area = Math.round(r.width * r.height)
      bg.set(cs.backgroundColor, (bg.get(cs.backgroundColor) || 0) + area)
    }
    if (txt(el)) fg.set(cs.color, (fg.get(cs.color) || 0) + txt(el))
  }

  // ---- spacing census (padding pairs on block containers)
  const pads = new Map(), radii = new Map()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 20) continue
    const cs = getComputedStyle(el)
    const p = `${parseInt(cs.paddingTop)}/${parseInt(cs.paddingLeft)}`
    pads.set(p, (pads.get(p) || 0) + 1)
    const rad = parseInt(cs.borderRadius)
    if (rad > 0) radii.set(rad, (radii.get(rad) || 0) + 1)
  }

  // ---- interactive controls
  const ctrls = []
  for (const el of document.querySelectorAll('button,a,input,select,textarea,[role=button],[tabindex]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    ctrls.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 34), w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) })
  }

  // ---- overflow
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 2 || r.left < -2) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && r.width <= vw + 4) continue
      let p = el.parentElement, inScroller = false
      while (p && p !== document.body) { const pc = getComputedStyle(p); if (pc.overflowX === 'auto' || pc.overflowX === 'scroll') { inScroller = true; break } p = p.parentElement }
      if (inScroller) continue
      over.push({ cls: (el.className || '').toString().slice(0, 50), tag: el.tagName, l: Math.round(r.left), r: Math.round(r.right) })
    }
  }

  // ---- rows / density
  const rowSel = '.ct-card, .r, .td-r, .dmh-r, .rows > *, [class*=row]'
  const rows = [...document.querySelectorAll(rowSel)].map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h > 8)
  const scrollers = [...document.querySelectorAll('body *')].filter(e => { const cs = getComputedStyle(e); return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 20 })
    .map(e => ({ cls: (e.className || '').toString().slice(0, 34), client: e.clientHeight, scroll: e.scrollHeight }))

  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  return {
    vw, docOverflowX: document.documentElement.scrollWidth > vw + 2,
    type: top(type, 24).map(([k, v]) => ({ k, chars: v })),
    typeDistinct: type.size,
    tinyCount: tiny.length, tiny: tiny.slice(0, 6),
    lineOver75ch: lineLens.filter(l => l.ch > 75).length,
    lineOver90ch: lineLens.filter(l => l.ch > 90).length,
    lineSample: lineLens.sort((a, b) => b.ch - a.ch).slice(0, 5),
    bg: top(bg, 12).map(([k, v]) => ({ c: k, area: v })),
    fg: top(fg, 10).map(([k, v]) => ({ c: k, chars: v })),
    pads: top(pads, 10).map(([k, v]) => ({ pad: k, n: v })), padDistinct: pads.size,
    radii: top(radii, 8).map(([k, v]) => ({ r: +k, n: v })),
    ctrlCount: ctrls.length,
    ctrlsUnder32: ctrls.filter(c => c.h < 32).length,
    ctrlsUnder24: ctrls.filter(c => c.h < 24).map(c => ({ ...c })).slice(0, 8),
    overflowCount: over.length, overflowers: over.slice(0, 6),
    rowCount: rows.length,
    rowMedian: rows.length ? rows.sort((a, b) => a - b)[Math.floor(rows.length / 2)] : null,
    rowMin: rows.length ? rows[0] : null, rowMax: rows.length ? rows[rows.length - 1] : null,
    scrollers: scrollers.slice(0, 6),
    bodyChars: document.body.innerText.trim().length,
    firstScreenText: document.body.innerText.trim().slice(0, 600),
  }
}

const browser = await chromium.launch()
const report = []
for (const [w, h, tag] of VIEWPORTS) {
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
    const errs = []
    page.on('pageerror', e => errs.push('P:' + String(e).slice(0, 120)))
    page.on('console', m => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 110)) })
    await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
    await page.goto(BASE + job, { waitUntil: 'networkidle' }).catch(() => { })
    await page.waitForTimeout(6000)
    let m = {}
    if (CENSUS_VPS.has(tag)) m = await page.evaluate(probe).catch(e => ({ err: String(e).slice(0, 100) }))
    else m = await page.evaluate(() => ({
      vw: innerWidth, docOverflowX: document.documentElement.scrollWidth > innerWidth + 2,
      bodyChars: document.body.innerText.trim().length,
    })).catch(e => ({ err: String(e).slice(0, 100) }))
    await page.screenshot({ path: `${OUT}/shots/${tag}-${job}.png` })
    report.push({ vp: tag, job, ...m, errs: errs.slice(0, 4) })
    process.stdout.write(`${tag}/${job} `)
    await page.close()
  }
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
console.log('\n--- ISSUES ---')
for (const r of report) {
  const bad = []
  if (r.docOverflowX) bad.push('OVERFLOW-X')
  if (r.overflowCount) bad.push(`${r.overflowCount} past edge`)
  if (r.tinyCount) bad.push(`${r.tinyCount} tiny<11px`)
  if (r.ctrlsUnder32) bad.push(`${r.ctrlsUnder32} ctrl<32px`)
  if (r.errs?.length) bad.push(`ERR ${r.errs[0]}`)
  if ((r.bodyChars || 0) < 150) bad.push(`EMPTY ${r.bodyChars}`)
  if (bad.length) console.log(`${r.vp} ${r.job}: ${bad.join(' | ')}`)
}
console.log('--- 1440 density ---')
console.log(report.filter(r => r.vp === 'd1440').map(r => `${r.job}: ${r.rowCount}rows med${r.rowMedian} type${r.typeDistinct} ${r.bodyChars}ch`).join('\n'))
await browser.close()
