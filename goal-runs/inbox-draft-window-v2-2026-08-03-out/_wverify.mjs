// Draft/magnet WINDOW verifier. Opens the takeover on whichever origin it is
// pointed at and measures the floors INSIDE it, plus the three behaviours this
// run claims: three columns, j/k moves, and the preview becoming the editor
// without the words moving.
//
//   node _wverify.mjs <origin> <outdir>
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const ORIGIN = process.argv[2] ?? 'http://localhost:5173'
const OUT = process.argv[3] ?? './verify'
mkdirSync(OUT, { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

const browser = await chromium.launch()
const out = { origin: ORIGIN, at: new Date().toISOString(), widths: {} }

const FLOORS = () => {
  const tk = document.querySelector('.wb-tk')
  if (!tk) return { error: 'no window' }
  const de = document.documentElement
  // Every element inside the window that pokes past the viewport, named.
  const over = []
  for (const el of tk.querySelectorAll('*')) {
    const b = el.getBoundingClientRect()
    if (b.width > 0 && (b.right > window.innerWidth + 1 || b.left < -1)) {
      over.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`)
    }
  }
  // Tap targets. Measure the BORDER BOX plus any vertical padding a
  // pseudo-element adds (the density run's verifier scored extended controls
  // as unextended and its numbers looked clean for the wrong reason).
  const small = []
  for (const el of tk.querySelectorAll('button,a,input,textarea,[role="button"],.ct-f,.chip')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 || b.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const before = getComputedStyle(el, '::before')
    const grow = (parseFloat(before.height) || 0) > b.height ? parseFloat(before.height) - b.height : 0
    const h = b.height + grow
    if (h < 44 || b.width < 24) {
      small.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(b.width)}x${Math.round(h)}`)
    }
  }
  const col = s => {
    const el = tk.querySelector(s)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { w: Math.round(b.width), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }
  const body = tk.querySelector('.wb-tk-body')
  return {
    hScroll: de.scrollWidth > de.clientWidth + 1,
    overflowers: [...new Set(over)].slice(0, 6),
    under44: [...new Set(small)].slice(0, 10),
    windowW: Math.round(tk.getBoundingClientRect().width),
    bodyScrollH: body?.scrollHeight ?? null,
    bodyClientH: body?.clientHeight ?? null,
    queue: col('.dw-queue'),
    main: col('.dw-main'),
    insp: col('.dw-insp'),
    queueRows: tk.querySelectorAll('.dw-qrow').length,
    actionKeys: [...tk.querySelectorAll('.dw-acts .dw-key')].map(b => b.textContent.trim()),
    // The reaction bar's labels at narrow widths.
    liActFont: (() => {
      const a = tk.querySelector('.li-act')
      return a ? getComputedStyle(a).fontSize : null
    })(),
    // The artifact keeps LinkedIn's own type, not the app's.
    liBody: (() => {
      const b = tk.querySelector('.li-body')
      if (!b) return null
      const cs = getComputedStyle(b)
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color }
    })(),
  }
}

async function open(page, job, w) {
  await page.goto(`${ORIGIN}/#exp/v2/${job}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(5000)
  const row = await page.$('.ct-card')
  if (!row) return false
  await row.click()
  await page.waitForTimeout(3000)
  return !!(await page.$('.wb-tk'))
}

for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.addInitScript(([s]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
  }, [session])

  const rec = {}
  // ---- the draft window ----
  if (await open(page, 'content', w)) {
    rec.draft = await page.evaluate(FLOORS)
    await page.screenshot({ path: `${OUT}/draft-${w}.png` })

    // j/k walks the queue.
    const first = await page.evaluate(() => document.querySelector('.dw-cap-t')?.textContent)
    await page.keyboard.press('j'); await page.waitForTimeout(2200)
    const second = await page.evaluate(() => document.querySelector('.dw-cap-t')?.textContent)
    await page.keyboard.press('k'); await page.waitForTimeout(2200)
    const back = await page.evaluate(() => document.querySelector('.dw-cap-t')?.textContent)
    rec.jk = { first, second, back, moved: first !== second, returned: first === back }

    // ⌘A must NOT approve (the reference's bug). Nothing may open.
    await page.keyboard.press('Meta+a'); await page.waitForTimeout(500)
    rec.cmdASafe = !(await page.$('.sheet-scrim'))
    // NOT Escape here: Escape closes the takeover, which is what made the first
    // run report editInPlace as null on a window that was no longer open.

    // `e` turns the preview into the editor IN PLACE: same box, same type.
    const beforeBox = await page.evaluate(() => {
      const b = document.querySelector('.li-body')
      if (!b) return null
      const r = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), fontSize: cs.fontSize, lineHeight: cs.lineHeight }
    })
    await page.keyboard.press('e'); await page.waitForTimeout(900)
    const afterBox = await page.evaluate(() => {
      const t = document.querySelector('textarea.li-ta')
      if (!t) return null
      const r = t.getBoundingClientRect()
      const cs = getComputedStyle(t)
      return {
        top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width),
        fontSize: cs.fontSize, lineHeight: cs.lineHeight,
        focused: document.activeElement === t,
        insideCard: !!t.closest('.li-card'),
      }
    })
    rec.editInPlace = { before: beforeBox, after: afterBox }
    await page.screenshot({ path: `${OUT}/draft-editing-${w}.png` })
    // Esc leaves without writing.
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    rec.escCancels = !(await page.$('textarea.li-ta'))
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  } else {
    rec.draft = { error: 'draft window did not open' }
  }

  // ---- the magnet window ----
  if (await open(page, 'magnets', w)) {
    rec.magnet = await page.evaluate(FLOORS)
    await page.screenshot({ path: `${OUT}/magnet-${w}.png` })
    await page.keyboard.press('Escape')
  } else {
    rec.magnet = { error: 'magnet window did not open' }
  }

  rec.consoleErrors = errors
  out.widths[w] = rec
  await page.close()
}

writeFileSync(`${OUT}/verify.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await browser.close()
