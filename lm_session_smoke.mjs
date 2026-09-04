import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2]; // repo root to serve
const LANDING_PATH = process.argv[3]; // e.g. /the-linkedin-inbound-team/
const TOOL_PATH = process.argv[4]; // e.g. /the-meaning-audit-does-your-brand-give-people-a-reason-to-care/

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(ROOT, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise(r => server.listen(8934, r));
console.log('serving', ROOT, 'on :8934');

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const captured = [];
await page.route('**/functions/v1/lm-beacon', route => {
  const body = route.request().postData();
  try { captured.push(JSON.parse(body)); } catch (e) { captured.push({ parse_error: String(e), raw: body }); }
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});

// Force src=ci_smoke on both loads so if this ever hit the live edge fn, is_test=true fires
await page.goto(`http://localhost:8934${LANDING_PATH}?src=ci_smoke`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.goto(`http://localhost:8934${TOOL_PATH}?src=ci_smoke`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
// trigger a view beacon on the tool page explicitly if not auto-fired — most fire on load already

await browser.close();
server.close();

console.log('CAPTURED_EVENTS=' + captured.length);
for (const c of captured) {
  console.log(JSON.stringify({ lm_slug: c.lm_slug, event_type: c.event_type, session_id: c.session_id, src: c.src }));
}

const sessionIds = [...new Set(captured.map(c => c.session_id).filter(Boolean))];
console.log('DISTINCT_NON_NULL_SESSION_IDS=' + sessionIds.length, JSON.stringify(sessionIds));
const anyNull = captured.some(c => !c.session_id);
console.log('ANY_NULL_SESSION_ID=' + anyNull);
