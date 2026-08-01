// independent-measure.mjs — INDEPENDENT verification pass for goal-run
// inbox-v2-revamp-2026-08-01. Copies the measurement logic of density.mjs
// (unmodified) and drives navigation itself (URL routes where the candidate
// supports them, in-app clicks otherwise), because the #exp/ hash is read at
// mount only and this instrument must reach inner surfaces without trusting
// the candidate's own click/capture scripts.
//
// Usage: node scripts/independent-measure.mjs <candidate: v2a|v2c> <port>
import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const candidate = process.argv[2]
const port = process.argv[3]
const base = `http://localhost:${port}/`

const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null

const WIDTHS = [
  { w: 390, h: 852, tag: '390' },
  { w: 1440, h: 900, tag: '1440' },
]

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  if (session) {
    await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
      ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  }
  return { ctx, page, errors }
}

// Identical measurement block to scripts/density.mjs (copied, not imported,
// so this file has no dependency on either candidate's possibly-modified copy).
async function measure(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const leaves = [...document.querySelectorAll('body *')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
    const wordsOf = (el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
    const totalWords = leaves.reduce((n, el) => n + wordsOf(el), 0)
    const scrollers = [document.documentElement, ...document.querySelectorAll('body *')]
      .filter((el) => el.scrollHeight > el.clientHeight + 4)
      .map((el) => el.scrollHeight)
    const contentBottom = leaves.reduce((mx, el) => {
      const r = el.getBoundingClientRect()
      return Math.max(mx, r.bottom + (window.scrollY || 0))
    }, 0)
    const height = Math.max(document.documentElement.scrollHeight, contentBottom, ...scrollers)
    const proseWords = leaves
      .filter((el) => wordsOf(el) >= 12)
      .reduce((n, el) => n + wordsOf(el), 0)
    const fs = (el) => parseFloat(getComputedStyle(el).fontSize) || 0
    const numeric = leaves.filter((el) => /^[\s$€£]*[\d.,]+\s*[%kKmM]?\s*$/.test((el.textContent ?? '').trim()))
    const biggestNumberPx = numeric.reduce((mx, el) => Math.max(mx, fs(el)), 0)
    const numbersOver26 = numeric.filter((el) => fs(el) >= 26).length
    const encodings = [...document.querySelectorAll('body *')].filter((el) => {
      if (!vis(el)) return false
      const tag = el.tagName.toLowerCase()
      if (tag === 'svg' || tag === 'canvas' || tag === 'img') return true
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hasBg = s.backgroundImage !== 'none' ||
        (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')
      const isBarLike = hasBg && r.height > 2 && r.height < 24 && r.width > 24 && !el.textContent?.trim()
      const isDot = hasBg && r.width <= 14 && r.height <= 14 && r.width > 3 && !el.textContent?.trim()
      return isBarLike || isDot
    }).length
    return {
      height, totalWords, proseWords,
      wordsPer1000px: height ? +(totalWords / (height / 1000)).toFixed(1) : 0,
      proseSharePct: totalWords ? +((proseWords / totalWords) * 100).toFixed(1) : 0,
      biggestNumberPx: +biggestNumberPx.toFixed(1),
      numbersOver26, encodings,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
}

const results = []

async function capture(page, errors, label, width) {
  // TodayScreen's full brief payload runs an n8n REST round-trip inside the
  // edge function and is documented in useToday.ts as a ~12s call with no
  // cache warm on a fresh preview origin (localStorage is per-port). A short
  // wait catches it mid "Loading the brief…" and silently under-reports
  // words/prose, so today gets a longer, honest wait.
  const extra = label.includes('today') ? 20000 : 1500
  await page.waitForTimeout(extra)
  const m = await measure(page)
  const failedCapture = m.totalWords === 0 && m.height === 0
  const row = { label, width, ...m, consoleErrors: errors.length, errorSamples: errors.slice(0, 3), failedCapture }
  results.push(row)
  console.log(`${label}@${width}: words=${m.totalWords} height=${m.height} w/1000px=${m.wordsPer1000px} prose=${m.proseSharePct}% maxNum=${m.biggestNumberPx} enc=${m.encodings} overflow=${m.overflow} consoleErr=${errors.length}${failedCapture ? '  <<< FAILED CAPTURE' : ''}`)
  return row
}

const browser = await chromium.launch()

if (candidate === 'v2a') {
  // v2a has no URL routing for inner surfaces (Shell.tsx keeps tab state in
  // React only). Every surface below is reached by a FRESH load of #exp/v2a
  // followed by an in-app click sequence, never chained off a prior surface's
  // clicks, so state from one surface capture never bleeds into the next.
  const sequences = {
    inbox: [],
    today: [['[data-sweep="tab-today"]']],
    drafts: [['[data-sweep="tab-drafts"]']],
    content: [['[data-sweep="tab-drafts"]'], ['[data-sweep="work-content"]']],
    sends: [['[data-sweep="tab-sends"]']],
    ops: [['[data-sweep="tab-ops"]']],
    settings: [['[data-sweep="gear"]']],
    thread: [['[data-sweep="tab-inbox"]'], ['.rows .r']],
    'chat-empty': [['[data-sweep="mode-chat"]']],
  }
  for (const { w, h, tag } of WIDTHS) {
    for (const [label, steps] of Object.entries(sequences)) {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/v2a`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(`goto: ${e}`))
      await page.waitForTimeout(2000)
      let ok = true
      for (const [sel] of steps) {
        try {
          await page.click(sel, { timeout: 5000 })
          await page.waitForTimeout(600)
        } catch (e) {
          errors.push(`click-fail: ${sel} :: ${String(e).slice(0, 150)}`)
          ok = false
        }
      }
      if (!ok) console.log(`${label}@${tag}: NAVIGATION FAILED (could not click through), reporting as unreachable`)
      await capture(page, errors, `v2a/${label}`, tag)
      await ctx.close()
    }
  }
} else if (candidate === 'v2c') {
  // v2c takes a trailing path (#exp/v2c/<job>[/chat]) that survives a fresh
  // load, so every job + chat-over-default-job is directly URL-addressable.
  // The thread peer is a database id, so it still needs a click.
  const urlRoutes = {
    inbox: 'v2c',
    today: 'v2c/today',
    drafts: 'v2c/drafts',
    content: 'v2c/content',
    sends: 'v2c/sends',
    ops: 'v2c/ops',
    settings: 'v2c/settings',
    'chat-over-inbox': 'v2c/inbox/chat',
  }
  for (const { w, h, tag } of WIDTHS) {
    for (const [label, route] of Object.entries(urlRoutes)) {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(`goto: ${e}`))
      await page.waitForTimeout(2000)
      await capture(page, errors, `v2c/${label}`, tag)
      await ctx.close()
    }
    // thread peer: click-based, fresh load of inbox then click the first row
    {
      const { ctx, page, errors } = await newPage(browser, w, h)
      await page.goto(`${base}#exp/v2c`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(`goto: ${e}`))
      await page.waitForTimeout(2000)
      let ok = true
      try {
        await page.click('.rows .r', { timeout: 5000 })
        await page.waitForTimeout(600)
      } catch (e) {
        errors.push(`click-fail: .rows .r :: ${String(e).slice(0, 150)}`)
        ok = false
      }
      if (!ok) console.log(`thread@${tag}: NAVIGATION FAILED (could not click through), reporting as unreachable`)
      await capture(page, errors, 'v2c/thread', tag)
      await ctx.close()
    }
  }
}

await browser.close()

const outFile = new URL(`../goal-runs/inbox-v2-revamp-2026-08-01/phase2-tournament/measured-${candidate}.json`, import.meta.url)
writeFileSync(outFile, JSON.stringify(results, null, 2))
console.log(`\nwrote ${results.length} rows -> ${outFile.pathname}`)
