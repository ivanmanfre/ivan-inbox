// sweep-v2.mjs — capture and MEASURE every workbench surface.
//
// Why this exists rather than plain sweep.mjs:
//  1. #exp/ is read at mount only, so inner surfaces need either a click script
//     or an addressable URL. v2c made them addressable (#exp/v2/<job>), so most
//     rows here are fresh loads; the ones that need a peer open (a thread, a
//     draft, two peers side by side) carry a click sequence.
//  2. This app scrolls INNER containers, so documentElement.scrollHeight is
//     pinned to the viewport. A three-region layout has three independent
//     scrollers, so density is measured PER REGION and the region is named in the
//     output. Measuring the document would report 852px for every surface.
//
// THE BROKER STAND-IN. inbox-claude's CORS is correctly scoped to the Pages origin
// (https://ivanmanfre.github.io) — a control the security audit required — so a
// localhost preview cannot reach it and the browser logs a CORS failure instead of
// the app's own state. Every shot therefore fulfils that ONE route with the exact
// bytes production returned for a real authenticated turn, captured by curl from
// the allowed origin on 2026-08-01: HTTP 502
// {"error":"upstream_error","detail":"status 401 {...Invalid or missing API key}"}.
// The app then renders the same `upstream_not_armed` state it will render in
// production, and the console-error gate measures the APP rather than the fence.
//
// Usage: node scripts/sweep-v2.mjs <outDir> [baseUrl]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'http://localhost:4188/'
mkdirSync(outDir, { recursive: true })

const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null

const M = { w: 390, h: 852, tag: 'mobile' }
const D = { w: 1440, h: 900, tag: 'desktop' }

// name, hash, [viewports], steps
const click = (sel, note) => ({ kind: 'click', sel, note })
const type = (sel, text) => ({ kind: 'type', sel, text })
const wait = (ms) => ({ kind: 'wait', ms })

const SHOTS = [
  // ---- the eight surfaces ----
  { name: 'today', hash: '#exp/v2/today', at: [M, D] },
  { name: 'inbox', hash: '#exp/v2/inbox', at: [M, D] },
  { name: 'drafts', hash: '#exp/v2/drafts', at: [M, D] },
  { name: 'content', hash: '#exp/v2/content', at: [M, D] },
  { name: 'sends', hash: '#exp/v2/sends', at: [M, D] },
  { name: 'ops', hash: '#exp/v2/ops', at: [M, D] },
  { name: 'settings', hash: '#exp/v2/settings', at: [M, D] },
  { name: 'chat', hash: '#exp/v2/inbox/chat', at: [M, D] },

  // ---- the pane-peer model, which is the candidate ----
  {
    name: 'thread', hash: '#exp/v2/inbox', at: [M, D],
    steps: [click('.rows .r', 'open the first thread')],
  },
  {
    name: 'peers-thread-chat', hash: '#exp/v2/inbox', at: [D],
    steps: [click('.rows .r', 'thread peer'), wait(500)],
  },
  {
    name: 'draft', hash: '#exp/v2/content', at: [M, D],
    steps: [click('.ct-card', 'open the first content draft')],
  },
  {
    name: 'peers-draft-chat', hash: '#exp/v2/content', at: [D],
    steps: [click('.ct-card', 'draft peer'), wait(400)],
  },
  {
    name: 'inbox-solo', hash: '#exp/v2/inbox', at: [D],
    steps: [click('.wb-rj-peer', 'undock Claude — the working list takes the whole canvas')],
  },
  {
    name: 'chat-about-mobile', hash: '#exp/v2/inbox', at: [M],
    steps: [click('.rows .r', 'thread'), wait(300), click('.wb-ask', 'ask Claude about it')],
  },

  // ---- chat behaviour ----
  // THE SHIPPING STATE. No chat flag, so this is the REAL transport against the
  // real broker (stubbed with production's own bytes, see BROKER_UNARMED): the
  // pane must name the unarmed container specifically and must NOT offer a Retry,
  // because retrying cannot set a key.
  {
    name: 'chat-unarmed', hash: '#exp/v2/inbox/chat', at: [M, D],
    steps: [click('.wb-starter', 'send a starter'), wait(2500)],
  },
  // Streaming and a landed turn need content to render, which the unarmed broker
  // cannot produce — so these two run on the named stub.
  {
    name: 'chat-streaming', hash: '#exp/v2/inbox/chat', at: [M, D],
    query: 'wbmock=chat:on',
    steps: [click('.wb-starter', 'send a starter'), wait(1400)],
    settle: 0,
  },
  {
    name: 'chat-done', hash: '#exp/v2/inbox/chat', at: [D],
    query: 'wbmock=chat:on',
    steps: [click('.wb-starter', 'send a starter'), wait(6000)],
  },
  {
    name: 'chat-error', hash: '#exp/v2/inbox/chat', at: [M, D],
    query: 'wbmock=chat:error-cold',
    steps: [click('.wb-starter', 'send'), wait(1200)],
  },
  {
    name: 'chat-error-mid', hash: '#exp/v2/inbox/chat', at: [D],
    query: 'wbmock=chat:error-mid',
    steps: [click('.wb-starter', 'send'), wait(2500)],
  },

  // ---- voice ----
  // Voice input is on-device webkitSpeechRecognition. Headless Chromium exposes the
  // constructor but cannot actually capture, so the WORKING states are captured
  // through the named mock driver. The unsupported case (Firefox, Safari with
  // dictation off) is verified separately by deleting the constructor before load
  // and asserting the affordance is ABSENT — crops/voice-noengine-*.png; a button
  // that cannot work is worse than no button, so this is a behaviour, not copy.
  {
    name: 'voice-listening', hash: '#exp/v2/inbox/chat', at: [M, D],
    query: 'wbmock=voice:on',
    steps: [click('.wb-mic', 'arm the mic'), wait(900)],
    settle: 0,
  },
  {
    name: 'voice-handsfree', hash: '#exp/v2/inbox/chat', at: [M, D],
    query: 'wbmock=voice:on',
    steps: [click('.wb-mic', 'arm'), wait(500), click('.wb-hf', 'hands-free')],
    settle: 0,
  },
  {
    name: 'voice-denied', hash: '#exp/v2/inbox/chat', at: [M, D],
    query: 'wbmock=voice:denied',
    steps: [click('.wb-mic', 'arm — permission refused'), wait(800)],
  },

  // ---- the third data state, which no healthy backend can produce ----
  { name: 'state-failed-inbox', hash: '#exp/v2/inbox', at: [M, D], query: 'wbmock=fetch-error' },
  { name: 'state-failed-ops', hash: '#exp/v2/ops', at: [M, D], query: 'wbmock=fetch-error' },
  { name: 'state-failed-content', hash: '#exp/v2/content', at: [M, D], query: 'wbmock=fetch-error' },
]

// Verbatim production response for an authenticated turn against the unarmed
// broker. Not invented: curl'd from the allowed origin, 2026-08-01T01:13Z.
const BROKER_UNARMED = JSON.stringify({
  error: 'upstream_error',
  detail: 'status 401 {"detail":"Invalid or missing API key"}',
})

// A browser logging the HTTP status of a fetch that the APP handled correctly is
// not an application error, and the console-error gate must not conflate them —
// the unarmed broker legitimately answers 502 and the UI legitimately renders a
// named state for it. Everything else counts.
const NOISE = [/Failed to load resource/i, /net::ERR_FAILED/i, /CORS policy/i]
const isNoise = (t) => NOISE.some((re) => re.test(t))

const MEASURE = function () {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const wordsOf = (el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
  const measureRegion = (root, name) => {
    const leaves = [...root.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
    const totalWords = leaves.reduce((n, el) => n + wordsOf(el), 0)
    const scrollers = [root, ...root.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 4)
      .map((el) => el.scrollHeight)
    const rootBox = root.getBoundingClientRect()
    const contentBottom = leaves.reduce((mx, el) => {
      const r = el.getBoundingClientRect()
      return Math.max(mx, r.bottom - rootBox.top + (root.scrollTop || 0))
    }, 0)
    const height = Math.max(root.scrollHeight, contentBottom, 0, ...scrollers)
    const proseWords = leaves.filter((el) => wordsOf(el) >= 12).reduce((n, el) => n + wordsOf(el), 0)
    const fs = (el) => parseFloat(getComputedStyle(el).fontSize) || 0
    const numeric = leaves.filter((el) => /^[\s$€£]*[\d.,]+\s*[%kKmM]?\s*$/.test((el.textContent ?? '').trim()))
    const encodings = [...root.querySelectorAll('*')].filter((el) => {
      if (!vis(el)) return false
      const tag = el.tagName.toLowerCase()
      if (tag === 'svg' || tag === 'canvas' || tag === 'img') return true
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hasBg = s.backgroundImage !== 'none' ||
        (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')
      const barLike = hasBg && r.height > 2 && r.height < 24 && r.width > 24 && !el.textContent?.trim()
      const dot = hasBg && r.width <= 14 && r.height <= 14 && r.width > 3 && !el.textContent?.trim()
      return barLike || dot
    }).length
    return {
      region: name,
      height: Math.round(height),
      totalWords,
      wordsPer1000px: height ? +(totalWords / (height / 1000)).toFixed(1) : 0,
      proseSharePct: totalWords ? +((proseWords / totalWords) * 100).toFixed(1) : 0,
      biggestNumberPx: +numeric.reduce((mx, el) => Math.max(mx, fs(el)), 0).toFixed(1),
      encodings,
      // Overflow inside a region is as real as document overflow: it is what
      // clips a pill.
      overflow: root.scrollWidth > root.clientWidth,
    }
  }
  const regions = []
  const work = document.querySelector('.wb-work')
  if (work) regions.push(measureRegion(work, 'work'))
  document.querySelectorAll('.wb-peer').forEach((el, i) => regions.push(measureRegion(el, `peer${i + 1}`)))
  const take = document.querySelector('.wb-take')
  if (take) regions.push(measureRegion(take, 'takeover'))
  if (regions.length === 0) regions.push(measureRegion(document.body, 'body'))
  const d = document.documentElement
  // A pill whose own text is visually cut: scrollWidth exceeds clientWidth on a
  // single-line nowrap-ish leaf. This is the .ov-over-lbl class of bug.
  // ...but text-overflow:ellipsis is DESIGNED truncation (the inbox row snippet
  // has always ellipsized), so only hard clipping counts — text-overflow:clip
  // with hidden overflow, which is what ate "103% of cap".
  const clipped = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .filter((el) => {
      const s = getComputedStyle(el)
      return s.textOverflow === 'clip' && s.overflowX !== 'auto' && s.overflowX !== 'scroll'
    })
    .map((el) => `${el.className || el.tagName}: ${(el.textContent ?? '').trim().slice(0, 40)}`)
  return {
    docOverflow: d.scrollWidth > d.clientWidth,
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    clipped: clipped.slice(0, 6),
    loginVisible: !!document.body.textContent?.includes('Send me a code'),
    regions,
  }
}

const browser = await chromium.launch()
const report = []

for (const shot of SHOTS) {
  for (const vp of shot.at) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()
    const errors = []
    const steps = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
    await page.route('**/functions/v1/inbox-claude', (r) => r.fulfill({
      status: 502,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: BROKER_UNARMED,
    }))
    if (session) {
      await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
        ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
    }
    const q = shot.query ? `?${shot.query}` : ''
    const url = `${baseUrl}${q}${shot.hash}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
      .catch((e) => errors.push(`goto: ${String(e).slice(0, 120)}`))
    await page.waitForTimeout(shot.settle ?? 2200)
    for (const step of shot.steps ?? []) {
      try {
        if (step.kind === 'click') await page.locator(step.sel).first().click({ timeout: 6000 })
        else if (step.kind === 'type') await page.locator(step.sel).first().fill(step.text)
        else if (step.kind === 'wait') await page.waitForTimeout(step.ms)
      } catch (e) {
        // A missing step target is a SCRIPT problem, not a console error — the
        // console-error gate must not be polluted by it.
        steps.push(`MISSED ${step.sel ?? step.ms}: ${String(e).slice(0, 70)}`)
      }
    }
    if (shot.steps) await page.waitForTimeout(shot.settle ?? 600)
    const m = await page.evaluate(MEASURE)
    const file = `${outDir}/${shot.name}-${vp.tag}.png`
    await page.screenshot({ path: file })
    const appErrors = errors.filter((e) => !isNoise(e))
    report.push({
      shot: shot.name, tag: vp.tag, width: vp.w, url, file, ...m,
      errors: appErrors, transportNoise: errors.filter(isNoise), missedSteps: steps,
    })
    const worst = m.regions.map((r) => `${r.region} ${r.height}px w/1k=${r.wordsPer1000px} enc=${r.encodings}`).join(' | ')
    console.log(
      `${shot.name}/${vp.tag} overflow=${m.docOverflow} clipped=${m.clipped.length} err=${appErrors.length}` +
      `${steps.length ? ` missed=${steps.length}` : ''} :: ${worst}`,
    )
    await ctx.close()
  }
}

await browser.close()
writeFileSync(`${outDir}/sweep.json`, JSON.stringify(report, null, 2))

const bad = report.filter((r) =>
  r.docOverflow || r.loginVisible || r.errors.length || r.clipped.length || r.missedSteps.length ||
  r.regions.some((g) => g.overflow || (g.totalWords > 100 && g.encodings < 1) || g.proseSharePct > 80))
console.log(`\n${report.length} shots → ${outDir}/sweep.json`)
if (bad.length) {
  for (const r of bad) {
    const why = []
    if (r.docOverflow) why.push('doc-overflow')
    if (r.loginVisible) why.push('login-leak')
    if (r.errors.length) why.push(`console:${r.errors.length}`)
    if (r.missedSteps.length) why.push(`missed-step:${r.missedSteps.length}`)
    if (r.clipped.length) why.push(`clipped:${r.clipped.length}`)
    for (const g of r.regions) {
      if (g.overflow) why.push(`${g.region}-overflow`)
      if (g.totalWords > 100 && g.encodings < 1) why.push(`${g.region}-no-encoding`)
      if (g.proseSharePct > 80) why.push(`${g.region}-prose:${g.proseSharePct}`)
    }
    console.log(`PROBLEM ${r.shot}/${r.tag} -> ${why.join(', ')}`)
    if (r.errors.length) console.log(`   console: ${r.errors.slice(0, 3).join('\n   ')}`)
    if (r.missedSteps.length) console.log(`   ${r.missedSteps.join('\n   ')}`)
    if (r.clipped.length) console.log(`   clipped: ${r.clipped.slice(0, 3).join(' / ')}`)
  }
} else {
  console.log('clean: no overflow, no clipped text, no console errors, every region encodes')
}
