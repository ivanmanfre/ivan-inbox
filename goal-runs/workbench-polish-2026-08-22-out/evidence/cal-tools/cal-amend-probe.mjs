// THE AMENDMENT PROBE. The blind panel's three defects, in numbers.
//
// Measures, per viewport x theme: chip height, cell height, ratio, HOW MANY
// CHIP TITLES ARE ELLIPSED out of how many chips, the empty-cell and
// occupied-cell computed backgrounds and the luminance step between them, the
// header metric strings, and the vertical room left under the grid.
//
// Write interceptor installed BEFORE every navigation, per the standard
// pattern, extended to catch write RPCs which the standard pattern lets
// through. Attempted writes are counted and printed; it must read 0.
//
// Usage: node cal-amend-probe.mjs <baseUrl> <outFile> [label]
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://127.0.0.1:4191/'
const OUTFILE = process.argv[3] || '/tmp/cal-amend.json'
const LABEL = process.argv[4] || 'before'
const WRITE_RPC = ['operator_', 'dashboard_action', 'n8nclaw_', 'append_agent_log']
const attempted = []
const unauthorized = []

const MEASURE = () => {
  const px = n => Math.round(n * 10) / 10
  const lum = c => {
    const m = c.match(/\d+(\.\d+)?/g) || []
    const [r, g, b] = m.slice(0, 3).map(v => { const s = +v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const vis = el => el && getComputedStyle(el).display !== 'none'
  const chips = [...document.querySelectorAll('.cal-chip')].filter(vis)
  // ELLIPSED = the title's own text box overflows its own line box, on either
  // axis, which is what puts the "..." there. scrollWidth vs clientWidth for a
  // nowrap line; scrollHeight vs clientHeight for a -webkit-line-clamp.
  const titles = chips.map(c => c.querySelector('.cal-chip-n')).filter(Boolean)
  const ellipsed = titles.filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1)
  const occupied = [...document.querySelectorAll('.cal-day')].find(d => d.querySelector('.cal-chip') && !d.classList.contains('cal-day-out'))
  const empty = [...document.querySelectorAll('.cal-day.cal-day-empty')].find(d => !d.classList.contains('cal-day-out'))
  const chip = chips[0]
  const cr = occupied?.getBoundingClientRect()
  const chr = chip?.getBoundingClientRect()
  const grid = document.querySelector('.cal-grid')
  const gr = grid?.getBoundingClientRect()
  const body = document.querySelector('.cal-body')
  const br = body?.getBoundingClientRect()
  const cs = el => el ? getComputedStyle(el) : null
  // A cell's PAINTED background: an empty cell may be transparent, in which
  // case what the eye reads is whatever is behind it, so walk up until a
  // non-transparent fill is found and report BOTH.
  const painted = el => {
    let n = el
    while (n) {
      const bg = getComputedStyle(n).backgroundColor
      if (bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg)) return bg
      n = n.parentElement
    }
    return 'rgba(0, 0, 0, 0)'
  }
  const weekHs = [...document.querySelectorAll('.cal-week')].map(w => px(w.getBoundingClientRect().height))
  const bar = document.querySelector('.cal-bar')
  const counts = [...document.querySelectorAll('.cal-count')].map(c => c.textContent.trim())
  const emptyOwn = empty ? cs(empty).backgroundColor : null
  const occOwn = occupied ? cs(occupied).backgroundColor : null
  const emptyPaint = empty ? painted(empty) : null
  const occPaint = occupied ? painted(occupied) : null
  return {
    chips: chips.length,
    titles: titles.length,
    ellipsedTitles: ellipsed.length,
    ellipsedList: ellipsed.slice(0, 4).map(t => t.textContent.slice(0, 34)),
    // 🔴 "ELLIPSED" ALONE DOES NOT SETTLE THIS, and saying so is the point. A
    // 108px chip cannot hold a 60-character title on any number of lines, so
    // the pre-run state the panel PREFERRED also ellipsed every one of them
    // ("You can / rewrite yo..."). What the panel actually compared was how
    // much of the title survived. So this measures that directly: the longest
    // prefix of the real title that still fits inside the real box, found by
    // binary search on a clone of the node with the clamp lifted.
    titleLines: titles[0] ? Math.round(titles[0].clientHeight / parseFloat(cs(titles[0]).lineHeight)) : null,
    visibleChars: (() => {
      const probe = t => {
        const box = t.getBoundingClientRect()
        const full = t.textContent || ''
        const c = t.cloneNode(true)
        const st = getComputedStyle(t)
        c.style.cssText = ''
        for (const k of ['fontSize','fontFamily','fontWeight','lineHeight','letterSpacing','wordSpacing','overflowWrap','whiteSpace','textTransform'])
          c.style[k] = st[k]
        c.style.position = 'absolute'; c.style.visibility = 'hidden'
        c.style.width = box.width + 'px'
        c.style.display = 'block'; c.style.webkitLineClamp = 'unset'; c.style.overflow = 'visible'
        document.body.appendChild(c)
        // 🔴 BOTH AXES, and the first cut of this got it wrong in a way that
        // read as a pass. The one-line chip is `white-space:nowrap`, so its
        // clone never overflows VERTICALLY at any length, and a height-only
        // test reported all 703 characters as visible on the exact build whose
        // 13 titles all ended in an ellipsis. The single line overflows
        // sideways; the two-line clamp overflows downward.
        const capH = t.clientHeight + 1
        const capW = box.width + 1
        const fits = () => c.scrollHeight <= capH && c.scrollWidth <= capW
        let lo = 0, hi = full.length
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2)
          c.textContent = full.slice(0, mid)
          if (fits()) lo = mid; else hi = mid - 1
        }
        c.remove()
        return { fits: lo, total: full.length }
      }
      const r = titles.map(probe)
      const shown = r.map(x => Math.min(x.fits, x.total)).sort((a, b) => a - b)
      return {
        medianShown: shown.length ? shown[Math.floor(shown.length / 2)] : null,
        totalShown: r.reduce((a, x) => a + Math.min(x.fits, x.total), 0),
        totalChars: r.reduce((a, x) => a + x.total, 0),
        fullyVisible: r.filter(x => x.fits >= x.total).length,
      }
    })(),
    chipH: chr ? px(chr.height) : null,
    chipW: chr ? px(chr.width) : null,
    cellH: cr ? px(cr.height) : null,
    ratioPct: chr && cr ? Math.round((chr.height / cr.height) * 100) : null,
    titleLineHeight: titles[0] ? cs(titles[0]).lineHeight : null,
    titleFontSize: titles[0] ? cs(titles[0]).fontSize : null,
    titleClamp: titles[0] ? cs(titles[0]).webkitLineClamp : null,
    titleClientH: titles[0] ? titles[0].clientHeight : null,
    emptyCellBgOwn: emptyOwn,
    emptyCellBgPainted: emptyPaint,
    occupiedCellBgOwn: occOwn,
    occupiedCellBgPainted: occPaint,
    figureGroundStep: emptyPaint && occPaint ? Math.round(Math.abs(lum(occPaint) - lum(emptyPaint)) * 10000) / 10000 : null,
    // the plain 0-255 gap the panel talked about ("8 points apart")
    figureGroundPoints: emptyPaint && occPaint
      ? Math.abs((+(occPaint.match(/\d+/g) || [0])[0]) - (+(emptyPaint.match(/\d+/g) || [0])[0])) : null,
    headerCounts: counts,
    headerText: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null,
    gridBottom: gr ? px(gr.bottom) : null,
    gridTop: gr ? px(gr.top) : null,
    gridH: gr ? px(gr.height) : null,
    bodyH: br ? px(br.height) : null,
    bodyBottom: br ? px(br.bottom) : null,
    viewportH: innerHeight,
    roomBelowGrid: gr ? px(innerHeight - gr.bottom) : null,
    weekHeights: weekHs,
    weeks: weekHs.length,
    // Is the last week guillotined? Y's defect, which we must not import.
    lastWeekFullyVisible: (() => {
      const ws = [...document.querySelectorAll('.cal-week')]
      const last = ws[ws.length - 1]
      return last ? last.getBoundingClientRect().bottom <= innerHeight + 1 : null
    })(),
    anyCellScrolls: [...document.querySelectorAll('.cal-day')].filter(d => d.scrollHeight > d.clientHeight + 2).length,
    cellTokens: {
      cellH: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--cal-cell-h').trim(),
      chipH: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--cal-chip-h').trim(),
    },
  }
}

async function measure(browser, { width, height, theme }) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  await ctx.addInitScript(([t]) => localStorage.setItem('inbox-theme', t), [theme])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method(), url = q.url()
    if (url.includes('/rpc/') && m === 'POST') {
      const name = url.split('/rpc/')[1].split('?')[0]
      if (WRITE_RPC.some(p => name.startsWith(p))) {
        attempted.push({ kind: 'rpc', name })
        return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return r.continue()
    }
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      attempted.push({ kind: m, url: url.slice(0, 160) })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  page.on('response', x => { if (x.status() === 401) unauthorized.push(x.url()) })
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1600)
  const out = await page.evaluate(MEASURE)
  await ctx.close()
  return out
}

const browser = await chromium.launch()
const cases = [
  { width: 1440, height: 900, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
  { width: 390, height: 844, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' },
]
const result = { label: LABEL, base: BASE, at: new Date().toISOString(), cases: {} }
for (const c of cases) {
  result.cases[`${c.width}x${c.height}-${c.theme}`] = await measure(browser, c)
}
result.attemptedWrites = attempted.length
result.attemptedDetail = attempted
result.unauthorized = unauthorized
await browser.close()
mkdirSync(dirname(OUTFILE), { recursive: true })
writeFileSync(OUTFILE, JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
