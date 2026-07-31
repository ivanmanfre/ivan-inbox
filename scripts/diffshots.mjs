// diffshots.mjs — compare two sweep runs to prove the default routes did not move.
//
// The T2 contract for this run is that #today/#inbox/#drafts/#sends/#ops/#settings
// render exactly as they did before the run. "I didn't touch them" is not evidence;
// this is. Reads the sweep.json + PNGs from two directories and reports, per
// route/viewport: byte-identity of the image, and equality of the measured
// geometry (scrollWidth/scrollHeight/word count).
//
// Byte-identity is the strong signal but can false-alarm on antialiasing or a
// data change between runs, so geometry equality is reported alongside it and a
// verdict distinguishes "identical", "same geometry, different pixels" (look at
// it) and "geometry moved" (a real regression).
//
// Usage: node scripts/diffshots.mjs <baselineDir> <afterDir>
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const [baseDir, afterDir] = process.argv.slice(2)
if (!baseDir || !afterDir) {
  console.error('usage: node scripts/diffshots.mjs <baselineDir> <afterDir>')
  process.exit(2)
}

const load = (d) => {
  const p = `${d}/sweep.json`
  if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(2) }
  return JSON.parse(readFileSync(p, 'utf8'))
}
const sha = (f) => existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null

const base = load(baseDir)
const after = load(afterDir)
const key = (r) => `${r.route}/${r.tag}`
const afterBy = new Map(after.map((r) => [key(r), r]))

const rows = []
for (const b of base) {
  const a = afterBy.get(key(b))
  if (!a) { rows.push({ k: key(b), verdict: 'MISSING_AFTER' }); continue }
  const hb = sha(b.file)
  const ha = sha(a.file)
  const geomSame = b.scrollWidth === a.scrollWidth &&
    b.scrollHeight === a.scrollHeight &&
    b.words === a.words
  const pixSame = hb && ha && hb === ha
  rows.push({
    k: key(b),
    verdict: pixSame ? 'IDENTICAL' : geomSame ? 'PIXELS_DIFFER_GEOMETRY_SAME' : 'GEOMETRY_MOVED',
    base: { w: b.scrollWidth, h: b.scrollHeight, words: b.words },
    after: { w: a.scrollWidth, h: a.scrollHeight, words: a.words },
  })
}

for (const r of rows) {
  const d = r.verdict === 'IDENTICAL'
    ? ''
    : ` base=${r.base?.w}x${r.base?.h}/${r.base?.words}w after=${r.after?.w}x${r.after?.h}/${r.after?.words}w`
  console.log(`${r.verdict.padEnd(28)} ${r.k}${d}`)
}

const moved = rows.filter((r) => r.verdict === 'GEOMETRY_MOVED' || r.verdict === 'MISSING_AFTER')
const softer = rows.filter((r) => r.verdict === 'PIXELS_DIFFER_GEOMETRY_SAME')
console.log(`\n${rows.length} routes compared`)
console.log(`identical: ${rows.filter((r) => r.verdict === 'IDENTICAL').length}` +
  ` | pixels-differ-geometry-same: ${softer.length} | geometry-moved: ${moved.length}`)
if (moved.length) {
  console.log(`REGRESSION: ${moved.map((r) => r.k).join(', ')}`)
  process.exit(1)
}
if (softer.length) {
  // Not a failure by itself: live data moves between runs. Names the routes that
  // need an eyeball rather than silently passing them.
  console.log(`REVIEW (live data may explain these): ${softer.map((r) => r.k).join(', ')}`)
}
