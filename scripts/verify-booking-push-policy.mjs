// Replay the actual relay code with captured configuration. All network calls
// are stubbed: this never creates a notification or sends a push.
import fs from 'node:fs'
import assert from 'node:assert/strict'

const code = fs.readFileSync(process.env.INBOX_RELAY_CODE, 'utf8')
const [{ value }] = JSON.parse(fs.readFileSync(process.env.INBOX_FAMILY_MAP, 'utf8'))
const run = new (Object.getPrototypeOf(async function () {}).constructor)('$', code)
const secrets = {
  wa_evolution_apikey: 'test', inbox_family_map: value,
  inbox_wa_cut: '["*"]', inbox_notify_url: 'https://test.invalid/notify',
}
const cases = [
  ['siEM4bDSfevuVCII', '📊 RISE booking attribution — 1 attributed', false],
  ['siEM4bDSfevuVCII', '📊 RISE booking attribution — 3 attributed', false],
  ['siEM4bDSfevuVCII', '📊 RISE booking attribution — unattributed', false],
  ['siEM4bDSfevuVCII', '📊 RISE booking attribution', true],
  ['siEM4bDSfevuVCII', '⚠ RISE booking attribution: HubSpot failed', true],
  ['helJXFCyt2phq5V3', '🔗 RISE — booking from our outreach', true],
  ['IBEhtM47QOlroNdo', '📊 Ivan booking attribution', false],
  ['wyJZ9TcGul7QvDEz', '[ARCH] 📊 ARCH booking attribution — 1 attributed', true],
]
for (const [src, title, push] of cases) {
  let payload
  const $ = name => name === 'Secrets'
    ? { all: () => Object.entries(secrets).map(([key, value]) => ({ json: { key, value } })) }
    : { first: () => ({ json: { headers: { apikey: 'test' }, query: { src }, body: { text: title } } }) }
  await run.call({ helpers: { httpRequest: async req => {
    if (req.url === secrets.inbox_notify_url) payload = req.body
    return { id: 'test' }
  } } }, $)
  assert.ok(payload, 'The notification must still enter the feed')
  assert.equal(payload.push ?? payload.family === 'booking_notice', push, title)
  assert.equal(payload.url, './#exp/brain-b/ops')
  console.log(`PASS: ${push ? 'push' : 'feed only'}: ${title}`)
}
