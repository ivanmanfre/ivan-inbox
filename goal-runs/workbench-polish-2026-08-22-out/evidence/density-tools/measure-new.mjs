// Density Analyst — live measurement of the NEW inbox (localhost:4173).
// Legitimate session only (sb-bjbvqvzbzczjbatgmccb-auth-token from
// .session.json). Write interceptor stubs every PATCH/PUT/DELETE/POST on
// **/rest/v1/** and **/rest/v1/rpc/** with 200 [] before any navigation.
// Does NOT rebuild or restart the localhost:4173 server.
//
// Usage: node measure-new.mjs <outdir>
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = process.argv[2] || '.'
mkdirSync(OUT, { recursive: true })

let writeAttempts = 0
const writeLog = []

const browser = await chromium.launch()

// In-page measurement function, shared across every screen/viewport.
// recordSel: CSS selector for one "record" (a row/card/chip).
// scrollSel: optional selector for the scroll container to use as the
//   "viewport" bound instead of window (rows below its bottom don't count
//   as visible without scrolling).
const MEASURE_FN = ({ recordSel, scrollSelList, contentRootSel }) => {
  const contentRoot = (contentRootSel && document.querySelector(contentRootSel)) || document.body
  function charWidth(font) {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    ctx.font = font
    return {
      zero: ctx.measureText('0').width,
      avgLower: ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26,
      space: ctx.measureText(' ').width,
    }
  }

  // 1. Type census: walk all text nodes, bucket by (family, size, weight, lh).
  const buckets = new Map()
  const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.textContent || !n.textContent.trim()) return NodeFilter.FILTER_REJECT
      const p = n.parentElement
      if (!p) return NodeFilter.FILTER_REJECT
      const cs = getComputedStyle(p)
      if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT
      const r = p.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let node
  while ((node = walker.nextNode())) {
    const p = node.parentElement
    const cs = getComputedStyle(p)
    const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight].join('|')
    const chars = node.textContent.trim().length
    if (!buckets.has(key)) {
      buckets.set(key, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, chars: 0, nodeCount: 0 })
    }
    const b = buckets.get(key)
    b.chars += chars
    b.nodeCount += 1
  }
  const typeCensus = [...buckets.values()].sort((a, b) => b.chars - a.chars)

  // 2. Records visible in the first viewport without scrolling.
  const vw = window.innerWidth, vh = window.innerHeight
  let scrollBound = { top: 0, bottom: vh }
  for (const s of scrollSelList) {
    const el = document.querySelector(s)
    if (el) { const r = el.getBoundingClientRect(); scrollBound = { top: Math.max(0, r.top), bottom: Math.min(vh, r.bottom) }; break }
  }
  const records = [...document.querySelectorAll(recordSel)]
  const visibleRecords = records.filter(el => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= vh && r.height > 0 && r.top < scrollBound.bottom
  })
  const wordsVisible = visibleRecords.reduce((sum, el) => sum + (el.textContent || '').trim().split(/\s+/).filter(Boolean).length, 0)

  // 3. Vertical cost of one record + decomposition.
  let rowDecomp = null
  if (records.length >= 2) {
    const el = records[0]
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const pad = { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom) }
    const border = { top: parseFloat(cs.borderTopWidth), bottom: parseFloat(cs.borderBottomWidth) }
    // gap to next record (sibling distance), best-effort: next element in the list with same match
    const idx = records.indexOf(el)
    let gapToNext = null
    if (records[idx + 1]) {
      const r2 = records[idx + 1].getBoundingClientRect()
      gapToNext = Math.round((r2.top - r.bottom) * 10) / 10
    }
    // dominant text line-height inside the record (the largest-chars bucket found within this element)
    const innerBuckets = new Map()
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let tn
    while ((tn = tw.nextNode())) {
      if (!tn.textContent.trim()) continue
      const p = tn.parentElement
      const cs2 = getComputedStyle(p)
      const key = cs2.fontSize + '|' + cs2.lineHeight
      innerBuckets.set(key, (innerBuckets.get(key) || 0) + tn.textContent.trim().length)
    }
    const dominant = [...innerBuckets.entries()].sort((a, b) => b[1] - a[1])[0]
    rowDecomp = {
      totalHeight: Math.round(r.height * 10) / 10,
      paddingTop: pad.top, paddingBottom: pad.bottom,
      borderTop: border.top, borderBottom: border.bottom,
      gapToNextRecord: gapToNext,
      dominantTextFontSizeLineHeight: dominant ? dominant[0] : null,
      recordFullClass: el.className,
    }
  }

  // 4. Chrome vs content: sum of visible record heights vs full viewport height.
  const contentTop = visibleRecords.length ? Math.min(...visibleRecords.map(el => el.getBoundingClientRect().top)) : null
  const contentBottom = visibleRecords.length ? Math.max(...visibleRecords.map(el => el.getBoundingClientRect().bottom)) : null
  const chromeShare = contentTop !== null ? {
    chromeAboveContentPx: Math.round(contentTop),
    chromeBelowViewportPx: Math.round(vh - contentBottom),
    chromeSharePct: Math.round(((contentTop + (vh - contentBottom)) / vh) * 1000) / 10,
  } : null

  // 5. Line length in characters for the dominant body-text bucket, using
  // canvas measureText on the ACTUAL font, not a 0.5em assumption.
  const bodyBucket = typeCensus.find(b => parseFloat(b.fontSize) >= 11) || typeCensus[0]
  let lineLenChars = null
  if (bodyBucket) {
    const w = charWidth(`${bodyBucket.fontWeight} ${bodyBucket.fontSize} ${bodyBucket.fontFamily}`)
    // usable width: width of the first record's text container (best-effort:
    // record element's own content box)
    const sampleEl = records[0]
    const cw = sampleEl ? sampleEl.getBoundingClientRect().width - (sampleEl ? parseFloat(getComputedStyle(sampleEl).paddingLeft) + parseFloat(getComputedStyle(sampleEl).paddingRight) : 0) : vw * 0.6
    lineLenChars = {
      fontSpec: `${bodyBucket.fontWeight} ${bodyBucket.fontSize} ${bodyBucket.fontFamily}`,
      zeroWidthPx: Math.round(w.zero * 100) / 100,
      avgLowerWidthPx: Math.round(w.avgLower * 100) / 100,
      containerWidthPx: Math.round(cw),
      charsPerLine_zeroMethod: Math.round(cw / w.zero),
      charsPerLine_avgLowerMethod: Math.round(cw / w.avgLower),
    }
  }

  return {
    viewport: { w: vw, h: vh },
    recordSelector: recordSel,
    recordCountTotal: records.length,
    recordCountVisibleNoScroll: visibleRecords.length,
    wordsVisibleNoScroll: wordsVisible,
    typeCensus,
    rowDecomp,
    chromeShare,
    lineLenChars,
  }
}

async function measureScreen({ name, url, clicks = [], recordSel, scrollSelList = [], viewports }) {
  const results = {}
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
    const page = await ctx.newPage()
    const blocker = async (r) => {
      const req = r.request()
      const m = req.method()
      if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
        writeAttempts++
        writeLog.push({ app: 'NEW', method: m, url: req.url() })
        return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return r.continue()
    }
    await page.route('**/rest/v1/**', blocker)
    await page.route('**/rest/v1/rpc/**', blocker)

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err', name, e.message))
    await page.waitForTimeout(2000)
    for (const c of clicks) {
      await page.getByText(c, { exact: true }).first().click().catch(() => {})
      await page.waitForTimeout(1200)
    }
    await page.waitForTimeout(500)

    const shotPath = `${OUT}/${name.replace(/\s+/g, '-')}-${vp.width}x${vp.height}.jpg`
    await page.screenshot({ path: shotPath, quality: 85, type: 'jpeg' }).catch(() => {})

    const chromeInfo = await page.evaluate(() => {
      const rail = document.querySelector('.wb-rail')
      const rr = rail ? rail.getBoundingClientRect() : null
      return { railWidthPx: rr ? Math.round(rr.width) : 0, railVisible: !!(rr && rr.width > 0) }
    })
    const measured = await page.evaluate(MEASURE_FN, { recordSel, scrollSelList, contentRootSel: '.wb-work' })
    measured.chromeInfo = chromeInfo
    results[`${vp.width}x${vp.height}`] = measured
    await ctx.close()
  }
  return results
}

const screens = [
  { name: 'NEW-content-ideas', url: 'http://localhost:4173/#exp/v2/content', clicks: ['Ideas'], recordSel: '.ct-card.ct-tap', scrollSelList: ['.ct-rows', '.rows'] },
  { name: 'NEW-dms', url: 'http://localhost:4173/#exp/v2/dms', clicks: [], recordSel: '.r', scrollSelList: ['.rows'] },
  { name: 'NEW-content-calendar', url: 'http://localhost:4173/#exp/v2/content', clicks: ['Calendar'], recordSel: '.cal-chip', scrollSelList: [] },
  { name: 'NEW-settings', url: 'http://localhost:4173/#exp/v2/settings', clicks: [], recordSel: '.grow', scrollSelList: [] },
  { name: 'NEW-styles', url: 'http://localhost:4173/#exp/v2/styles', clicks: [], recordSel: '.ct-style', scrollSelList: [] },
]

const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]

const all = {}
for (const s of screens) {
  console.log('measuring', s.name)
  all[s.name] = await measureScreen({ ...s, viewports })
}

await browser.close()

writeFileSync(`${OUT}/new-inbox-measurements.json`, JSON.stringify(all, null, 2))
writeFileSync(`${OUT}/new-inbox-write-log.json`, JSON.stringify({ writeAttempts, writeLog }, null, 2))
console.log('DONE. writeAttempts =', writeAttempts)
