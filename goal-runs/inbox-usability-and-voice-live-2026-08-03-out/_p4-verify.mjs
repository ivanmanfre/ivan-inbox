import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-usability-and-voice-live-2026-08-03-out/phase4-shots'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('http://localhost:4173/#exp/v2/inbox/chat', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
const field = page.locator('.cfield')
const r = {}
// 1. full palette count
await field.fill('/')
await page.waitForTimeout(300)
r.allCount = await page.locator('.wb-pal-opt').count()
await page.screenshot({ path: `${OUT}/palette-all.png` })
// 2. filter to a skill
await field.fill('/skill brain')
await page.waitForTimeout(300)
r.skillMatch = await page.locator('.wb-pal-opt').allTextContents()
// 3. pick it -> insert
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
r.inserted = await field.inputValue()
await page.screenshot({ path: `${OUT}/palette-skill-inserted.png` })
// 4. gsd filter
await field.fill('/gsd plan')
await page.waitForTimeout(300)
r.gsdMatches = (await page.locator('.wb-pal-opt').allTextContents()).slice(0, 4)
// 5. unknown slash warn
await field.fill('/notacommandzzz')
await page.waitForTimeout(300)
r.warnShown = await page.locator('.wb-pal-f').textContent().catch(() => null)
// 6. satisfied-template exclusion: bare command sendable
await field.fill('/gsd:help')
await page.waitForTimeout(300)
r.bareCmdPalette = await page.locator('.wb-pal-opt').count()
// 7. model pick + real turn on haiku
await field.fill('/model haiku')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await field.fill('Reply with exactly: ok')
await page.keyboard.press('Enter')
const t0 = Date.now()
await page.waitForFunction(() => {
  const t = Array.from(document.querySelectorAll('.wb-turn.asst'))
  return t.length > 0 && /ok/i.test(t[t.length-1].textContent || '')
}, { timeout: 120000 }).catch(() => {})
r.haikuTurnMs = Date.now() - t0
r.modelChip = await page.locator('.wb-model-chip, [class*="model"]').first().textContent().catch(() => null)
r.lastAsst = (await page.locator('.wb-turn.asst').last().textContent().catch(() => ''))?.slice(0, 80)
await page.screenshot({ path: `${OUT}/model-haiku-turn.png` })
// 8. real skill turn: recall
await field.fill('Use the recall skill: what is the canonical prompts storage for the content engine? One line.')
await page.keyboard.press('Enter')
const t1 = Date.now()
await page.waitForFunction(n => document.querySelectorAll('.wb-turn.asst').length > n, r.lastAsst ? 1 : 0, { timeout: 180000 }).catch(() => {})
await page.waitForFunction(() => !document.querySelector('.wb-stop'), { timeout: 180000 }).catch(() => {})
r.recallTurnMs = Date.now() - t1
r.recallReply = (await page.locator('.wb-turn.asst').last().textContent().catch(() => ''))?.slice(0, 200)
await page.screenshot({ path: `${OUT}/skill-recall-turn.png` })
r.consoleErrors = errors.slice(0, 5)
console.log(JSON.stringify(r, null, 1))
await browser.close()
