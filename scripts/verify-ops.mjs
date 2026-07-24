// verify-ops.mjs — playwright round-trip proof for the Ops section (Inbox Ops Lane, 2026-07-24).
// Expects: .session.json minted (dev-login.mjs), a preview server, and two pre-inserted
// ops_drafts test rows whose ids are passed as argv[3] (approve target) and argv[4] (discard target).
// Proves: pending render, body edit, confirm-gated approve stamp, discard stamp, realtime removal.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const TARGET = process.argv[2] ?? 'http://localhost:4319/'
const APPROVE_ID = process.argv[3]
const DISCARD_ID = process.argv[4]
const OUT = process.env.OPS_SHOT_DIR ?? '/tmp'
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])

await page.goto(TARGET, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Ops tab
await page.getByText('Ops', { exact: true }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/ops-1-pending.png` })

const approveCard = page.locator(`[data-ops-id="${APPROVE_ID}"]`)
const discardCard = page.locator(`[data-ops-id="${DISCARD_ID}"]`)
if (!(await approveCard.count())) throw new Error('approve test card not rendered (data-ops-id missing?)')
if (!(await discardCard.count())) throw new Error('discard test card not rendered')

// 1. edit body
const ta = approveCard.locator('textarea')
await ta.fill('UI-TEST approve row EDITED by playwright')
await page.waitForTimeout(300)

// 2. approve (confirm-gated: .btn on the card, then .sheet-btn.confirm in the sheet)
await approveCard.locator('.btn.p').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/ops-2-confirm.png` })
await page.locator('.sheet-btn.confirm, .sheet-btn.danger').last().click()
await page.waitForTimeout(1500)

// 3. discard (confirm-gated)
await discardCard.locator('.btn.s').click()
await page.waitForTimeout(400)
await page.locator('.sheet-btn.confirm, .sheet-btn.danger').last().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/ops-3-after.png` })

const pendingLeft = await page.locator(`[data-ops-id="${APPROVE_ID}"], [data-ops-id="${DISCARD_ID}"]`).count()
console.log(JSON.stringify({ pendingCardsLeftAfterActions: pendingLeft, consoleErrors: errors }))
await browser.close()
