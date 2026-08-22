// Facts visible in the FIRST VIEWPORT, measured identically on both builds.
//
// A "fact" is a leaf element, visible and inside the first viewport box, whose
// own text is a QUANTITY (a bare number, or a number leading a short phrase) or
// a STATE DOT (an empty element whose class names a dot). Those are the two
// things the glance layer trades in. Prose is excluded on purpose: a paragraph
// is not a fact you can spot without reading it.
//
// 🔴 THE ESTIMATOR IS SETTLE-TO-STABLE, NOT A FIXED WAIT. A fixed 5.5s wait
// under-counted reproducibly and NOT deterministically: the same surface read
// 11 quantities on one pass and 0 on the next, because a cold browser profile
// loses the realtime handshake and the count queries land late. A count only
// ever grows as the page finishes, so this polls until the number stops moving
// for three consecutive reads and reports that. An under-count would flatter
// the "before" and the "after" at random, which is the one thing a density
// claim cannot afford.
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

async function stable(page) {
  let best = { quantities: [], dots: 0, total: -1 }
  let same = 0
  for (let i = 0; i < 24 && same < 3; i++) {
    await page.waitForTimeout(700)
    const r = await page.evaluate(COUNT)
    if (r.total > best.total) { best = r; same = 0 } else { same += 1 }
  }
  return best
}

const PORT = process.env.GL_PORT || '4187'
const JOBS = (process.env.GL_JOBS || 'content,ops').split(',')
const VIEWS = [[1440, 900], [390, 844]]
const label = process.argv[2] || 'run'
const out = []
let writesTotal = 0, errs = []
for (const job of JOBS) {
  for (const [w, h] of VIEWS) {
    const { browser, page, writes, errors } = await open({ width: w, height: h, theme: 'dark' })
    await page.goto(`http://127.0.0.1:${PORT}/#exp/v2/${job}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 2500)
    const r = await stable(page)
    out.push({ job, w, h, ...r })
    writesTotal += writes.length; errs = errs.concat(errors)
    await browser.close()
  }
}
console.log(JSON.stringify({ label, port: PORT, writes: writesTotal, errors: errs, out }, null, 1))
