// Is the automatic check firing at all? Poll the registration while the tab
// sits untouched, then prove the new build was detectable the whole time by
// calling update() by hand at the end.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
execSync('rm -rf /tmp/sw-int-profile')
const ctx = await chromium.launchPersistentContext('/tmp/sw-int-profile', { viewport: { width: 1000, height: 700 }, serviceWorkers: 'allow' })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
let swFetches = 0
ctx.on('request', r => { if (r.url().endsWith('/sw.js')) { swFetches++; console.log(`  [sw.js fetch #${swFetches}] t+${Math.round((Date.now() - t0) / 1000)}s`) } })
const t0 = Date.now()
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// Prove the update-check code is in the page that is actually running.
console.log('fix present in running page:', await page.evaluate(() => {
  const s = [...document.querySelectorAll('script[src]')].map(e => e.src).find(x => x.includes('index-'))
  return fetch(s).then(r => r.text()).then(t => /serviceWorker\.ready/.test(t))
}))

const MARK = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/wb2026.css'
const original = readFileSync(MARK, 'utf8')
execSync(`printf '\\n.wb-int-marker{outline:1px solid red}\\n' >> ${MARK}`)
try { execSync('cd /Users/ivanmanfredi/Desktop/ivan-inbox && npx vite build', { stdio: 'pipe' }) }
finally { execSync(`cat > ${MARK} <<'INTEOF'\n${original}\nINTEOF`) }
console.log(`new build deployed at t+${Math.round((Date.now() - t0) / 1000)}s. watching for 80s, hands off...\n`)

for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(5000)
  const st = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return `${reg?.installing ? 'INSTALLING' : ''}${reg?.waiting ? 'WAITING' : ''}` || 'idle'
  }).catch(() => 'reloading')
  if (st !== 'idle') console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s state=${st}`)
}
console.log(`\nsw.js fetches during the whole run: ${swFetches}`)
console.log('now forcing update() by hand:')
const forced = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  await reg.update()
  return { installing: Boolean(reg.installing), waiting: Boolean(reg.waiting) }
}).catch(e => String(e).slice(0, 80))
console.log(' ', JSON.stringify(forced))
console.log(swFetches > 1
  ? '\n=> the automatic check DID run'
  : '\n=> the automatic check NEVER ran (only the initial registration fetch)')
await ctx.close()
