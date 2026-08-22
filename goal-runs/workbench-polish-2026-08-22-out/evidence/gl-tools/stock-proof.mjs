// #exp/stock must be pixel-identical. The changed files are all v2c-only
// (inventory.md §1 lists the eleven components that DO cross over; none of them
// is Rail, ContentList, OpsBoard or wbsys.css, and wbsys.css is imported only
// from v2c/Shell.tsx). This proves it rather than arguing it: the pre-change
// tree is built and served on 4188, the post-change tree on 4187, and the same
// stock routes are shot from both as PNG and compared byte for byte.
import { open, settle } from './harness.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'

const ROUTES = ['#exp/stock', '#exp/stock', '#exp/stock']
const VIEWS = [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark']]
const out = []
for (let i = 0; i < VIEWS.length; i++) {
  const [w, h, theme] = VIEWS[i]
  const shots = {}
  for (const [tag, port] of [['before', 4188], ['after', 4187]]) {
    const { browser, page, writes, errors } = await open({ width: w, height: h, theme })
    await page.goto(`http://127.0.0.1:${port}/${ROUTES[i]}`, { waitUntil: 'domcontentloaded' })
    await settle(page, 6000)
    const buf = await page.screenshot({ type: 'png' })
    const f = `/tmp/gl/stock-${tag}-${w}-${theme}.png`
    fs.writeFileSync(f, buf)
    shots[tag] = { file: f, sha: crypto.createHash('sha256').update(buf).digest('hex'), writes: writes.length, errors }
    await browser.close()
  }
  out.push({ view: `${w}x${h} ${theme}`, ...shots, identical: shots.before.sha === shots.after.sha })
}
console.log(JSON.stringify(out, null, 1))
