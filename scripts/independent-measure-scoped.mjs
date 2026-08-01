// Supplemental to independent-measure.mjs: v2c's desktop/wide canvas renders
// the work column (still holding the inbox's windowed-but-virtually-83k-tall
// scroller) SIMULTANEOUSLY beside a peer region. The generic "tallest actually
// scrolling element on the page" heuristic from density.mjs / CALIBRATION.md
// therefore picks up the background inbox column instead of the peer being
// measured. Rescoped to the peer's own DOM subtree (.wb-peer-thread /
// .wb-peer-chat), matching v2c's own brief's claim that this app needs
// per-region measurement at this viewport.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'

const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')
const base = 'http://localhost:4185/'

async function measureScoped(page, rootSel) {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel)
    if (!root) return null
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const leaves = [...root.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() && vis(el))
    const wordsOf = (el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
    const totalWords = leaves.reduce((n, el) => n + wordsOf(el), 0)
    const scrollers = [root, ...root.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 4)
      .map((el) => el.scrollHeight)
    const contentBottom = leaves.reduce((mx, el) => {
      const r = el.getBoundingClientRect()
      return Math.max(mx, r.bottom + (window.scrollY || 0))
    }, 0)
    const rootRect = root.getBoundingClientRect()
    const height = Math.max(root.scrollHeight, contentBottom - rootRect.top, ...(scrollers.length ? scrollers : [0]))
    const proseWords = leaves.filter((el) => wordsOf(el) >= 12).reduce((n, el) => n + wordsOf(el), 0)
    const fs = (el) => parseFloat(getComputedStyle(el).fontSize) || 0
    const numeric = leaves.filter((el) => /^[\s$€£]*[\d.,]+\s*[%kKmM]?\s*$/.test((el.textContent ?? '').trim()))
    const biggestNumberPx = numeric.reduce((mx, el) => Math.max(mx, fs(el)), 0)
    const encodings = [...root.querySelectorAll('*')].filter((el) => {
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
      encodings,
    }
  }, rootSel)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
  ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])

// thread peer, scoped
await page.goto(`${base}#exp/v2c`, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2000)
await page.click('.rows .r', { timeout: 5000 })
await page.waitForTimeout(800)
const thread = await measureScoped(page, '.wb-peer-thread')
console.log('v2c/thread@1440 (scoped .wb-peer-thread):', JSON.stringify(thread))

// chat-over-inbox peer, scoped
await page.goto(`${base}#exp/v2c/inbox/chat`, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2000)
const chat = await measureScoped(page, '.wb-peer-chat')
console.log('v2c/chat-over-inbox@1440 (scoped .wb-peer-chat):', JSON.stringify(chat))
console.log('console errors during scoped pass:', errors.length, errors.slice(0, 3))

await browser.close()
