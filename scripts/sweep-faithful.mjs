// sweep-faithful.mjs — capture + self-instrument for candidate `faithful`.
//
// Wait logic is the reference implementation from exp/brain-2b-instrument's
// sweep-instrument.mjs, unchanged in substance: domcontentloaded, then skeletons
// cleared, then the rail stamp is not 'not loaded', then a terminal render.
// NEVER networkidle — this app holds an open realtime WebSocket and can never
// satisfy it, so every goto burns its timeout and screenshots a skeleton.
//
// Usage: node scripts/sweep-faithful.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:5431/'
mkdirSync(outDir, { recursive: true })

const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null
if (!session) console.warn('!! NO .session.json — the anon key returns HTTP 200 with ZERO rows, so every capture below is a lie')

const M = { w: 390, h: 844, tag: 'mobile' }
const D = { w: 1440, h: 900, tag: 'desktop' }
const click = (sel) => ({ kind: 'click', sel })
const wait = (ms) => ({ kind: 'wait', ms })

const SHOTS = [
  { name: 'content', hash: '#exp/v2/content', at: [M, D] },
  { name: 'content-mattan', hash: '#exp/v2/content', at: [M, D],
    steps: [click('.chips .chip:nth-child(2)'), wait(2600)] },
  // Today's zones 01-03 bind to the get-morning-brief edge function, which is
  // slower than every table read in the app; 2.6s of settle screenshots
  // "Loading the brief…", which is a failed capture, not a design verdict.
  { name: 'today', hash: '#exp/v2/today', at: [M, D], settle: 9000 },
  { name: 'sends', hash: '#exp/v2/sends', at: [M, D] },
  // The Log is phase0 surface #8 and is behind the view switcher, so it needs
  // its own steps or it is never captured at all. `.seg .sg:nth-child(3)` is the
  // Log segment (SendsScreen.tsx:292).
  { name: 'sends-log', hash: '#exp/v2/sends', at: [M, D],
    steps: [click('.seg .sg:nth-child(3)'), wait(3200)] },
  { name: 'sends-lanes', hash: '#exp/v2/sends', at: [D],
    steps: [click('.seg .sg:nth-child(2)'), wait(2400)] },
  { name: 'sends-log-triad', hash: '#exp/v2/sends', at: [D], query: 'cat=triad',
    steps: [click('.seg .sg:nth-child(3)'), wait(3200)] },
  { name: 'sends-triad', hash: '#exp/v2/sends', at: [D], query: 'cat=triad' },
  { name: 'content-triad', hash: '#exp/v2/content', at: [D], query: 'cat=triad' },
  { name: 'inbox', hash: '#exp/v2/inbox', at: [M, D] },
  { name: 'ops', hash: '#exp/v2/ops', at: [M, D] },
  { name: 'drafts', hash: '#exp/v2/drafts', at: [M, D] },
  { name: 'settings', hash: '#exp/v2/settings', at: [M, D] },
  // `.ct-card` alone resolves to whichever card is first in the DOM, which
  // after the alert strip learned to collapse is an IDEA, not a draft — the
  // shot was quietly capturing the wrong peer. Pin it to a pipeline row.
  { name: 'draft-pane', hash: '#exp/v2/content', at: [D],
    steps: [click('.ct-card:not(.ct-idea)'), wait(1200)] },
  { name: 'thread-pane', hash: '#exp/v2/inbox', at: [D], steps: [click('.rows .r'), wait(900)] },
  { name: 'content-light', hash: '#exp/v2/content', at: [D], theme: 'light' },
  { name: 'sends-light', hash: '#exp/v2/sends', at: [D], theme: 'light' },
]

// ---- the spine §14 self-instruments, run against the RENDERED page ----
const MEASURE = function () {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const root = document.querySelector('.wb')
  if (!root) return { noWb: true }
  const all = [...root.querySelectorAll('*')].filter(vis)
  const leaves = all.filter((el) => el.children.length === 0 && (el.textContent ?? '').trim())
  const words = (el) => (el.textContent ?? '').trim()
  const hasWord = (el) => /[a-z0-9]/i.test(words(el))

  // 2.2 — type census over text leaves: ≤9 distinct sizes, zero fractional.
  const sizes = {}
  const glyphSizes = {}
  for (const el of leaves) {
    const fs = getComputedStyle(el).fontSize
    const bucket = hasWord(el) ? sizes : glyphSizes
    bucket[fs] = (bucket[fs] ?? 0) + 1
  }
  const distinct = Object.keys(sizes)
  const fractional = distinct.filter((s) => !Number.isInteger(parseFloat(s)))

  // 2.4 — ≤1 element at weight ≥700 and it is ≥28px.
  const heavy = all.filter((el) => {
    const s = getComputedStyle(el)
    return parseInt(s.fontWeight, 10) >= 700 && (el.textContent ?? '').trim() && el.children.length === 0
  }).map((el) => ({
    cls: el.className?.toString().slice(0, 40),
    px: parseFloat(getComputedStyle(el).fontSize),
    text: words(el).slice(0, 24),
  }))

  // 2.6 — tabular-nums everywhere a numeral appears.
  const nonTabular = leaves
    .filter((el) => /\d/.test(words(el)))
    .filter((el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'))
    .map((el) => `${el.className?.toString().slice(0, 30)}: ${words(el).slice(0, 20)}`)

  // 5.6 — accent census against the RENDERED page, never a source grep.
  const ACC = '16, 163, 127'
  const accent = all.filter((el) => {
    const s = getComputedStyle(el)
    return [s.color, s.backgroundColor, s.borderTopColor, s.borderLeftColor,
      s.backgroundImage, s.boxShadow, s.outlineColor]
      .some((v) => v && v.includes(ACC))
  })

  // 6.4 — pill licence: computed radius ≥100px only on the §6.3 list.
  const LICENSED = ['av', 'avatar-me', 'sk-av', 'badge', 'wb-pane-ic', 'sc-refresh', 'csend',
    'spark', 'dt-empty-ic', 'wb-mic', 'wb-hf-orb', 'ct-anchor-av', 'chip', 'wb-ws', 'sg',
    'ct-f', 'wb-fpill', 'wb-rj-n', 'cnt', 'wb-fab', 'sc-dot', 'udot', 'wb-sech-dot',
    'wb-sync-dot', 'wb-peer-dot', 'wb-ok-dot', 'wb-failed-dot', 'wb-tb-live', 'wb-th-dot',
    'wb-vs-dot', 'wb-live', 'wb-ofresh-d', 'wb-tdot', 'wb-lad-dot', 'empty-dot', 'ops-fail-d',
    'wb-pipe-d', 'td-zmark', 'wb-legend-d', 'ct-anchor-dot', 'ov-gauge', 'ov-gauge-fill',
    'ov-bar', 'ov-bar-fill', 'td-stack', 'td-bar', 'td-bar-f', 'wb-stack', 'wb-qa-g',
    'wb-qa-fill', 'ct-mix-b', 'wb-tbar', 'sc-bar', 'wb-cap', 'wb-cap-t', 'wb-cap-0',
    'td-lg-d', 'wb-stack-seg', 'ov-gauge-tick', 'ov-gauge-over', 'sk']
  const pills = all.filter((el) => {
    const r = getComputedStyle(el).borderRadius
    return /(\d{3,})px/.test(r) || r.includes('50%')
  })
  const illegalPills = pills.filter((el) => {
    const cls = (el.className?.toString() ?? '').split(/\s+/)
    return !cls.some((c) => LICENSED.includes(c))
  }).map((el) => `${el.tagName}.${el.className?.toString().slice(0, 44)}`)

  // 7.1 — the RAIL TEST. x of every row's primary text, per list.
  const railOf = (rowSel, primarySel) => {
    const rows = [...document.querySelectorAll(rowSel)].filter(vis)
    const xs = rows.map((r) => {
      const p = r.querySelector(primarySel)
      return p ? Math.round(p.getBoundingClientRect().left) : null
    }).filter((x) => x !== null)
    if (xs.length === 0) return null
    return { n: xs.length, min: Math.min(...xs), max: Math.max(...xs), variance: Math.max(...xs) - Math.min(...xs) }
  }
  // 7.8 — density band, measured content-box heights.
  const bandOf = (sel) => {
    const rows = [...document.querySelectorAll(sel)].filter(vis)
    if (rows.length === 0) return null
    const hs = rows.map((r) => {
      const s = getComputedStyle(r)
      return Math.round(r.getBoundingClientRect().height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom))
    })
    return { n: hs.length, min: Math.min(...hs), max: Math.max(...hs), median: hs.sort((a, b) => a - b)[Math.floor(hs.length / 2)] }
  }
  // trailing right edges share one x
  const tailRail = (() => {
    const t = [...document.querySelectorAll('.ct-card .ct-tm')].filter(vis)
    if (t.length === 0) return null
    const xs = t.map((e) => Math.round(e.getBoundingClientRect().right))
    return { n: xs.length, variance: Math.max(...xs) - Math.min(...xs) }
  })()

  // 10.4 — motion deleted from the 50x/day paths.
  const livePaths = [...document.querySelectorAll('.wb-rj, .seg .sg, .wb-ws, .wb-peer, .wb-work')]
    .filter(vis)
    .filter((el) => {
      const t = getComputedStyle(el).transitionProperty
      return t && t !== 'none' && t !== 'all' ? !/^background-color$/.test(t) : t === 'all'
    }).length

  // 3.2 — body contrast walk (dark theme), alpha-composited against the paint.
  const lum = (c) => {
    const m = c.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number)
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const bgOf = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const bc = getComputedStyle(n).backgroundColor
      const m = bc.match(/[\d.]+/g)
      if (m && (m.length < 4 || Number(m[3]) > 0.85)) return bc
      n = n.parentElement
    }
    return 'rgb(0,0,0)'
  }
  const bad = []
  for (const el of leaves) {
    if (!hasWord(el)) continue
    const s = getComputedStyle(el)
    const px = parseFloat(s.fontSize)
    const bold = parseInt(s.fontWeight, 10) >= 700
    const large = px >= 24 || (px >= 18.66 && bold)
    const l1 = lum(s.color); const l2 = lum(bgOf(el))
    if (l1 === null || l2 === null) continue
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    if (ratio < (large ? 3 : 4.5)) bad.push(`${el.className?.toString().slice(0, 26)} ${px}px ${ratio.toFixed(2)}:1 "${words(el).slice(0, 18)}"`)
  }

  const d = document.documentElement
  return {
    dataCat: d.getAttribute('data-cat'),
    bridgeBg: getComputedStyle(root).getPropertyValue('--bg').trim(),
    bridgeBlue: getComputedStyle(root).getPropertyValue('--blue').trim(),
    docOverflow: d.scrollWidth > d.clientWidth,
    innerTextLen: (document.body.innerText ?? '').length,
    loginVisible: !!document.body.textContent?.includes('Send me a code'),
    skeletons: document.querySelectorAll('.sk').length,
    type: { distinct: distinct.length, sizes, fractional, glyphSizes: Object.keys(glyphSizes) },
    heavy,
    nonTabular: nonTabular.slice(0, 6),
    accentCount: accent.length,
    accentBy: Object.entries(accent.reduce((a, el) => {
      const k = (el.className?.toString() ?? el.tagName).slice(0, 28) || el.tagName
      a[k] = (a[k] ?? 0) + 1; return a
    }, {})).sort((x, y) => y[1] - x[1]).slice(0, 8),
    illegalPills: [...new Set(illegalPills)].slice(0, 10),
    rails: {
      content: railOf('.ct-card', '.ct-row-p'),
      contentAll: railOf('.ct-card', '.ct-title'),
      ideas: railOf('.ct-card.ct-idea', '.ct-title'),
      contentStatus: railOf('.ct-card', '.ct-st'),
      inbox: railOf('.rows .r', '.name'),
      today: railOf('.td-r', '.td-nm'),
      sendsLog: railOf('.log-r', '.log-nm'),
    },
    tailRail,
    // The trailing timestamps on the log share one right edge or the column is
    // a coincidence, not a column (7.7).
    logTailRail: (() => {
      const t = [...document.querySelectorAll('.log-r .log-tm')].filter(vis)
      if (t.length === 0) return null
      const xs = t.map((e) => Math.round(e.getBoundingClientRect().right))
      return { n: xs.length, variance: Math.max(...xs) - Math.min(...xs) }
    })(),
    // 8.5 — the denominator line, read off the DOM. If this string does not
    // carry two totals well above the rendered counts, the log is charting a
    // window as if it were the population.
    logDenom: document.querySelector('.log-denom')?.innerText?.replace(/\s+/g, ' ').trim() ?? null,
    band: {
      // 7.8 measures a ROW. An idea card is a disclosure: `.ct-card.ct-idea`
      // is the row PLUS its opened body, and measuring the container reported
      // a 311px 'row' the moment one was expanded. The row is `.ct-idea-h`.
      content: bandOf('.ct-card:not(.ct-idea), .ct-idea-h'),
      inbox: bandOf('.rows .r'), today: bandOf('.td-r'),
      sendsLog: bandOf('.log-r'),
    },
    livePathTransitions: livePaths,
    contrastFailures: bad.slice(0, 8),
    contrastFailureCount: bad.length,
  }
}

const browser = await chromium.launch()
const report = []

for (const shot of SHOTS) {
  for (const vp of shot.at) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
    if (session) {
      await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
        ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
    }
    await page.addInitScript((t) => window.localStorage.setItem('inbox-theme', t), shot.theme ?? 'dark')
    const q = shot.query ? `?${shot.query}` : ''
    await page.goto(`${baseUrl}${q}${shot.hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch((e) => errors.push(`goto: ${String(e).slice(0, 120)}`))
    await page.waitForFunction(() => {
      if (document.querySelectorAll('.sk').length > 0) return false
      const stamp = document.querySelector('.wb-sync-t')
      if (stamp && stamp.textContent.trim() === 'not loaded') return false
      return document.querySelectorAll(
        '.wb .ct-card, .wb .rows .r, .wb .td-r, .wb .ov-tile, .wb .log-r,'
        + ' .wb .sw, .wb .wb-empty, .wb .wb-failed, .wb .wb-starter, .wb .qc',
      ).length > 0
    }, null, { timeout: 75000 }).catch(() => {})
    await page.waitForTimeout(shot.settle ?? 2600)
    for (const step of shot.steps ?? []) {
      try {
        if (step.kind === 'click') await page.locator(step.sel).first().click({ timeout: 6000 })
        else if (step.kind === 'wait') await page.waitForTimeout(step.ms)
      } catch (e) { errors.push(`MISSED ${step.sel}: ${String(e).slice(0, 60)}`) }
    }
    if (shot.steps) await page.waitForTimeout(700)
    // The LAST gate, and the one the skeleton check cannot cover: several
    // surfaces render a plain `Loading…` div with no .sk class at all
    // (SendsScreen.tsx:102 is one, TodayScreen's brief is another), so a shot
    // can clear every check above and still be a screenshot of the word
    // "Loading". Poll the literal string out. Still never networkidle — the
    // realtime WebSocket keeps that pending forever.
    const loadingGone = await page.waitForFunction(
      () => !/Loading/i.test(document.querySelector('.wb')?.innerText ?? ''),
      null, { timeout: 30000 },
    ).then(() => true).catch(() => false)
    if (!loadingGone) errors.push('STILL LOADING at screenshot time — this capture is not evidence')
    const m = await page.evaluate(MEASURE)
    const file = `${outDir}/${shot.name}-${vp.tag}.png`
    await page.screenshot({ path: file, fullPage: false })
    report.push({ shot: shot.name, tag: vp.tag, file, ...m, errors })
    console.log(
      `${shot.name}/${vp.tag} txt=${m.innerTextLen} sizes=${m.type?.distinct} frac=${m.type?.fractional?.length}`
      + ` heavy=${m.heavy?.length} accent=${m.accentCount} pills=${m.illegalPills?.length}`
      + ` rail=${m.rails?.content?.variance ?? '-'}/${m.rails?.inbox?.variance ?? '-'}`
      + ` band=${m.band?.content?.min ?? '-'}-${m.band?.content?.max ?? '-'}`
      + ` contrast=${m.contrastFailureCount} ovf=${m.docOverflow} err=${errors.length}`,
    )
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${outDir}/sweep.json`, JSON.stringify(report, null, 2))
console.log(`\n${report.length} shots -> ${outDir}/sweep.json`)
