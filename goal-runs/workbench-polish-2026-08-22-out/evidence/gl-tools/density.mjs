// Facts visible in the FIRST VIEWPORT, measured identically before and after.
//
// A "fact" is a leaf element, visible and fully inside the first viewport box,
// whose own text is a QUANTITY (a bare number, or a number leading a short
// phrase) — or a STATE DOT (an empty element whose class names a dot). Those
// are the two things the glance layer trades in. Prose is excluded on purpose:
// a paragraph is not a fact you can spot without reading it.
import { open, settle } from './harness.mjs'

const COUNT = `() => {
  const vw = innerWidth, vh = innerHeight
  const inFirst = el => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    if (r.top >= vh || r.left >= vw || r.bottom <= 0 || r.right <= 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05
  }
  const quantities = [], dots = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    if (!inFirst(el)) continue
    const t = (el.textContent || '').trim()
    const cls = typeof el.className === 'string' ? el.className : ''
    if (!t) { if (/dot|-n\\b|badge|pip/.test(cls)) dots.push(cls); continue }
    if (t.length > 28) continue
    if (/^[\\d][\\d,\\.]*$/.test(t) || /^[\\d][\\d,\\.]*\\s*\\S{0,14}$/.test(t)) quantities.push(t)
  }
  return { quantities, dots: dots.length, total: quantities.length + dots.length }
}`

const url = process.argv[2]
const w = +(process.argv[3] || 1440), h = +(process.argv[4] || 900)
const theme = process.argv[5] || 'dark'
const { browser, page, writes, errors } = await open({ width: w, height: h, theme })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await settle(page, 5500)
const r = await page.evaluate(eval(`(${COUNT})`))
console.log(JSON.stringify({ url, w, h, theme, ...r, writes: writes.length, writeList: writes, errors }, null, 1))
await browser.close()
