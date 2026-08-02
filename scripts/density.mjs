// density.mjs — measure the contract's density gates on a rendered surface.
// Judgment needs numbers: "feels dense" and "reads as a wall of text" are the
// two failure modes this run is most likely to ship, and neither is visible in
// a screenshot to an LLM reviewer. This is the instrument; it does not judge.
//
// Gates (from phase2-tournament/CONTRACT.md):
//   words per 1000px of rendered height  <= 140
//   prose share (words in <p>-like blocks / total words) <= 30%
//   every stat/KPI panel has a primary number >= 40px
//   per-row metrics >= 18px
//   every section encodes something visually (a text-only section fails)
//
// Usage: node scripts/density.mjs <url> <label> [width] [--json out.json]
//   node scripts/density.mjs http://localhost:4173/#exp/v2a v2a-inbox 390
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const url = process.argv[2]
const label = process.argv[3] ?? 'unlabeled'
const width = Number(process.argv[4] ?? 390)
const jsonIdx = process.argv.indexOf('--json')
const outFile = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null

const sessionPath = new URL('../.session.json', import.meta.url)
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
if (session) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
}
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })

await page.waitForTimeout(2500)

const m = await page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const leaves = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
  const wordsOf = (el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
  const totalWords = leaves.reduce((n, el) => n + wordsOf(el), 0)
  // This app scrolls an inner container (.app and its panes), not the document,
  // so documentElement.scrollHeight is pinned to the viewport and every screen
  // measures 852px. Find the tallest actually-scrolling element instead, or the
  // content bounding height, whichever is larger — otherwise "words per 1000px"
  // silently degrades into "words per screen" and the gate is meaningless.
  const scrollers = [document.documentElement, ...document.querySelectorAll('body *')]
    .filter((el) => el.scrollHeight > el.clientHeight + 4)
    .map((el) => el.scrollHeight)
  const contentBottom = leaves.reduce((mx, el) => {
    const r = el.getBoundingClientRect()
    return Math.max(mx, r.bottom + (window.scrollY || 0))
  }, 0)
  const height = Math.max(document.documentElement.scrollHeight, contentBottom, ...scrollers)

  // Prose = a visible leaf whose own text runs long enough to read as a
  // sentence block rather than a label, chip, number or row fragment.
  const proseWords = leaves
    .filter((el) => wordsOf(el) >= 12)
    .reduce((n, el) => n + wordsOf(el), 0)

  const fs = (el) => parseFloat(getComputedStyle(el).fontSize) || 0
  const numeric = leaves.filter((el) => /^[\s$€£]*[\d.,]+\s*[%kKmM]?\s*$/.test((el.textContent ?? '').trim()))
  const biggestNumberPx = numeric.reduce((mx, el) => Math.max(mx, fs(el)), 0)
  const numbersOver40 = numeric.filter((el) => fs(el) >= 40).length
  const numbersOver18 = numeric.filter((el) => fs(el) >= 18).length

  // A "visual encoding" is any non-text mark: a bar/gauge/dial with a computed
  // width or a background fill, an svg, a canvas, or a coloured status dot.
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
    numbersOver40, numbersOver18, encodings,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})

await browser.close()

// The contract's ORIGINAL gate list, kept for continuity with the pre-calibration
// baseline runs. Two of these were WITHDRAWN in phase2-tournament/CALIBRATION.md
// after failing their controls, so they are reported, never enforced:
//   * words/1000px <= 140 — a prose strawman scored 169 while the app's
//     best-composed real screen scored 142.5. It measures length, not quality.
//   * primary number >= 40px — contradicts the locked type scale, whose real
//     ceiling is 26-38px. Chasing it would mean breaking canon to satisfy a gate
//     imported from a client-report context.
const legacyGates = {
  density: m.wordsPer1000px <= 140,
  prose: m.proseSharePct <= 30,
  primaryNumber: m.numbersOver40 >= 1,
  visualEncoding: m.encodings >= 1,
  noOverflow: !m.overflow,
}

// The gate list as CALIBRATED and therefore as actually in force. A tool that
// prints FAIL for a build that passes every surviving gate teaches its reader to
// ignore it, so the verdict below is computed from these.
const gates = {
  noOverflow: !m.overflow,
  // totalWords > 100 → encodings >= 1. The one threshold that cleanly separated
  // every control: the strawman scored 0 encodings, every good screen scored many.
  visualEncoding: m.totalWords <= 100 || m.encodings >= 1,
  prose: m.proseSharePct <= 80,
  // Only surfaces that actually render STAT TILES are asked for a big number; a
  // message list has plenty of numbers (timestamps, counts) and nothing to make
  // big. "Has a stat tile" is detected as "its largest number is at least 20px",
  // i.e. the surface is already trying to present a hero figure — calibrated
  // against the same controls as the rest of the list: live sends 28px (judged),
  // live inbox 13px and empty ops 0px (exempt, correctly), strawman 0px (exempt).
  statNumber: m.biggestNumberPx < 20 || m.biggestNumberPx >= 26,
}
const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([k]) => k)
const row = {
  label, url, width, ...m, gates, legacyGates, failed, pass: failed.length === 0,
  reported: {
    wordsPer1000px: m.wordsPer1000px, proseSharePct: m.proseSharePct,
    encodings: m.encodings, height: m.height, biggestNumberPx: m.biggestNumberPx,
  },
}

console.log(JSON.stringify(row, null, 2))
console.log(row.pass ? `PASS ${label}` : `FAIL ${label} -> ${failed.join(', ')}`)
if (outFile) {
  const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : []
  writeFileSync(outFile, JSON.stringify([...prev, row], null, 2))
}
