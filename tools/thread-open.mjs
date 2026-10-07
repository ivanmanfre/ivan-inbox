// Current DMs deploy smoke. Sequential phone + desktop, with every write blocked.
// node tools/thread-open.mjs <baseUrl> [chromium|webkit|firefox]
// THREAD_SESSION_PATH is a private Supabase session file. THREAD_OUT and
// THREAD_SESSION_OUT, if supplied, must name NEW files (never overwritten).
// THREAD_FAILURE_PREFIX optionally names a NEW private screenshot prefix;
// a failure at 390px writes <prefix>-390.png before its context is closed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium, webkit, firefox } from 'playwright'

// Begin live-history helpers (also exercised by the offline receipt fixture).
function responseMessages(status, payload) {
  if (status < 200 || status >= 300 || !Array.isArray(payload)) return []
  return payload.filter(m => m && typeof m.id === 'string' && typeof m.prospect_id === 'string' && typeof m.message_text === 'string'
    && Object.hasOwn(m, 'client_id') && (m.client_id === null || typeof m.client_id === 'string') && ['inbound', 'outbound'].includes(m.direction))
}
function messageSeat(clientId) {
  const id = (clientId ?? '').trim().toLowerCase()
  return id === '' || id === 'ivan' ? 'ivan' : id === 'rise' || id === 'risedtc' ? 'risedtc' : id === 'arch' ? 'arch' : null
}
function eligibleMessage(m, prospectId, seat) {
  return m.prospect_id === prospectId && messageSeat(m.client_id) === seat && m.message_text.trim().length > 0
    && m.send_blocked_reason !== 'discarded_in_inbox' && (m.direction === 'inbound' || m.direction === 'outbound' && Boolean(m.sent_at || m.approved_at))
}
function verifiedBubble(bubble, messages, prospectId, seat) {
  const m = messages.get(bubble.id)
  if (!m || !eligibleMessage(m, prospectId, seat)) return false
  const normalize = text => text.replace(/\s+/g, ' ').trim()
  const shown = normalize(bubble.text)
  if (!shown) return false
  // History splits outbound replies at delimiter-only lines; inbound stays whole.
  const parts = (m.direction === 'outbound' ? m.message_text.split(/^[ \t]*-{3,}[ \t\r]*$/m) : [m.message_text]).map(normalize).filter(Boolean)
  if (parts.includes(shown)) return true
  const fragment = shown.replace(/(?:…|\.{3})$/, '').trim()
  return /(?:…|\.{3})$/.test(shown) && fragment.length >= 24 && parts.some(part => part.startsWith(fragment))
}
// End live-history helpers.

const [base = 'http://localhost:4173/', engine = 'chromium'] = process.argv.slice(2)
const seat = process.env.THREAD_SEAT || 'ivan'
assert(['ivan', 'risedtc', 'arch'].includes(seat), 'Unknown smoke seat')
const engines = { chromium, webkit, firefox }
assert(engines[engine], 'Unknown browser engine')
const authKey = 'sb-bjbvqvzbzczjbatgmccb-auth-token'
let session = readFileSync(process.env.THREAD_SESSION_PATH || new URL('../.session.json', import.meta.url), 'utf8')
assert(JSON.parse(session).access_token, 'Smoke session has no access token')
const readRpcs = new Set(['inbox_changed_since', 'inbox_interest_cards', 'inbox_followup_sources', 'warm_signal_cards', 'conversation_agent_cards',
  // Reply-source reads (db/20261007_reply_sources.sql): STABLE security-definer functions, no writes.
  'inbox_reply_source', 'outreach_reply_sources', 'client_board_reply_source', 'client_board_reply_sources'])
const replySourceRpcs = new Set(['inbox_reply_source', 'outreach_reply_sources', 'client_board_reply_source', 'client_board_reply_sources'])
function missingReplySource(url, method, status, payload) {
  const u = new URL(url)
  return method === 'POST' && u.hostname === 'bjbvqvzbzczjbatgmccb.supabase.co'
    && u.pathname.startsWith('/rest/v1/rpc/') && replySourceRpcs.has(u.pathname.slice('/rest/v1/rpc/'.length))
    && status === 404 && payload?.code === 'PGRST202'
}
const report = { ok: false, engine, seat, checks: [], failure: null }
let browser
try {
  browser = await engines[engine].launch()
  for (const width of [390, 1440]) {
    const phone = width === 390
    const context = await browser.newContext({ viewport: { width, height: phone ? 852 : 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' })
    let page
    try {
      page = await context.newPage()
      const errors = [], forbidden = []
      const resourceErrors = [], missing404s = new Map()
      const messages = new Map(), pendingReads = new Set(), failedReads = []
      let successfulReads = 0
      let clickedId = null, readStamps = 0
      const isMessageGet = req => {
        const url = new URL(req.url())
        return req.method() === 'GET' && url.hostname === 'bjbvqvzbzczjbatgmccb.supabase.co' && ['/rest/v1/inbox_messages_v', '/rest/v1/outreach_messages'].includes(url.pathname)
      }
      // Installed before navigation: includes the cold-load preload, not just
      // requests caused by opening the pane. Bodies stay in this context's memory.
      page.on('response', response => {
        // The reply-source migration can be intentionally absent. Confirm the
        // exact 404 body before excusing its browser-generated console error.
        if (response.status() === 404) {
          const reading = response.json().then(payload => {
            if (missingReplySource(response.url(), response.request().method(), response.status(), payload)) {
              missing404s.set(response.url(), (missing404s.get(response.url()) || 0) + 1)
            }
          }).catch(() => {})
          pendingReads.add(reading)
          void reading.finally(() => pendingReads.delete(reading))
        }
        if (!isMessageGet(response.request())) return
        const reading = (async () => {
          if (!response.ok()) { failedReads.push(`HTTP ${response.status()}`); return }
          const payload = await response.json()
          if (!Array.isArray(payload)) { failedReads.push('invalid inbox payload'); return }
          successfulReads++
          for (const m of responseMessages(response.status(), payload)) messages.set(m.id, m)
        })().catch(() => { failedReads.push('unreadable inbox response') })
        pendingReads.add(reading)
        void reading.finally(() => pendingReads.delete(reading))
      })
      page.on('requestfailed', req => { if (isMessageGet(req)) failedReads.push('inbox request failed') })
      page.on('pageerror', () => errors.push('uncaught page error'))
      page.on('console', m => {
        if (m.type() !== 'error') return
        if (/^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(m.text())) resourceErrors.push(m.location().url)
        else errors.push('console error')
      })
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), method = req.method()
        if (url.hostname === 'bjbvqvzbzczjbatgmccb.supabase.co') {
          if (method === 'PATCH' && url.pathname === '/rest/v1/outreach_messages') {
            let body
            try { body = req.postDataJSON() } catch { body = null }
            if (clickedId && url.searchParams.get('prospect_id') === `eq.${clickedId}` && url.searchParams.get('direction') === 'eq.inbound' && url.searchParams.get('read_at') === 'is.null' && body && Object.keys(body).length === 1 && typeof body.read_at === 'string') {
              readStamps++
              return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(base).origin } })
            }
          }
          if (url.pathname.startsWith('/functions/')) {
            forbidden.push(`${method} edge function`)
            return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Smoke blocked an edge function"}' })
          }
          if (method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return route.continue()
          if (method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/') && readRpcs.has(url.pathname.split('/').pop())) return route.continue()
        }
        if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue()
        forbidden.push(`${method} ${url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[id]')}`)
        return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Smoke blocked a mutation"}' })
      })
      await page.addInitScript(({ session, authKey, seat }) => {
        localStorage.setItem(authKey, session)
        localStorage.setItem('d.dms.folds.v1', JSON.stringify({ all: true }))
        localStorage.removeItem('dms-filter-tokens')
        sessionStorage.setItem('dm-smoke-seat', seat)
      }, { session, authKey, seat })
      await page.goto(`${base.replace(/#.*$/, '')}#exp/d/dms?seat=${seat}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(document.querySelector('.dm-page, .login')), undefined, { timeout: 45_000 })
      assert.equal(await page.locator('.login').count(), 0, 'Auth failure: login is visible')
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.dm-list [data-d-row]')).some(e => e.getBoundingClientRect().height > 0), undefined, { timeout: 45_000 })
      const visibleRows = page.locator('.dm-list [data-d-row]:visible')
      const rows = await visibleRows.count()
      assert(rows > 0, 'Known nonempty DMs returned no conversation rows')
      // A legitimate first draft can have no history. Choose a visible row
      // whose nonempty history belongs to this seat in a successful live read.
      let row
      const deadline = Date.now() + 45_000
      while (!row && Date.now() < deadline) {
        await Promise.all([...pendingReads])
        assert.equal(failedReads.length, 0, `Live inbox read failed: ${failedReads.join(', ')}`)
        const ids = await visibleRows.evaluateAll(els => els.map(el => el.getAttribute('data-d-row')))
        const index = ids.findIndex(id => [...messages.values()].some(m => eligibleMessage(m, id, seat)))
        if (index >= 0) row = visibleRows.nth(index)
        else await page.waitForTimeout(200)
      }
      assert(successfulReads > 0, 'No successful live inbox GET was captured')
      assert(row, 'No visible conversation has nonempty live history for this seat')
      clickedId = await row.getAttribute('data-d-row')
      assert(clickedId, 'Conversation row has no identity')
      const name = await row.locator('.dm-n').evaluate(el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim())
      assert(name, 'Conversation row has no person label')
      await row.click()
      // All conversations first expands an inline history. Its Open enters the pane.
      const inline = page.locator('.dm-xlog').filter({ has: page.locator('[data-verb="open-thread"]') })
      if (!new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '').get('thread') && await inline.count()) await inline.locator('[data-verb="open-thread"]').first().click()
      await page.waitForFunction(id => new URLSearchParams(location.hash.split('?')[1] || '').get('thread') === id, clickedId, { timeout: 15_000 })
      const pane = page.getByRole('region', { name: `Conversation with ${name}`, exact: true })
      await pane.waitFor({ state: 'visible', timeout: 15_000 })
      assert(await pane.locator('.dm-hist [data-msg]:visible').count() > 0, 'Open pane has no visible conversation history')
      await Promise.all([...pendingReads])
      const bubbles = await pane.locator('.dm-hist [data-msg]:visible .dm-bub:visible').evaluateAll(els => els.map(el => ({ id: el.closest('[data-msg]')?.getAttribute('data-msg'), text: el.textContent || '' })))
      const verified = bubbles.find(b => verifiedBubble(b, messages, clickedId, seat))
      assert(verified, 'Visible history did not match a live message ID, owner and real body fragment')
      const verifiedMessage = messages.get(verified.id)
      assert((await pane.innerText()).trim().length > 0, 'Open pane is blank')
      const control = pane.locator(`[data-verb="${phone ? 'back' : 'close'}"]`)
      assert.equal(await control.count(), 1, 'Open pane lost Back or Close')
      if (phone) assert.equal(await page.locator('.dm-phone-thread').count(), 1, 'Phone thread takeover missing')
      await control.click()
      await page.waitForFunction(() => !new URLSearchParams(location.hash.split('?')[1] || '').get('thread'), undefined, { timeout: 15_000 })
      await page.locator('.dm-list').waitFor({ state: 'visible' })
      await page.waitForTimeout(300)
      assert.equal(await page.locator('.login').count(), 0, 'Auth regressed after thread close')
      assert((await page.locator('body').innerText()).trim().length > 0, 'App became blank')
      await Promise.all([...pendingReads])
      assert.equal(failedReads.length, 0, `Live inbox read failed: ${failedReads.join(', ')}`)
      assert.equal(forbidden.length, 0, `Unexpected mutation was blocked: ${forbidden.join(', ')}`)
      // Match one console event to one verified response. Other 404s, error
      // codes, endpoints and application console errors remain fatal.
      for (const url of resourceErrors) {
        const count = missing404s.get(url) || 0
        if (count) missing404s.set(url, count - 1)
        else errors.push('console error')
      }
      assert.equal(errors.length, 0, `Console/page errors: ${errors.join(' | ')}`)
      session = await page.evaluate(key => localStorage.getItem(key), authKey) || session
      report.checks.push({ width, rows, threadHash: createHash('sha256').update(clickedId).digest('hex').slice(0, 12), verifiedMessageHash: createHash('sha256').update(verified.id).digest('hex').slice(0, 12), verifiedBodyHash: createHash('sha256').update(verifiedMessage.message_text).digest('hex'), successfulInboxGets: successfulReads, opened: true, returnedToList: true, mockedReadStamps: readStamps, consoleErrors: errors.length, forbiddenWrites: forbidden.length })
    } catch (e) {
      if (page && process.env.THREAD_FAILURE_PREFIX) {
        const target = `${process.env.THREAD_FAILURE_PREFIX}-${width}.png`
        try {
          assert(!existsSync(target), 'Failure screenshot output already exists')
          writeFileSync(target, await page.screenshot({ fullPage: true }), { flag: 'wx', mode: 0o600 })
          report.failureScreenshot = target
        } catch (captureError) { report.screenshotFailure = captureError instanceof Error ? captureError.message : String(captureError) }
      }
      throw e
    } finally { await context.close() }
  }
  report.ok = true
} catch (e) {
  report.failure = e instanceof Error && !e.message.includes('Call log:') ? e.message : 'A browser action failed; inspect the private failure capture.'
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (process.env.THREAD_SESSION_OUT) writeFileSync(process.env.THREAD_SESSION_OUT, session, { flag: 'wx', mode: 0o600 })
  if (process.env.THREAD_OUT) writeFileSync(process.env.THREAD_OUT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(report))
}
