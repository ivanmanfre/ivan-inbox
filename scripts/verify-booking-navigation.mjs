import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const session = readFileSync(process.env.INBOX_TEST_SESSION, 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(s => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    localStorage.setItem('brain-b-place', 'ask')
  }, session)
  const now = new Date().toISOString()
  // A fixed booking makes this independent of whatever reaches the live feed
  // while the check runs. Neither the feed read nor its receipt touches data.
  await page.route('**/rest/v1/inbox_notifications*', async route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 204 })
    return route.fulfill({ json: [{
      id: '11111111-1111-4111-8111-111111111111', family: 'booking_notice',
      title: 'RISE booking', body: 'Booking navigation fixture',
      url: './#exp/brain-b/ops', tenant: 'rise', count: 1,
      created_at: now, last_seen_at: now, read_at: null, dismissed_at: null,
      group_key: null, media: null,
    }] })
  })
  const base = process.env.INBOX_TEST_URL ?? 'http://127.0.0.1:5194/'
  await page.goto(`${base}#exp/brain-b/ops`)
  await page.getByRole('button', { name: /^Ops/ }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-ds="Tab"][data-active="true"]')?.textContent.includes('Ops'))
  console.log('PASS: cold booking link opens Ops')
  await page.getByRole('button', { name: /^Ask/ }).click()
  // Opening a feed card must select its destination even if Shell.job is
  // already Ops behind Ask.
  await page.getByRole('button', { name: /^Feed, / }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await page.waitForTimeout(500)
  assert.match(await page.locator('[data-ds="Tab"][data-active="true"]').innerText(), /Ops/,
    'Opening the booking from the feed must leave Ask even when Ops was the previous job')
  console.log('PASS: feed booking opens Ops from Ask')
  await page.getByRole('button', { name: /^Ask/ }).click()
  await page.evaluate(() => { history.replaceState(null, '', '#exp/brain-b/ask') })
  await page.evaluate(() => { location.hash = '#exp/brain-b/ops' })
  await page.waitForTimeout(1000)
  const active = await page.locator('[data-ds="Tab"][data-active="true"]').innerText()
  assert.match(active, /Ops/, 'A booking link must leave Ask and select Ops in an already-open phone app')
  console.log('PASS: warm booking link leaves Ask and opens Ops')
  await page.screenshot({ path: '/tmp/booking-navigation-phone.png' })
} finally {
  await browser.close()
}
