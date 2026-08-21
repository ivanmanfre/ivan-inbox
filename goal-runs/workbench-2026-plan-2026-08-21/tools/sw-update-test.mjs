// Does an OPEN TAB pick up a deploy on its own?
//
// Every previous fix was verified in a fresh browser, which is the one browser
// that never has this bug. This drives the real thing: a persistent profile with
// a live service worker, a page left open, a new build dropped underneath it,
// and no human touching the keyboard. If the tab does not end up on the new
// bundle by itself, the fix does not work, whatever the source says.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const PROFILE = '/tmp/sw-test-profile'
execSync(`rm -rf ${PROFILE}`)

const ctx = await chromium.launchPersistentContext(PROFILE, {
  viewport: { width: 1200, height: 800 },
  serviceWorkers: 'allow',
})
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
page.on('console', m => console.log('  [page]', m.text().slice(0, 120)))

// EVERY asset, not just the JS: a CSS-only deploy leaves the script tag alone,
// which is how the first run of this test reported FAIL on a working browser.
const assetOf = async () => page.evaluate(() => [
  ...[...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
  ...[...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')),
].filter(Boolean).sort().join(' '))

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
const before = await assetOf()
console.log('service worker controlling this page:', controlled)
console.log('bundle before deploy:', before)
if (!controlled) { console.log('NOT CONTROLLED - reload once so the worker takes over'); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000) }
console.log('visibilityState:', await page.evaluate(() => document.visibilityState))
console.log('controlling after settle:', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))

// --- deploy underneath the open tab ---
//
// The build must actually DIFFER. Rebuilding identical source emits an
// identical content hash, so the first version of this test "passed nothing":
// it compared a bundle against itself and would have reported FAIL for a
// working fix and PASS for a broken one. Touch a real file first.
console.log('\nbuilding a NEW bundle while the tab stays open...')
const MARK = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/wb2026.css'
const original = readFileSync(MARK, 'utf8')
// A REAL RULE. A CSS comment is stripped by the minifier, so the build came out
// byte-identical and the test was comparing a bundle against itself.
execSync(`printf '\\n.wb-swtest-marker{outline:1px solid red}\\n' >> ${MARK}`)
try {
  execSync('cd /Users/ivanmanfredi/Desktop/ivan-inbox && npx vite build', { stdio: 'pipe' })
} finally {
  execSync(`cat > ${MARK} <<'SWTESTEOF'\n${original}\nSWTESTEOF`)
}
console.log('new build on disk. waiting for the tab to notice, untouched...')

let reloaded = false
page.on('load', () => { reloaded = true })

const started = Date.now()
let after = before
while (Date.now() - started < 100_000) {
  await page.waitForTimeout(5000)
  try {
    after = await assetOf()
    if (after !== before) break
  } catch { /* mid-reload */ }
  process.stdout.write('.')
}
console.log('')
console.log('bundle after  deploy:', after)
console.log('page reloaded on its own:', reloaded)
console.log(after !== before
  ? `\nPASS - the open tab moved to the new build by itself in ${Math.round((Date.now() - started) / 1000)}s`
  : '\nFAIL - the open tab is still serving the old bundle')
await ctx.close()
