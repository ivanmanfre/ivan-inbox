// Verifies the TTS leg is really measurable: does speechSynthesis produce AUDIO
// on the loopback, and how far does the `start` event sit from the first audible
// sample? That gap is exactly the error in using `start` as a proxy.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, 'raw')
const SW = '/opt/homebrew/bin/SwitchAudioSource'
const prevIn = execFileSync(SW, ['-c', '-t', 'input']).toString().trim()
const prevOut = execFileSync(SW, ['-c', '-t', 'output']).toString().trim()
let restored = false
const restore = () => { if (restored) return; restored = true
  try { execFileSync(SW, ['-s', prevIn, '-t', 'input']) } catch {}
  try { execFileSync(SW, ['-s', prevOut, '-t', 'output']) } catch {} }
process.on('exit', restore); process.on('SIGINT', () => { restore(); process.exit(1) })

const srv = http.createServer((q, r) => {
  const f = q.url === '/' ? 'harness.html' : q.url.slice(1).split('?')[0]
  const p = path.join(HERE, 'build', f)
  if (!fs.existsSync(p)) { r.writeHead(404); return r.end() }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' })
  r.end(fs.readFileSync(p))
}).listen(5315)
await new Promise(r => srv.once('listening', r))
execFileSync(SW, ['-s', 'BlackHole 2ch', '-t', 'input'])
execFileSync(SW, ['-s', 'BlackHole 2ch', '-t', 'output'])

const REPLY = 'Done. The top draft is approved and live in the queue.'
const runs = []
try {
  for (let i = 0; i < 5; i++) {
    const browser = await chromium.launch({ headless: false, channel: 'chrome',
      args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
    const ctx = await browser.newContext({ permissions: ['microphone'] })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5315/'); await page.waitForFunction('window.__ready===true')
    await page.evaluate(o => window.__prepare(o), { replyText: REPLY })
    await page.click('#mic')                       // real gesture => unlockAudio()
    await new Promise(r => setTimeout(r, 500))
    const why = await page.evaluate(t => window.__speakOnly(t), REPLY)
    const d = await page.evaluate('window.__dump()')
    await browser.close()
    const at = k => { const e = d.EV.find(x => x.k === k); return e ? e.t : null }
    const called = at('tts:speak-called'), started = at('tts:utterance-start'), ended = at('tts:end')
    // noise floor from before speak was called
    const pre = d.AC.filter(b => b.t < called - 50).map(b => b.rms).sort((a, b) => a - b)
    const floor = pre.length ? pre[Math.floor(pre.length * 0.9)] : 0
    const gate = Math.max(floor * 8, 0.006)
    const firstAudible = d.AC.find(b => b.t > called && b.rms >= gate)
    runs.push({ why, voices: at('voices') != null ? d.EV.find(e => e.k === 'voices').v : null,
      called, started, ended, floor, gate, peak: Math.max(...d.AC.map(b => b.rms)),
      firstAudible: firstAudible ? firstAudible.t : null,
      called_to_start_ms: started != null ? +(started - called).toFixed(1) : null,
      called_to_audible_ms: firstAudible ? +(firstAudible.t - called).toFixed(1) : null,
      startEvent_to_audible_ms: firstAudible && started != null ? +(firstAudible.t - started).toFixed(1) : null })
    console.log(JSON.stringify(runs.at(-1)))
  }
} finally { srv.close(); restore() }
fs.writeFileSync(path.join(OUT, 'diag-tts.json'), JSON.stringify(runs, null, 2))
