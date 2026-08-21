// Authed measurement harness for the workbench run.
//
// Measures the LOCAL preview build (our branch), never the live site: the live
// site is whatever Ivan last deployed and cannot prove anything about this work.
// Every read is a real getComputedStyle in a real authed browser, because the
// .wb.wb flattener makes source declarations non-evidence.
//
//   node measure.mjs --out <dir> [--base http://localhost:4173/] [--only dms,today]
//                    [--viewports 390,1024,1440,2560] [--shots] [--theme dark|light]
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const has = (n) => process.argv.includes('--' + n)

const OUT = arg('out')
if (!OUT) { console.error('need --out'); process.exit(1) }
const BASE = arg('base', 'http://localhost:4173/')
const THEME = arg('theme', 'dark')
const LANES = (arg('only', 'today,dms,content,magnets,styles,strategy,sends,ops,settings')).split(',')
const VPS = (arg('viewports', '390,1024,1440,2560')).split(',').map(Number)
const SHOTS = has('shots')
mkdirSync(OUT, { recursive: true })
if (SHOTS) mkdirSync(OUT + '/shots', { recursive: true })

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const blocked = []
const errors = []

// ---- the in-page probe. Everything below runs in the browser. ----
const probe = () => {
  const vw = innerWidth
  // Real glyph advance for `ch`: the 0.5em assumption overstates grotesk measure
  // by ~1.22x, which is how a 60ch block gets reported as 74ch and "fixed" twice.
  const cvs = document.createElement('canvas'); const ctx = cvs.getContext('2d')
  const zeroCache = new Map()
  const chWidth = (cs) => {
    const key = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
    if (!zeroCache.has(key)) { ctx.font = key; zeroCache.set(key, ctx.measureText('0').width || parseFloat(cs.fontSize) * 0.5) }
    return zeroCache.get(key)
  }
  const ownText = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')

  const type = new Map()      // size/lh/weight -> chars
  const tiny = []             // sub-11px text
  const long = []             // prose past the measure
  const roles = []            // per-element role samples for the computed-style table
  const over = []
  const seenFam = new Map()

  for (const el of document.querySelectorAll('body *')) {
    const t = ownText(el); const c = t.length
    const r = el.getBoundingClientRect()
    if (c) {
      const cs = getComputedStyle(el)
      const size = Math.round(parseFloat(cs.fontSize) * 10) / 10
      const lhpx = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight)
      const lh = lhpx == null ? 'n' : Math.round(lhpx * 10) / 10
      const k = `${size}/${lh}/${cs.fontWeight}`
      type.set(k, (type.get(k) || 0) + c)
      seenFam.set(cs.fontFamily.split(',')[0].replace(/["']/g, ''), 1)
      const cls = (el.className || '').toString().slice(0, 40)
      if (size < 11 && r.width > 0) tiny.push({ cls, size, txt: t.slice(0, 20) })
      if (c > 60 && r.width > 0) {
        const ch = Math.round(r.width / chWidth(cs))
        if (ch > 70) long.push({ cls, ch, size, txt: t.slice(0, 28) })
      }
      if (c > 3 && r.width > 0) roles.push({ cls, tag: el.tagName, size, lh, w: cs.fontWeight, ls: cs.letterSpacing, tt: cs.textTransform, fvn: cs.fontVariantNumeric, chars: c })
    }
    // overflow: children of an overflow-x scroller are not overflow
    if (r.width > 0 && r.height > 0 && (r.right > vw + 2 || r.left < -2)) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && r.width <= vw + 4) continue
      let p = el.parentElement, inside = false
      while (p && p !== document.body) {
        const pc = getComputedStyle(p)
        if (pc.overflowX === 'auto' || pc.overflowX === 'scroll') { inside = true; break }
        p = p.parentElement
      }
      if (!inside) over.push((el.className || '').toString().slice(0, 40) + '@' + Math.round(r.right))
    }
  }

  const ctrls = [...document.querySelectorAll('button,a,input,textarea,select,[role=button],[role=tab]')].map(e => {
    const r = e.getBoundingClientRect()
    return { h: Math.round(r.height), w: Math.round(r.width), l: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 22) }
  }).filter(c => c.w > 0 && c.h > 0)

  // plate fill: how much of the working plate actually carries content
  const plate = document.querySelector('.wb-work') || document.querySelector('.wb') || document.body
  const pr = plate.getBoundingClientRect()
  let painted = 0
  const step = 24
  const cols = Math.max(1, Math.floor(pr.width / step)), rows = Math.max(1, Math.floor(Math.min(pr.height, innerHeight) / step))
  let hits = 0, total = 0
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = pr.left + i * step + step / 2, y = pr.top + j * step + step / 2
    if (x < 0 || x > vw || y < 0 || y > innerHeight) continue
    total++
    const el = document.elementFromPoint(x, y)
    if (el && el !== plate && el !== document.body && plate.contains(el)) {
      const t = (el.textContent || '').trim()
      const cs = getComputedStyle(el)
      if (t || cs.backgroundImage !== 'none' || el.tagName === 'IMG' || el.tagName === 'SVG') hits++
    }
  }
  painted = total ? Math.round((hits / total) * 100) : 0

  const rawEnum = []
  const RAW = /\b(dm_sent|Dm_sent|thread_already_answered|LEAD_MAGNET|youtube_watch|QA_BLOCKED|LINT_FAIL|gold_icp_v2_seatless|[a-z]+_[a-z]+_[a-z_]+)\b/g
  const bodyTxt = document.body.innerText
  for (const m of bodyTxt.matchAll(RAW)) rawEnum.push(m[0])

  return {
    typeN: type.size,
    typeTop: [...type.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + '=' + v),
    families: [...seenFam.keys()],
    tinyN: tiny.length, tiny: tiny.slice(0, 8),
    longN: long.length, maxCh: long.length ? Math.max(...long.map(l => l.ch)) : 0, long: long.slice(0, 8),
    overN: over.length, over: over.slice(0, 6),
    ctrlN: ctrls.length, u32: ctrls.filter(c => c.h < 32).length,
    u32list: ctrls.filter(c => c.h < 32).slice(0, 8),
    u44: ctrls.filter(c => c.h < 44).length,
    platePct: painted, plateW: Math.round(pr.width), plateH: Math.round(pr.height),
    chars: document.body.innerText.trim().length,
    rawEnumN: rawEnum.length, rawEnum: [...new Set(rawEnum)].slice(0, 20),
    roles: roles.slice(0, 400),
    head: document.body.innerText.trim().slice(0, 200).replace(/\n+/g, ' | '),
  }
}

const browser = await chromium.launch()
const result = { base: BASE, theme: THEME, when: new Date().toISOString(), lanes: {} }

for (const vw of VPS) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (th === 'light') localStorage.setItem('inbox-theme', 'light') // src/main.tsx:8
  }, [session, THEME])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${vw} PAGEERROR ${String(e).slice(0, 120)}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${vw} CONSOLE ${m.text().slice(0, 120)}`) })
  await page.route('**/rest/v1/**', async route => {
    const req = route.request(); const m = req.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !req.url().includes('/rpc/'))) {
      blocked.push(m + ' ' + req.url().split('/rest/v1/')[1].slice(0, 80))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.continue()
  })

  for (const lane of LANES) {
    const url = BASE + '#exp/v2/' + lane
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(1800)
      const r = await page.evaluate(probe)
      result.lanes[`${lane}@${vw}`] = r
      if (SHOTS) await page.screenshot({ path: `${OUT}/shots/${lane}-${vw}${THEME === 'light' ? '-light' : ''}.jpg`, quality: 72, type: 'jpeg', fullPage: false })
      console.log(`${lane}@${vw}  type=${r.typeN} tiny=${r.tinyN} long=${r.longN}/max${r.maxCh}ch over=${r.overN} u32=${r.u32} plate=${r.platePct}% chars=${r.chars}`)
    } catch (e) {
      result.lanes[`${lane}@${vw}`] = { error: String(e).slice(0, 200) }
      console.log(`${lane}@${vw}  ERROR ${String(e).slice(0, 120)}`)
    }
  }
  await ctx.close()
}
await browser.close()
result.blockedWrites = blocked
result.consoleErrors = errors
writeFileSync(OUT + '/metrics.json', JSON.stringify(result, null, 1))
console.log('\nblocked writes:', blocked.length, blocked.slice(0, 5))
console.log('console errors:', errors.length, errors.slice(0, 5))
console.log('wrote', OUT + '/metrics.json')
