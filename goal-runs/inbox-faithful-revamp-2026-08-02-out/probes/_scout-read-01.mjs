// _scout-read-01.mjs — READABILITY scout for inbox-faithful-revamp-2026-08-02.
// Read-only capture: screenshots + runtime audits (line length, truncation,
// token misuse, contrast) across every v2c job, at 1440x900 and 1024x768,
// dark theme, peer open and peer closed. Untracked, scratch.
import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

const PORT = 5431
const base = `http://localhost:${PORT}/`
const sessionPath = new URL('../.session.json', import.meta.url)
if (!existsSync(sessionPath)) { console.error('NO SESSION FILE — abort'); process.exit(1) }
const session = readFileSync(sessionPath, 'utf8')
const sessionObj = JSON.parse(session)
if (sessionObj.expires_at * 1000 < Date.now()) { console.error('SESSION EXPIRED — abort'); process.exit(1) }

const OUT_DIR = new URL('../goal-runs/../../ivan-inbox-goalrun-out/', import.meta.url) // placeholder unused
const SHOT_DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'
mkdirSync(SHOT_DIR, { recursive: true })

const VIEWPORTS = [
  { w: 1440, h: 900, tag: '1440' },
  { w: 1024, h: 768, tag: '1024' },
]

const JOBS = ['today', 'inbox', 'drafts', 'content', 'sends', 'ops', 'settings']

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`))
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  return { ctx, page, errors }
}

async function settle(page, maxMs = 15000) {
  const start = Date.now()
  let prev = null
  while (Date.now() - start < maxMs) {
    const skeletons = await page.evaluate(() => {
      const hasSk = document.querySelectorAll('.sk, .sk-line, .sk-av').length
      const bodyText = document.body.innerText || ''
      const hasLoadingWord = /\bLoading\b/.test(bodyText)
      return { hasSk, hasLoadingWord, textLen: bodyText.length }
    })
    if (skeletons.hasSk === 0 && !skeletons.hasLoadingWord) {
      const t1 = await page.evaluate(() => document.body.innerText)
      await page.waitForTimeout(500)
      const t2 = await page.evaluate(() => document.body.innerText)
      if (t1 === t2) {
        await page.waitForTimeout(500)
        const t3 = await page.evaluate(() => document.body.innerText)
        if (t2 === t3) return true
      }
    }
    await page.waitForTimeout(400)
  }
  return false
}

// ---- in-page audit ----
const AUDIT_FN = () => {
  function vis(el) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false
    return true
  }
  function classPath(el) {
    const parts = []
    let cur = el
    let depth = 0
    while (cur && cur !== document.body && depth < 6) {
      const cls = (cur.className && typeof cur.className === 'string')
        ? '.' + cur.className.trim().split(/\s+/).slice(0, 3).join('.')
        : ''
      parts.unshift(cur.tagName.toLowerCase() + cls)
      cur = cur.parentElement
      depth++
    }
    return parts.join(' > ')
  }
  function effectiveBg(el) {
    // Collect every non-transparent background layer from EL up to the root,
    // then composite them in real paint order (outermost ancestor first, each
    // closer layer painted OVER the running result) so a translucent overlay
    // (e.g. rgba(255,69,58,.08) on .ct-alert) is resolved against what is
    // actually behind it, not treated as if it were opaque.
    const layers = []
    let cur = el
    while (cur) {
      const s = getComputedStyle(cur)
      const bg = s.backgroundColor
      const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
      if (m) {
        const a = m[4] !== undefined ? parseFloat(m[4]) : 1
        if (a > 0.02) layers.push({ r: +m[1], g: +m[2], b: +m[3], a })
      }
      cur = cur.parentElement
    }
    layers.reverse() // outermost first
    let acc = { r: 9, g: 11, b: 10 } // fallback: --canvas, in case nothing opaque is ever found
    for (const l of layers) {
      acc = { r: l.r * l.a + acc.r * (1 - l.a), g: l.g * l.a + acc.g * (1 - l.a), b: l.b * l.a + acc.b * (1 - l.a) }
    }
    return { r: acc.r, g: acc.g, b: acc.b, a: 1 }
  }
  function parseColor(str) {
    const m = str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (!m) return { r: 0, g: 0, b: 0, a: 1 }
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 }
  }
  function composite(fg, bg) {
    // fg over bg, both {r,g,b,a}
    const a = fg.a
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
    }
  }
  function luminance({ r, g, b }) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  function contrast(c1, c2) {
    const l1 = luminance(c1) + 0.05
    const l2 = luminance(c2) + 0.05
    return l1 > l2 ? l1 / l2 : l2 / l1
  }

  const root = document.querySelector('.wb') || document.body
  const all = [...root.querySelectorAll('*')]
  const leaves = all.filter((el) => {
    if (el.children.length > 0) return false
    const t = (el.textContent ?? '').trim()
    if (!t) return false
    return vis(el)
  })

  const lineLenFindings = []
  const truncFindings = []
  const tokenFindings = []
  const contrastFindings = []
  const sizesSeen = new Set()

  for (const el of leaves) {
    const s = getComputedStyle(el)
    const fs = parseFloat(s.fontSize)
    sizesSeen.add(fs)
    const rect = el.getBoundingClientRect()
    const text = (el.textContent ?? '').trim()
    const cls = classPath(el)

    // ---- truncation sweep ----
    const overflowHidden = s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis'
    if (overflowHidden && el.scrollWidth > el.clientWidth + 1) {
      truncFindings.push({
        cls, text: text.slice(0, 80), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
        fontSize: fs, ellipsis: s.textOverflow === 'ellipsis',
      })
    }
    // also check ancestor chain up to 4 levels for clipped ancestor with this as the overflowing content
    let anc = el.parentElement
    let hops = 0
    while (anc && anc !== root && hops < 4) {
      const as = getComputedStyle(anc)
      if ((as.overflow === 'hidden' || as.overflowX === 'hidden') && anc.scrollWidth > anc.clientWidth + 1) {
        truncFindings.push({
          cls: classPath(anc) + ' (ancestor of "' + text.slice(0, 40) + '")',
          text: (anc.textContent ?? '').trim().slice(0, 80),
          scrollWidth: anc.scrollWidth, clientWidth: anc.clientWidth,
          fontSize: parseFloat(as.fontSize), ellipsis: as.textOverflow === 'ellipsis',
        })
        break
      }
      anc = anc.parentElement
      hops++
    }

    // ---- line length (chars/line) ----
    if (s.whiteSpace !== 'nowrap' && text.length > 40) {
      // El is a "leaf" (no element children), but React commonly splits
      // interpolated JSX ({count} then a string literal) into MULTIPLE
      // adjacent text-node children of the same element. Selecting only
      // el.firstChild undercounts wrapped lines badly (the first node is
      // often a short number). Select the WHOLE element's contents instead —
      // safe here because a leaf by definition has no nested elements.
      let lines = 1
      try {
        const range = document.createRange()
        range.selectNodeContents(el)
        lines = range.getClientRects().length || 1
      } catch { /* noop */ }
      const charsPerLine = lines > 0 ? text.length / lines : text.length
      if (charsPerLine > 90) {
        lineLenFindings.push({
          cls, sample: text.slice(0, 100), textLen: text.length, lines,
          charsPerLine: +charsPerLine.toFixed(1), widthPx: +rect.width.toFixed(0), fontSize: fs,
        })
      }
    }

    // ---- token misuse: text3/text4 as body ----
    const fg = parseColor(s.color)
    const isText3 = Math.abs(fg.r - 127) <= 3 && Math.abs(fg.g - 133) <= 3 && Math.abs(fg.b - 130) <= 3
    const isText4 = Math.abs(fg.r - 111) <= 3 && Math.abs(fg.g - 116) <= 3 && Math.abs(fg.b - 114) <= 3
    if (isText3 || isText4) {
      const bg = effectiveBg(el)
      const bgHex = `#${Math.round(bg.r).toString(16).padStart(2, '0')}${Math.round(bg.g).toString(16).padStart(2, '0')}${Math.round(bg.b).toString(16).padStart(2, '0')}`
      let linesCount = 1
      try {
        const range = document.createRange()
        range.selectNodeContents(el)
        linesCount = range.getClientRects().length || 1
      } catch { /* noop */ }
      const looksLikeBody = fs >= 13 && (linesCount > 1 || text.length > 60)
      const onSurface3 = bgHex.toLowerCase() === '#212523'
      if (isText3 && looksLikeBody && onSurface3) {
        tokenFindings.push({
          cls, token: 'text3', sample: text.slice(0, 90), fontSize: fs, lines: linesCount,
          textLen: text.length, bg: bgHex,
        })
      }
      if (isText4 && (fs >= 13 || text.length > 20) && !cls.includes('ct-tm') && !cls.includes('.wb-meta')) {
        // text4 is metadata/disabled ONLY — flag anything beyond a short meta stamp
        const looksBeyondMeta = text.length > 40 || linesCount > 1
        if (looksBeyondMeta) {
          tokenFindings.push({
            cls, token: 'text4', sample: text.slice(0, 90), fontSize: fs, lines: linesCount,
            textLen: text.length, bg: bgHex,
          })
        }
      }
    }

    // ---- contrast walk (Content + Today only, gated by caller) ----
    if (window.__scoutContrastGate) {
      const bg = effectiveBg(el)
      const fgOpaque = fg.a < 1 ? composite(fg, bg) : fg
      const c = contrast(fgOpaque, bg)
      const bar = fs >= 13 ? 4.5 : 4.5 // body bar; treat all text leaves at body bar per D11, flag <3 separately
      if (c < 4.5) {
        contrastFindings.push({
          cls, sample: text.slice(0, 60), fontSize: fs, contrast: +c.toFixed(2),
          fg: s.color, bgHex: `#${Math.round(bg.r).toString(16).padStart(2, '0')}${Math.round(bg.g).toString(16).padStart(2, '0')}${Math.round(bg.b).toString(16).padStart(2, '0')}`,
          under3: c < 3,
        })
      }
    }
  }

  return {
    leafCount: leaves.length,
    sizesSeen: [...sizesSeen].sort((a, b) => a - b),
    lineLenFindings, truncFindings, tokenFindings, contrastFindings,
  }
}

async function closePeers(page) {
  const xs = await page.$$('.wb-pane-x')
  for (const x of xs) {
    try { await x.click({ timeout: 2000 }) } catch { /* noop */ }
    await page.waitForTimeout(200)
  }
}

async function openFirstContentCard(page) {
  try {
    // Click the TITLE text specifically, never the row at large — the row also
    // hosts SKIP/APPROVE controls in its trailing slot and a coordinate click
    // can land on one of those instead of opening the draft peer.
    await page.click('.ct-card .ct-title', { timeout: 4000 })
    await page.waitForTimeout(800)
    // Defensive: dismiss any confirm sheet that opened by mistake.
    const cancel = await page.$('.sheet-btn, .wb-modelmenu, button:has-text("Cancel")')
    if (cancel) { try { await cancel.click({ timeout: 1000 }) } catch { /* noop */ } }
    return true
  } catch { return false }
}

const results = []
const browser = await chromium.launch()

for (const { w, h, tag } of VIEWPORTS) {
  for (const job of JOBS) {
    // ---- peer OPEN (default: chat docked on desktop/wide) ----
    {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/v2/${job}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch((e) => errors.push(`goto: ${e}`))
      const ok = await settle(page)
      page.evaluate(() => { window.__scoutContrastGate = false }).catch(() => {})
      const gate = job === 'content' || job === 'today'
      await page.evaluate((g) => { window.__scoutContrastGate = g }, gate)
      const shotPath = `${SHOT_DIR}/read-${job}-${tag}-peeropen.png`
      await page.screenshot({ path: shotPath, fullPage: false }).catch((e) => errors.push(`shot: ${e}`))
      const audit = await page.evaluate(AUDIT_FN).catch((e) => ({ error: String(e) }))
      results.push({ job, viewport: tag, state: 'peer-open', settled: ok, errors, shot: shotPath, audit })
      console.log(`${job}@${tag} peer-open: settled=${ok} leaves=${audit.leafCount} lineLen=${audit.lineLenFindings?.length} trunc=${audit.truncFindings?.length} token=${audit.tokenFindings?.length} contrast=${audit.contrastFindings?.length}`)
      await ctx.close()
    }
    // ---- peer CLOSED (close via .wb-pane-x) ----
    {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/v2/${job}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch((e) => errors.push(`goto: ${e}`))
      await settle(page)
      await closePeers(page)
      await page.waitForTimeout(500)
      const ok = await settle(page)
      const gate = job === 'content' || job === 'today'
      await page.evaluate((g) => { window.__scoutContrastGate = g }, gate)
      const shotPath = `${SHOT_DIR}/read-${job}-${tag}-peerclosed.png`
      await page.screenshot({ path: shotPath, fullPage: false }).catch((e) => errors.push(`shot: ${e}`))
      const audit = await page.evaluate(AUDIT_FN).catch((e) => ({ error: String(e) }))
      results.push({ job, viewport: tag, state: 'peer-closed', settled: ok, errors, shot: shotPath, audit })
      console.log(`${job}@${tag} peer-closed: settled=${ok} leaves=${audit.leafCount} lineLen=${audit.lineLenFindings?.length} trunc=${audit.truncFindings?.length} token=${audit.tokenFindings?.length} contrast=${audit.contrastFindings?.length}`)
      await ctx.close()
    }
    // ---- CONTENT only: draft peer open (peer chat + draft, or draft solo) ----
    if (job === 'content') {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/v2/content`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch((e) => errors.push(`goto: ${e}`))
      await settle(page)
      const opened = await openFirstContentCard(page)
      await page.waitForTimeout(500)
      const ok = await settle(page)
      await page.evaluate(() => { window.__scoutContrastGate = true })
      const shotPath = `${SHOT_DIR}/read-content-${tag}-draftpeer.png`
      await page.screenshot({ path: shotPath, fullPage: false }).catch((e) => errors.push(`shot: ${e}`))
      const audit = await page.evaluate(AUDIT_FN).catch((e) => ({ error: String(e) }))
      results.push({ job: 'content', viewport: tag, state: 'draft-peer', settled: ok, opened, errors, shot: shotPath, audit })
      console.log(`content@${tag} draft-peer: opened=${opened} settled=${ok} leaves=${audit.leafCount} lineLen=${audit.lineLenFindings?.length} trunc=${audit.truncFindings?.length} token=${audit.tokenFindings?.length} contrast=${audit.contrastFindings?.length}`)
      await ctx.close()
    }
  }
}

await browser.close()

const outJson = `${SHOT_DIR}/../phase0-readability-raw.json`
writeFileSync(outJson, JSON.stringify(results, null, 2))
console.log(`\nwrote ${results.length} states -> ${outJson}`)
