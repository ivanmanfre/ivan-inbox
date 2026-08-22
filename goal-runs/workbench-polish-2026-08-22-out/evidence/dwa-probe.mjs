// dwa probe - measures the draft window: artifact width, accent census,
// computed type on every value this branch authors, action row geometry,
// inspector row heights.
//
// SAFETY. The write interceptor is installed on **/rest/v1/** AND on
// **/rest/v1/rpc/** BEFORE any navigation, because opening a draft stamps live
// rows and an RPC is a POST the standard pattern lets through
// (goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs:13-19).
// Every attempted write is counted and printed.
//
// Usage: node dwa-probe.mjs [baseUrl] [outJson]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:4184/'
const OUT = process.argv[3] || '/tmp/dwa-probe.json'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

let attemptedWrites = 0
const writeLog = []
async function installInterceptor(page) {
  const handler = async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      attemptedWrites++
      writeLog.push(`${m} ${q.url()}`)
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  }
  // Both patterns. The rpc one is a subset of the first, but it is stated
  // separately so a future edit to the first cannot silently drop it.
  await page.route('**/rest/v1/**', handler)
  await page.route('**/rest/v1/rpc/**', handler)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await installInterceptor(page)
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push(String(e)))

await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1400)
await page.locator('.ct-card').first().click().catch(() => {})
await page.waitForTimeout(1400)

const out = await page.evaluate(() => {
  const r = n => Math.round(n * 100) / 100
  const dw = document.querySelector('.dw')
  if (!dw) return { error: 'no .dw on screen' }

  // ---- accent census, scoped to .dw, the same shape as census B3 ----
  // An element is accent-weighted when the accent hex is its background, its
  // colour, or its border/outline colour. Text nodes only: a wrapper that
  // inherits colour but paints no glyphs is not a spend.
  const ACCENT = ['rgb(184, 255, 102)', '#B8FF66', 'rgb(197, 225, 165)']
  const isAccent = v => !!v && ACCENT.some(a => v.toLowerCase().includes(a.toLowerCase()))
  const accent = []
  for (const el of dw.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
    const hits = []
    if (isAccent(cs.backgroundColor)) hits.push('fill')
    if (isAccent(cs.backgroundImage)) hits.push('fill-image')
    // colour counts only where this element itself paints text
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (ownText && isAccent(cs.color)) hits.push('text')
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && isAccent(cs[`border${side}Color`])) { hits.push('edge'); break }
    }
    if (parseFloat(cs.outlineWidth) > 0 && isAccent(cs.outlineColor)) hits.push('edge')
    if (isAccent(cs.boxShadow)) hits.push('edge')
    if (hits.length) {
      accent.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        hits, w: r(rect.width), h: r(rect.height),
        text: (el.textContent || '').trim().slice(0, 40),
      })
    }
  }

  // ---- the artifact measure ----
  const inn = document.querySelector('.dw-main-in')
  const card = document.querySelector('.li-card')
  const main = document.querySelector('.dw-main')
  const acts = document.querySelector('.dw-acts')

  // ---- the action row ----
  const keys = [...document.querySelectorAll('.dw-acts button')].map(b => {
    const cs = getComputedStyle(b), bb = b.getBoundingClientRect()
    return {
      label: (b.textContent || '').trim(),
      cls: b.className,
      h: r(bb.height), w: r(bb.width),
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      radius: cs.borderRadius,
      font: `${cs.fontSize}/${cs.fontWeight}`,
      fill: cs.backgroundColor,
      color: cs.color,
      border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
      shadow: cs.boxShadow,
    }
  })

  // ---- label/value rows in the inspector ----
  const kvSel = ['.dd-row', '.dwk-row', '.wbkv > *'].join(',')
  const kvRows = [...document.querySelectorAll('.dw-insp ' + '.dd-row')].map(el => {
    const k = el.querySelector('.dd-k'), v = el.querySelector('.dd-v')
    const kcs = k && getComputedStyle(k), vcs = v && getComputedStyle(v)
    return {
      h: r(el.getBoundingClientRect().height),
      k: k && (k.textContent || '').trim().slice(0, 24),
      kType: kcs && `${kcs.fontSize}/${kcs.fontWeight}/${kcs.textTransform}/${kcs.letterSpacing}`,
      vType: vcs && `${vcs.fontSize}/${vcs.fontWeight}`,
      border: el.parentElement && getComputedStyle(el.parentElement).borderTopWidth,
    }
  })
  const wbkv = [...document.querySelectorAll('.dw-insp .wbkv')].map(el => {
    const ks = [...el.querySelectorAll('.wbkv-k')]
    const vs = [...el.querySelectorAll('.wbkv-v')]
    return {
      rows: ks.length,
      kType: ks[0] && (cs => `${cs.fontSize}/${cs.fontWeight}/${cs.textTransform}/${cs.letterSpacing}`)(getComputedStyle(ks[0])),
      vType: vs[0] && (cs => `${cs.fontSize}/${cs.fontWeight}`)(getComputedStyle(vs[0])),
      rowH: ks.map(k => r(k.getBoundingClientRect().height)),
    }
  })

  // ---- named type checks: every value this branch authors ----
  const named = {}
  const check = (name, sel, props = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor', 'borderRadius']) => {
    const el = document.querySelector(sel)
    if (!el) { named[name] = null; return }
    const cs = getComputedStyle(el)
    named[name] = Object.fromEntries(props.map(p => [p, cs[p]]))
  }
  check('inspHeader', '.dw-insp-h')
  check('secName', '.dw-sec-n')
  check('capTitle', '.dw-cap-t')
  check('qaScore', '.wb-qa-n')
  check('qaDimKey', '.qa-dim-k')
  check('qaDimNum', '.qa-dim-n')
  check('ddK', '.dw-insp .dd-k')
  check('ddV', '.dw-insp .dd-v')
  check('wbkvK', '.dw-insp .wbkv-k')
  check('wbkvV', '.dw-insp .wbkv-v')
  check('wbbPrimary', '.dw-acts .wbb-primary')
  check('wbbSecondary', '.dw-acts .wbb-secondary')
  check('wbbQuiet', '.dw-acts .wbb-quiet')
  check('wbbDanger', '.dw-acts .wbb-danger')
  check('jumpTab', '.dw-jump')

  // ---- the raw urn, defect 1 ----
  const urn = [...dw.querySelectorAll('*')].some(el =>
    [...el.childNodes].some(n => n.nodeType === 3 && /urn:li:/.test(n.textContent)))
  const urnText = [...dw.querySelectorAll('*')].flatMap(el =>
    [...el.childNodes].filter(n => n.nodeType === 3 && /urn:li:/.test(n.textContent))
      .map(n => n.textContent.trim().slice(0, 60))).slice(0, 4)

  // ---- shouting labels: any element inside .dw computing uppercase ----
  const caps = []
  for (const el of dw.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.textTransform !== 'uppercase') continue
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1) continue
    caps.push({
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
      text: (el.textContent || '').trim().slice(0, 30),
    })
  }

  // ---- dead field: how much of the main column is empty under the acts bar ----
  const mainRect = main?.getBoundingClientRect()
  const actsRect = acts?.getBoundingClientRect()

  return {
    artifact: {
      dwMainIn: inn ? r(inn.getBoundingClientRect().width) : null,
      dwMainInMaxWidth: inn ? getComputedStyle(inn).maxWidth : null,
      liCard: card ? r(card.getBoundingClientRect().width) : null,
      dwMain: mainRect ? r(mainRect.width) : null,
      actsWidth: actsRect ? r(actsRect.width) : null,
      actsLeft: actsRect ? r(actsRect.left) : null,
      innLeft: inn ? r(inn.getBoundingClientRect().left) : null,
    },
    accentCount: accent.length,
    accent,
    keys,
    kvRows,
    kvRowStats: kvRows.length ? {
      n: kvRows.length,
      min: Math.min(...kvRows.map(x => x.h)),
      median: kvRows.map(x => x.h).sort((a, b) => a - b)[Math.floor(kvRows.length / 2)],
      max: Math.max(...kvRows.map(x => x.h)),
      under40: kvRows.filter(x => x.h < 40).length,
    } : null,
    wbkv,
    named,
    urnPresent: urn, urnText,
    capsCount: caps.length, caps,
  }
})

writeFileSync(OUT, JSON.stringify({ ...out, consoleErrors: errs, attemptedWrites, writeLog }, null, 2))
console.log('attemptedWrites =', attemptedWrites)
console.log('consoleErrors  =', errs.length, errs.slice(0, 5))
console.log('accentCount    =', out.accentCount)
console.log('artifact       =', JSON.stringify(out.artifact))
console.log('kvRowStats     =', JSON.stringify(out.kvRowStats))
console.log('urnPresent     =', out.urnPresent, out.urnText)
console.log('capsCount      =', out.capsCount)
console.log('->', OUT)
await browser.close()
