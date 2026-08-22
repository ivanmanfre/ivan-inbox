// Density Analyst — OLD dashboard character-advance measurement.
// The OLD dashboard itself is behind a password gate we do not defeat (see
// density-analysis.md "How OLD was measured" for why). This script instead
// loads Schibsted Grotesk from Google Fonts directly (a public CDN, NOT the
// gated dashboard) and measures real glyph advances with canvas
// measureText(), so the OLD side's character-per-line numbers are not a
// 0.5em guess even though they are source-derived rather than rendered.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] || '.'

const html = `<!doctype html><html><head><style>
@import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&display=swap');
body { margin:0 }
</style></head><body>
<div id="probe" style="font-family:'Schibsted Grotesk',system-ui,sans-serif">x</div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200) // let the webfont finish swapping in

const specs = [
  { label: 'ws-idt-title (Posts row title)', weight: 500, size: '15px' },
  { label: 'ec-item-title (Styles row title)', weight: 500, size: '15px' },
  { label: 'ors-name (Outreach row name)', weight: 700, size: '15px' },
  { label: 'ors-snippet (Outreach row body)', weight: 400, size: '13px' },
  { label: 'ec-dek (page deck / body copy)', weight: 400, size: '16px' },
  { label: 'ws-idt-why (idea rationale)', weight: 400, size: '12.5px' },
]

const result = await page.evaluate((specs) => {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  return specs.map((s) => {
    ctx.font = `${s.weight} ${s.size} 'Schibsted Grotesk', system-ui, sans-serif`
    return {
      ...s,
      zeroWidthPx: Math.round(ctx.measureText('0').width * 100) / 100,
      avgLowerWidthPx: Math.round((ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26) * 100) / 100,
      halfEmAssumptionPx: Math.round(parseFloat(s.size) * 0.5 * 100) / 100,
    }
  })
}, specs)

for (const r of result) {
  const overstateVsZero = Math.round((r.halfEmAssumptionPx / r.zeroWidthPx) * 100) / 100
  console.log(`${r.label}: 0-width=${r.zeroWidthPx}px avgLower=${r.avgLowerWidthPx}px 0.5em-assumption=${r.halfEmAssumptionPx}px (0.5em overstates by ${overstateVsZero}x)`)
}

writeFileSync(`${OUT}/old-font-metrics.json`, JSON.stringify(result, null, 2))
await browser.close()
