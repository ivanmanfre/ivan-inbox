// Phase 3 E2E — the BUILT app (npm run preview on :4173), authed, with
// Chromium's fake mic playing the bench WAVs. Verifies in the real DOM:
//   dictate:  live interim tail appears while speaking; committed text lands
//             in the composer; keyterms survive.
//   silence:  composer unchanged + "Didn't catch that." — nothing inserted.
//   cmdD:     ⌘D starts and stops the composer mic.
//   live:     the conversation sheet runs a full loop turn — LISTENING →
//             Thinking → Speaking → LISTENING — and an <<ESCALATE>> reply
//             dispatches into the chat pane (measured: escalation → visible).
//
// Usage: node scripts/p3-e2e.mjs <mode> [wav] [viewportW]
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const [mode, wav, vw] = process.argv.slice(2)
const SESSION = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const URL_ = 'http://localhost:4173/#exp/v2/inbox/chat'
const VIEW = { width: Number(vw ?? 1440), height: Number(vw) === 390 ? 844 : 900 }

const args = ['--autoplay-policy=no-user-gesture-required']
if (wav) {
  args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}%noloop`)
}
const browser = await chromium.launch({ headless: false, args })
const ctx = await browser.newContext({ viewport: VIEW })
await ctx.grantPermissions(['microphone'], { origin: 'http://localhost:4173' })
await ctx.addInitScript(([sess]) => {
  localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', sess)
  window.__log = []
  window.__lastState = ''
  window.__chatUsers = 0
  // Instrument speech + live-sheet state + chat turns on one page clock.
  const orig = speechSynthesis.speak.bind(speechSynthesis)
  speechSynthesis.speak = (u) => {
    window.__log.push({ e: 'speak-called', t: Date.now(), text: (u.text || '').slice(0, 60) })
    u.addEventListener('start', () => window.__log.push({ e: 'utter-start', t: Date.now(), text: (u.text || '').slice(0, 60) }))
    orig(u)
  }
  setInterval(() => {
    const st = document.querySelector('.wb-live-state')?.textContent ?? ''
    if (st !== window.__lastState) { window.__lastState = st; window.__log.push({ e: 'state', s: st, t: Date.now() }) }
    const users = document.querySelectorAll('.wb-turn.user').length
    if (users !== window.__chatUsers) { window.__chatUsers = users; window.__log.push({ e: 'chat-user-turn', n: users, t: Date.now() }) }
    const interim = document.querySelector('.cfield-interim')?.textContent ?? ''
    if (interim && !['listening…', 'starting…', '…'].includes(interim) && !window.__firstInterim) {
      window.__firstInterim = true
      window.__log.push({ e: 'first-interim', t: Date.now(), text: interim.slice(0, 60) })
    }
  }, 50)
}, [SESSION])
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
await page.goto(URL_, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const shot = (name) => page.screenshot({ path: `/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/p3-e2e-${name}.png` })

if (mode === 'dictate' || mode === 'silence') {
  const mic = page.locator('.cmic')
  await mic.waitFor({ timeout: 8000 })
  const t0 = Date.now()
  await page.evaluate(t => window.__log.push({ e: 'mic-press', t }), t0)
  await mic.click()
  // Wait for the session to open then the clip to play out.
  await page.waitForTimeout(mode === 'silence' ? 4500 : 9500)
  await shot(`${mode}-during`)
  await mic.click() // stop
  await page.waitForSelector('input.cfield', { timeout: 8000 })
  await page.waitForTimeout(400)
  const value = await page.inputValue('input.cfield')
  const placeholder = await page.getAttribute('input.cfield', 'placeholder')
  const log = await page.evaluate(() => window.__log)
  const press = log.find(l => l.e === 'mic-press')
  const first = log.find(l => l.e === 'first-interim')
  console.log(JSON.stringify({
    mode, value, placeholder,
    firstInterimFromPressMs: first && press ? first.t - press.t : null,
    interimText: first?.text ?? null,
  }, null, 2))
  await shot(`${mode}-after`)
} else if (mode === 'cmdD') {
  await page.locator('.cmic').waitFor({ timeout: 8000 })
  await page.keyboard.press('Meta+KeyD')
  await page.waitForTimeout(2500)
  const activeClass = await page.getAttribute('button.cmic', 'class')
  await page.keyboard.press('Meta+KeyD')
  await page.waitForTimeout(1500)
  const afterClass = await page.getAttribute('button.cmic', 'class')
  console.log(JSON.stringify({ mode, activeClass, afterClass }))
} else if (mode === 'liveFull') {
  // Full escalation round trip at any viewport: speak → escalate → broker
  // runs in the chat pane → loop speaks the [work result] summary.
  await page.locator('.clive').waitFor({ timeout: 8000 })
  await page.locator('.clive').click()
  await page.locator('.wb-live-card').waitFor({ timeout: 5000 })
  await shot(`liveFull-open-${VIEW.width}`)
  await page.waitForTimeout(15000) // turn 1: hear, escalate, ack
  await shot(`liveFull-escalated-${VIEW.width}`)
  // Wait for the broker turn to land and the loop to speak the summary:
  // a speak-called AFTER the first batch, while the loop shows Listening.
  const t0 = Date.now()
  let summarySpoken = null
  while (Date.now() - t0 < 150000) {
    const log = await page.evaluate(() => window.__log)
    const speaks = log.filter(l => l.e === 'speak-called')
    if (speaks.length > 1 && Date.now() - speaks[speaks.length - 1].t < 4000
        && speaks[speaks.length - 1].t - speaks[0].t > 8000) {
      summarySpoken = speaks[speaks.length - 1]
      break
    }
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(3000)
  await shot(`liveFull-summary-${VIEW.width}`)
  const log = await page.evaluate(() => window.__log)
  const lastText = await page.locator('.wb-live-last').textContent().catch(() => null)
  const asst = await page.locator('.wb-turn.asst').last().textContent().catch(() => null)
  console.log(JSON.stringify({ mode, viewport: VIEW, summarySpoken, lastText, brokerReplyTail: (asst ?? '').slice(-200), log }, null, 2))
  await page.locator('.sheet-btn.cancel').click()
} else if (mode === 'live') {
  await page.locator('.clive').waitFor({ timeout: 8000 })
  await page.locator('.clive').click()
  await page.locator('.wb-live-card').waitFor({ timeout: 5000 })
  await shot(`live-open-${VIEW.width}`)
  // Let a full loop turn run: clip (~6s) + EOU + fast turn + speech.
  await page.waitForTimeout(22000)
  await shot(`live-after-turn-${VIEW.width}`)
  const log = await page.evaluate(() => window.__log)
  const lastText = await page.locator('.wb-live-last').textContent().catch(() => null)
  const chatUser = await page.locator('.wb-turn.user').last().textContent().catch(() => null)
  console.log(JSON.stringify({ mode, viewport: VIEW, lastText, chatUser, log }, null, 2))
  // Exit is one tap.
  await page.locator('.sheet-btn.cancel').click()
  const gone = await page.locator('.wb-live-card').count()
  console.log(JSON.stringify({ sheetClosedByOneTap: gone === 0 }))
}
await browser.close()
