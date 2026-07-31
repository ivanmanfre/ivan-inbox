// verify-comment-draft.mjs — browser proof for the "Draft it" button on an empty
// comment card (2026-07-31).
//
// Expects: .session.json minted (dev-login.mjs), a preview server, and the id of
// a PENDING comment_reply card with an empty body passed as argv[3].
// Proves: the button renders only on the empty card, one tap reaches
// rise-comment-draft, and the returned draft lands in the textarea with the
// primary action flipped from "Mark handled" to "Approve & post".
//
// It never presses approve. Approving is what publishes on this lane.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const TARGET = process.argv[2] ?? 'http://localhost:4319/'
const CARD_ID = process.argv[3]
const OUT = process.env.OPS_SHOT_DIR ?? '/tmp'
if (!CARD_ID) throw new Error('pass the ops_drafts id of an empty pending comment card')
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.getByText('Ops', { exact: true }).click()
await page.waitForTimeout(1500)

const card = page.locator(`[data-ops-id="${CARD_ID}"]`)
if (!(await card.count())) throw new Error('test card not rendered on Ops')
await page.screenshot({ path: `${OUT}/draft-1-empty.png` })

const ta = card.locator('textarea')
if ((await ta.inputValue()).trim()) throw new Error('card is not empty, nothing to prove')
const primary = card.locator('.btn.p')
if ((await primary.textContent())?.trim() !== 'Mark handled') {
  throw new Error(`expected "Mark handled" before drafting, got "${await primary.textContent()}"`)
}

const drafter = card.locator('.btn.s', { hasText: 'Draft it' })
if (!(await drafter.count())) throw new Error('no "Draft it" button on an empty comment card')
await drafter.click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/draft-2-writing.png` })

// Best-of-3 + gates: ~10s live, allow for a repair pass.
try {
  await page.waitForFunction(
    (id) => (document.querySelector(`[data-ops-id="${id}"] textarea`)?.value ?? '').trim().length > 0,
    CARD_ID, { timeout: 120_000 },
  )
} catch {
  const why = await card.locator('.ops-reason').textContent().catch(() => '')
  throw new Error(`no draft landed: ${why || 'no reason shown'}`)
}

await page.waitForTimeout(1200)
const drafted = (await ta.inputValue()).trim()
const label = (await primary.textContent())?.trim()
await page.screenshot({ path: `${OUT}/draft-3-drafted.png` })

console.log(`draft (${drafted.split(/\s+/).length} words): ${drafted}`)
console.log(`primary action now: ${label}`)
if (label !== 'Approve & post') throw new Error('primary action did not flip to Approve & post')
if (await card.locator('.btn.s', { hasText: 'Draft it' }).count()) {
  throw new Error('"Draft it" still offered on a card that now has a body')
}

console.log(errors.length ? `CONSOLE ERRORS:\n  ${errors.join('\n  ')}` : 'console clean')
await browser.close()
if (errors.length) process.exit(1)
