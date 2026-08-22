import { open, settle } from './harness.mjs'
const DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-gl/goal-runs/workbench-polish-2026-08-22-out/after'
const SHOTS = [
  ['content', 1440, 900, 'dark', 0], ['content', 1440, 900, 'light', 0],
  ['content', 390, 844, 'dark', 0], ['content', 390, 844, 'light', 0],
  ['ops', 1440, 900, 'dark', 0], ['ops', 1440, 900, 'light', 0],
  ['ops', 390, 844, 'dark', 0],
  ['content', 1440, 900, 'dark', 1],   // the collapsed rail: pips + bare roll-up
]
let writes = 0, errs = []
for (const [job, w, h, theme, min] of SHOTS) {
  const { browser, page, writes: wr, errors } = await open({ width: w, height: h, theme })
  await page.addInitScript(m => localStorage.setItem('wb-railmin', m), String(min))
  await page.goto(`http://127.0.0.1:4187/#exp/v2/${job}`, { waitUntil: 'domcontentloaded' })
  await settle(page, 6000)
  const tag = `gl-${job}-${w}-${theme}${min ? '-railmin' : ''}.jpg`
  await page.screenshot({ path: `${DIR}/${tag}`, type: 'jpeg', quality: 84 })
  writes += wr.length; errs = errs.concat(errors)
  await browser.close()
}
console.log(JSON.stringify({ shots: SHOTS.length, writes, errors: errs }))
