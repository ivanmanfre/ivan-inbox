import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('.session.json', 'utf8')

async function run(viewport) {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
  await p.goto('http://localhost:5444/#exp/v2/content', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(4000)
  const out = await p.evaluate(() => {
    const lum = (rgbStr) => {
      const m = rgbStr.match(/[\d.]+/g); if (!m) return null
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
      return getComputedStyle(document.documentElement).backgroundColor
    }
    const res = []
    for (const sel of ['.wb-cap', '.ct-chip-none', '.ct-thumb-empty']) {
      const els = document.querySelectorAll(sel)
      if (els.length === 0) { res.push({ sel, missing: true }); continue }
      // sample every distinct data-cat / class combo found, not just the first node
      const seen = new Set()
      for (const el of els) {
        const key = el.className + '|' + (el.getAttribute('data-cat') || '')
        if (seen.has(key)) continue
        seen.add(key)
        const s = getComputedStyle(el)
        const bg = effectiveBg(el)
        const l1 = lum(s.color), l2 = lum(bg)
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        res.push({
          sel, className: el.className, dataCat: el.getAttribute('data-cat'),
          color: s.color, bg, fontSize: s.fontSize, fontWeight: s.fontWeight,
          ratio: Number(ratio.toFixed(2)), text: el.textContent.trim(),
        })
      }
    }
    return res
  })
  await b.close()
  return out
}

const r1440 = await run({ width: 1440, height: 900 })
const r390 = await run({ width: 390, height: 844 })
console.log('=== 1440x900 ===')
console.log(JSON.stringify(r1440, null, 2))
console.log('=== 390x844 ===')
console.log(JSON.stringify(r390, null, 2))
