// Independent gate instrument for candidate `faithful`.
// Written fresh by the instrument agent — NOT a copy of the builder's
// scripts/sweep-faithful.mjs, though it reuses the wait-discipline the spine
// itself prescribes (domcontentloaded, never networkidle, poll for skeletons
// gone + literal "Loading" gone) because that discipline is specified
// methodology, not something the builder invented to game.
//
// Usage: node verify-faithful.mjs <baseUrl> <outDir> <sessionPath>
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const baseUrl = process.argv[2]
const outDir = process.argv[3]
const sessionPath = process.argv[4]
mkdirSync(outDir, { recursive: true })

const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null
if (!session) { console.error('NO SESSION — refusing to capture, every shot would be a lie'); process.exit(1) }

const M = { w: 390, h: 844, tag: 'mobile' }
const D = { w: 1440, h: 900, tag: 'desktop' }

const ROUTES = [
  { name: 'today', hash: '#exp/v2/today', settle: 9200 },
  { name: 'inbox', hash: '#exp/v2/inbox' },
  { name: 'drafts', hash: '#exp/v2/drafts' },
  { name: 'content', hash: '#exp/v2/content' },
  { name: 'sends', hash: '#exp/v2/sends' },
  { name: 'ops', hash: '#exp/v2/ops' },
]

// ---- MEASURE, written independently ----
const MEASURE = function () {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const root = document.querySelector('.wb')
  if (!root) return { noWb: true }
  const all = [...root.querySelectorAll('*')].filter(vis)
  const leaves = all.filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
  const txt = (el) => (el.textContent ?? '').trim()
  const isWordy = (el) => /[a-z0-9]/i.test(txt(el))

  // type census
  const sizes = {}
  const glyphSizes = {}
  for (const el of leaves) {
    const fs = getComputedStyle(el).fontSize
    const bucket = isWordy(el) ? sizes : glyphSizes
    bucket[fs] = (bucket[fs] ?? 0) + 1
  }
  const distinctSizes = Object.keys(sizes)
  const fractional = distinctSizes.filter((s) => !Number.isInteger(parseFloat(s)))

  // weight >=700
  const heavy = leaves.filter((el) => parseInt(getComputedStyle(el).fontWeight, 10) >= 700)
    .map((el) => ({ cls: el.className?.toString().slice(0, 44), px: parseFloat(getComputedStyle(el).fontSize), text: txt(el).slice(0, 30) }))

  // tabular-nums: any leaf containing a digit
  const nonTabular = leaves.filter((el) => /\d/.test(txt(el)))
    .filter((el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'))
    .map((el) => `${el.className?.toString().slice(0, 34)}: "${txt(el).slice(0, 24)}"`)

  // accent census (rendered)
  const ACC = 'rgb(16, 163, 127)'
  const accentEls = all.filter((el) => {
    const s = getComputedStyle(el)
    return [s.color, s.backgroundColor, s.borderTopColor, s.borderRightColor, s.borderBottomColor,
      s.borderLeftColor, s.outlineColor, s.boxShadow, s.backgroundImage].some((v) => v && v.includes('16, 163, 127'))
  })

  // pill census: ALL elements with radius>=100px or 50% — report raw, no allowlist filtering
  // (the instrument does not trust a class allowlist; it dumps everything for
  // manual adjudication against spine §6.3).
  const pillEls = all.filter((el) => {
    const r = getComputedStyle(el).borderRadius
    return /(\d{3,})px/.test(r) || r.trim() === '50%'
  }).map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName, cls: el.className?.toString().slice(0, 50),
      w: Math.round(rect.width), h: Math.round(rect.height),
      text: txt(el).slice(0, 20),
    }
  })

  // rail test — x of primary text per known working-list row type
  const railOf = (rowSel, primarySel) => {
    const rows = [...document.querySelectorAll(rowSel)].filter(vis)
    const xs = rows.map((r) => {
      const p = r.querySelector(primarySel) ?? r
      return Math.round(p.getBoundingClientRect().left)
    })
    if (xs.length === 0) return null
    return { n: xs.length, min: Math.min(...xs), max: Math.max(...xs), variance: Math.max(...xs) - Math.min(...xs) }
  }
  const rails = {
    content: railOf('.ct-card:not(.ct-idea)', '.ct-title'),
    contentIdeas: railOf('.ct-card.ct-idea', '.ct-title'),
    inbox: railOf('.rows .r', '.name'),
    today: railOf('.td-r', '.td-nm'),
    drafts: railOf('.rows .log-r', '.log-nm'),
    sendsLog: railOf('.log-r', '.log-nm'),
  }
  // trailing tabular right-edge rail
  const tailRailOf = (sel) => {
    const els = [...document.querySelectorAll(sel)].filter(vis)
    if (els.length === 0) return null
    const xs = els.map((e) => Math.round(e.getBoundingClientRect().right))
    return { n: xs.length, variance: Math.max(...xs) - Math.min(...xs) }
  }
  const tailRails = { content: tailRailOf('.ct-card .ct-tm'), sendsLog: tailRailOf('.log-r .log-tm') }

  // density band: content-box height
  const bandOf = (sel) => {
    const els = [...document.querySelectorAll(sel)].filter(vis)
    if (els.length === 0) return null
    const hs = els.map((r) => {
      const s = getComputedStyle(r)
      return Math.round(r.getBoundingClientRect().height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom))
    })
    return { n: hs.length, min: Math.min(...hs), max: Math.max(...hs) }
  }
  const bands = {
    content: bandOf('.ct-card:not(.ct-idea), .ct-idea-h'),
    inbox: bandOf('.rows .r'),
    today: bandOf('.td-r'),
    sendsLog: bandOf('.log-r'),
  }

  // WCAG contrast walk — text leaves, alpha-composited background walk-up.
  const lum = (rgbStr) => {
    const m = rgbStr.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number)
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const effectiveBg = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const bc = getComputedStyle(n).backgroundColor
      const m = bc.match(/[\d.]+/g)
      if (m && (m.length < 4 || Number(m[3]) > 0.9)) return bc
      n = n.parentElement
    }
    return getComputedStyle(document.documentElement).backgroundColor || 'rgb(0,0,0)'
  }
  const contrastFails = []
  const contrastAll = []
  for (const el of leaves) {
    const s = getComputedStyle(el)
    const px = parseFloat(s.fontSize)
    const bold = parseInt(s.fontWeight, 10) >= 700
    const isLarge = px >= 24 || (px >= 18.66 && bold)
    const bar = isLarge ? 3.0 : 4.5
    const l1 = lum(s.color)
    const l2 = lum(effectiveBg(el))
    if (l1 === null || l2 === null) continue
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const rec = { cls: el.className?.toString().slice(0, 30), px, bold, ratio: Number(ratio.toFixed(2)), bar, text: txt(el).slice(0, 22) }
    contrastAll.push(rec)
    if (ratio < bar) contrastFails.push(rec)
  }

  const d = document.documentElement
  return {
    bridgeBg: getComputedStyle(root).getPropertyValue('--bg').trim(),
    bridgeBlue: getComputedStyle(root).getPropertyValue('--blue').trim(),
    docOverflowX: d.scrollWidth !== d.clientWidth,
    scrollWidth: d.scrollWidth, clientWidth: d.clientWidth,
    innerTextLen: (document.body.innerText ?? '').length,
    skeletons: document.querySelectorAll('.sk').length,
    stillLoading: /Loading/i.test(root.innerText ?? ''),
    type: { distinct: distinctSizes.length, sizes, fractional, glyphSizes: Object.keys(glyphSizes) },
    heavy,
    nonTabular,
    accentCount: accentEls.length,
    pillEls,
    rails, tailRails, bands,
    contrastFailCount: contrastFails.length,
    contrastFails,
    // keep the full walk small-ish but enough to hand-verify 3 random leaves
    contrastSampleAll: contrastAll.slice(0, 40),
    catAttr: d.getAttribute('data-cat'),
    logDenom: document.querySelector('.log-denom')?.innerText?.replace(/\s+/g, ' ').trim() ?? null,
  }
}

const browser = await chromium.launch()
const report = { routes: [] }

for (const route of ROUTES) {
  for (const vp of [M, D]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: m.text().slice(0, 300), loc: m.location() }) })
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
    await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
    await page.addInitScript(() => window.localStorage.setItem('inbox-theme', 'dark'))
    await page.goto(`${baseUrl}${route.hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch((e) => pageErrors.push(`goto: ${String(e).slice(0, 150)}`))
    await page.waitForFunction(() => {
      if (document.querySelectorAll('.sk').length > 0) return false
      return document.querySelectorAll(
        '.wb .ct-card, .wb .rows .r, .wb .td-r, .wb .ov-tile, .wb .log-r, .wb .sw, .wb .wb-empty, .wb .wb-failed, .wb .wb-starter, .wb .qc',
      ).length > 0
    }, null, { timeout: 75000 }).catch(() => {})
    await page.waitForTimeout(route.settle ?? 2600)
    const loadingGone = await page.waitForFunction(
      () => !/Loading/i.test(document.querySelector('.wb')?.innerText ?? ''),
      null, { timeout: 30000 },
    ).then(() => true).catch(() => false)
    // innerText settle check: two reads 1s apart equal
    const t1 = await page.evaluate(() => document.body.innerText.length)
    await page.waitForTimeout(1000)
    const t2 = await page.evaluate(() => document.body.innerText.length)
    const settled = t1 === t2
    const m = await page.evaluate(MEASURE)
    const file = `${outDir}/${route.name}-${vp.tag}.png`
    await page.screenshot({ path: file, fullPage: false })
    report.routes.push({
      route: route.name, tag: vp.tag, file,
      consoleErrors, pageErrors, loadingGone, settled, ...m,
    })
    console.log(`${route.name}/${vp.tag} txt=${m.innerTextLen} sizes=${m.type.distinct} frac=${m.type.fractional.length} heavy=${m.heavy.length} accent=${m.accentCount} pills=${m.pillEls.length} contrastFail=${m.contrastFailCount} ovf=${m.docOverflowX} consoleErr=${consoleErrors.length} settled=${settled} loadingGone=${loadingGone}`)
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${outDir}/verify-report.json`, JSON.stringify(report, null, 2))
console.log(`\ndone -> ${outDir}/verify-report.json`)
