// Second probe: spawn the real Chrome binary ourselves so we can capture its
// STDERR verbose log, then attach over CDP. This is what distinguishes
// "the speech backend is unreachable" from "the fake audio device never reaches
// the recogniser" — the two hypotheses the first probe could not separate.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const wav = process.argv[2]
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'raw')
fs.mkdirSync(OUT, { recursive: true })

const PAGE = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'probe-page.html'), 'utf8')
const srv = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE) }).listen(5312)
await new Promise(r => srv.once('listening', r))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-probe-'))
const bin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const child = spawn(bin, [
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required',
  '--enable-logging=stderr', '--v=1',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const lines = []
for (const s of [child.stdout, child.stderr]) s.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(l) })

await new Promise(r => setTimeout(r, 3000))
const browser = await chromium.connectOverCDP('http://localhost:9333')
const ctx = browser.contexts()[0]
const page = await ctx.newPage()
await page.goto('http://localhost:5312/')
const why = await page.evaluate('window.__probe()')
const log = await page.evaluate('window.__log')
await new Promise(r => setTimeout(r, 800))

const keep = lines.filter(l => /speech|Speech|SODA|soda|audio_capture|FakeAudio|media.*capture|recogni/i.test(l))
fs.writeFileSync(path.join(OUT, 'probe-chrome-verboselog.json'),
  JSON.stringify({ wav, why, log, speechRelatedLogLines: keep, totalLogLines: lines.length }, null, 2))
fs.writeFileSync(path.join(OUT, 'probe-chrome-stderr-full.log'), lines.join('\n'))
console.log(JSON.stringify({ why, log: log.map(l => `${l.t.toFixed(0)} ${l.k} ${JSON.stringify(l.v ?? null)}`), speechLines: keep.slice(0, 60), totalLogLines: lines.length }, null, 2))
await browser.close(); child.kill('SIGKILL'); srv.close()
