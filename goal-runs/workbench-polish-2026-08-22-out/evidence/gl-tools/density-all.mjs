import { open, settle } from './harness.mjs'
const COUNT = () => {
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
    if (!t) { if (/dot|badge|pip/.test(cls)) dots.push(cls); continue }
    if (t.length > 28) continue
    if (/^[\d][\d,.]*$/.test(t) || /^[\d][\d,.]*\s*\S{0,14}$/.test(t)) quantities.push(t)
  }
  return { quantities, dots: dots.length, total: quantities.length + dots.length }
}
const JOBS = (process.env.GL_JOBS || 'content,ops').split(',')
const VIEWS = [[1440, 900], [390, 844]]
const label = process.argv[2] || 'run'
const out = []
let writesTotal = 0, errs = []
for (const job of JOBS) {
  for (const [w, h] of VIEWS) {
    const { browser, page, writes, errors } = await open({ width: w, height: h, theme: 'dark' })
    await page.goto(`http://127.0.0.1:4187/#exp/v2/${job}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 5500)
    const r = await page.evaluate(COUNT)
    out.push({ job, w, h, ...r })
    writesTotal += writes.length; errs = errs.concat(errors)
    await browser.close()
  }
}
console.log(JSON.stringify({ label, writes: writesTotal, errors: errs, out }, null, 1))
