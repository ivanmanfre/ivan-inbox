// PHASE 4 voice measurement harness.
//
// Path (established empirically by probe.mjs / probe-logs.mjs / probe-blackhole.mjs):
//   real Google Chrome, headed, REAL devices. --use-file-for-fake-audio-capture is
//   useless here: Chrome's SpeechRecognition opens the default hardware input
//   directly and never touches the fake MediaStream device. So the fixture is
//   played into BlackHole 2ch's output, BlackHole loops it to its input, and
//   BlackHole is made the system default input for the duration of the run.
//
// Real vs stubbed, stated once and enforced by construction:
//   REAL  — audio in, webkitSpeechRecognition, Google speech backend, the reducer
//           from src/exp/v2c/chat/voice.ts, speechSynthesis, and an ACOUSTIC
//           measurement of first-audible taken off the loopback.
//   STUB  — the chat turn itself (SENDING -> turn-done). The broker is unarmed, so
//           upstream latency is set to 0 and every latency below is LOCAL-ONLY.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, 'raw'); fs.mkdirSync(OUT, { recursive: true })
const FIX = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-fixtures'
const REFS = JSON.parse(fs.readFileSync(path.join(FIX, 'transcripts.json'), 'utf8'))
const SW = '/opt/homebrew/bin/SwitchAudioSource'
const BH = 'BlackHole 2ch'
const BH_OUT_INDEX = '1'   // established by loopback sweep, see raw/device-index-sweep.txt

// A short reply, as the mission target specifies ("a short reply").
const REPLY = 'Done. The top draft is approved and live in the queue.'

// ---------------------------------------------------------------------------
// WER. Levenshtein over WORDS, with the normalisation stated explicitly:
//   lowercase; strip every character that is not a letter, digit or apostrophe;
//   collapse whitespace. So "n8n" survives, "Mattan's" -> "mattan's", and
//   punctuation/casing never counts as an error.
// ---------------------------------------------------------------------------
export function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
export function wer(ref, hyp) {
  const R = normalize(ref).split(' ').filter(Boolean)
  const H = normalize(hyp).split(' ').filter(Boolean)
  // dp[i][j] = {cost, s, i, d} for ref[0..i) vs hyp[0..j)
  const dp = Array.from({ length: R.length + 1 }, () => Array(H.length + 1).fill(null))
  dp[0][0] = { cost: 0, s: 0, i: 0, d: 0 }
  for (let j = 1; j <= H.length; j++) dp[0][j] = { cost: j, s: 0, i: j, d: 0 }
  for (let i = 1; i <= R.length; i++) dp[i][0] = { cost: i, s: 0, i: 0, d: i }
  for (let i = 1; i <= R.length; i++) {
    for (let j = 1; j <= H.length; j++) {
      const match = R[i - 1] === H[j - 1]
      const sub = { ...dp[i - 1][j - 1], cost: dp[i - 1][j - 1].cost + (match ? 0 : 1), s: dp[i - 1][j - 1].s + (match ? 0 : 1) }
      const ins = { ...dp[i][j - 1], cost: dp[i][j - 1].cost + 1, i: dp[i][j - 1].i + 1 }
      const del = { ...dp[i - 1][j], cost: dp[i - 1][j].cost + 1, d: dp[i - 1][j].d + 1 }
      dp[i][j] = [sub, ins, del].reduce((a, b) => (b.cost < a.cost ? b : a))
    }
  }
  const r = dp[R.length][H.length]
  return { refWords: R.length, hypWords: H.length, S: r.s, I: r.i, D: r.d,
           errors: r.cost, wer: R.length ? r.cost / R.length : (H.length ? 1 : 0) }
}

// ---------------------------------------------------------------------------
// Acoustic segmentation of the loopback trace.
// Noise floor is taken from the trace BEFORE the fixture starts; the gate is
// max(8x floor, 0.006 RMS). A segment must hold for >=3 blocks (~32ms) to count,
// and a gap must hold for >=15 blocks (~160ms) to close a segment — otherwise
// inter-word stops would each read as an utterance end.
// ---------------------------------------------------------------------------
function segments(AC, { floorEnd, gate: gateIn }) {
  const floorBlocks = AC.filter(b => b.t < floorEnd).map(b => b.rms).sort((a, b) => a - b)
  const floor = floorBlocks.length ? floorBlocks[Math.floor(floorBlocks.length * 0.9)] : 0
  const gate = gateIn ?? Math.max(floor * 8, 0.006)
  const segs = []
  let cur = null, gap = 0
  for (const b of AC) {
    if (b.rms >= gate) { if (!cur) cur = { start: b.t, end: b.t, n: 0, peak: 0 }; cur.end = b.t; cur.n++; cur.peak = Math.max(cur.peak, b.rms); gap = 0 }
    else if (cur) { gap++; if (gap >= 15) { if (cur.n >= 3) segs.push(cur); cur = null; gap = 0 } }
  }
  if (cur && cur.n >= 3) segs.push(cur)
  return { floor, gate, segs }
}

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const only = argv.filter(a => !a.startsWith('--'))
const MODE = argv.includes('--nospeech') ? 'nospeech' : argv.includes('--error') ? 'error' : 'turn'
// The app as written sets continuous=false (useVoice.ts:118). --continuous runs
// the one-line variant so both can be measured rather than argued about.
const CONTINUOUS = argv.includes('--continuous')
const FIXDIR = argv.includes('--padded') ? 'padded' : 'roomtone'
const FIXTURES = only.length ? only : ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9_noisy', 'f10_fast']

const prevIn = execFileSync(SW, ['-c', '-t', 'input']).toString().trim()
const prevOut = execFileSync(SW, ['-c', '-t', 'output']).toString().trim()
let restored = false
const restore = () => { if (restored) return; restored = true
  try { execFileSync(SW, ['-s', prevIn, '-t', 'input']) } catch {}
  try { execFileSync(SW, ['-s', prevOut, '-t', 'output']) } catch {} }
process.on('exit', restore)
process.on('SIGINT', () => { restore(); process.exit(1) })
process.on('uncaughtException', e => { restore(); console.error(e); process.exit(1) })

const srv = http.createServer((q, r) => {
  const f = q.url === '/' ? 'harness.html' : q.url.slice(1).split('?')[0]
  const p = path.join(HERE, 'build', f)
  if (!fs.existsSync(p)) { r.writeHead(404); return r.end('nope') }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' })
  r.end(fs.readFileSync(p))
}).listen(5311)
await new Promise(r => srv.once('listening', r))

// ONLY the default INPUT moves to BlackHole. The default OUTPUT is deliberately
// left alone: routing system output through BlackHole too would have made the
// loopback carry every other sound on the machine (it did — Music.app was
// playing, raising the "silence" floor to ~0.05 RMS and making the gate
// meaningless; see raw/diag-tts-trace.json). With output untouched, BlackHole's
// input carries the fixture and nothing else, so utterance-end is measured off a
// clean signal. The cost is that TTS no longer loops back, so first-audible is
// the `start` event PROXY rather than an acoustic measurement — labelled as such
// everywhere it appears.
execFileSync(SW, ['-s', BH, '-t', 'input'])
console.error(`devices: in ${prevIn} -> ${BH} | out ${prevOut} (untouched)`)

const chromeArgs = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
if (MODE === 'error') chromeArgs.push('--host-resolver-rules=MAP www.google.com 127.0.0.1')

const results = []
try {
  for (const fx of FIXTURES) {
    const wav = path.join(FIX, FIXDIR, `${fx}.wav`)
    if (MODE === 'turn' && !fs.existsSync(wav)) { console.error(`skip ${fx}: no wav`); continue }
    // A fresh browser per fixture: one recognition session per process, so no
    // carry-over of the speech backend's session state between fixtures.
    const browser = await chromium.launch({ headless: false, channel: 'chrome', args: chromeArgs })
    const ctx = await browser.newContext({ permissions: ['microphone'] })
    const page = await ctx.newPage()
    const pageErrors = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    await page.goto('http://localhost:5311/')
    await page.waitForFunction('window.__ready === true')

    const stopAt = MODE === 'turn' ? ['IDLE', 'ERROR'] : ['PAUSED', 'ERROR', 'IDLE']
    await page.evaluate(o => window.__prepare(o), {
      replyText: REPLY, upstreamStubMs: 0, spokenReplies: MODE === 'turn',
      handsFree: false, continuous: CONTINUOUS, stopAt, settleMs: 600,
      timeoutMs: MODE === 'turn' ? 30000 : 45000,
    })
    const voices = await page.evaluate('window.__voices()')
    await new Promise(r => setTimeout(r, 400))   // let the noise floor accumulate

    const waiting = page.evaluate('window.__await()')
    await page.click('#mic')                      // real gesture: unlockAudio then arm
    let playAt = null
    if (MODE === 'turn') {
      await new Promise(r => setTimeout(r, 900))  // recognition is up before audio starts
      playAt = Date.now()
      spawn('/opt/homebrew/bin/ffmpeg',
        ['-nostdin', '-loglevel', 'error', '-re', '-i', wav, '-f', 'audiotoolbox', '-audio_device_index', BH_OUT_INDEX, '-'],
        { stdio: 'ignore' })
    }
    const why = await waiting
    const dump = await page.evaluate('window.__dump()')
    await browser.close()

    results.push(analyse({ fixture: fx, mode: MODE, continuous: CONTINUOUS, fixdir: FIXDIR, wav, why, voices, pageErrors, ...dump }))
    console.error(`${fx}: ${why} — ${JSON.stringify(results.at(-1).summary)}`)
  }
} finally {
  srv.close(); restore()
  console.error(`devices restored: in=${execFileSync(SW, ['-c', '-t', 'input']).toString().trim()} out=${execFileSync(SW, ['-c', '-t', 'output']).toString().trim()}`)
}

function analyse(r) {
  const at = k => { const e = r.EV.find(x => x.k === k); return e ? e.t : null }
  const all = k => r.EV.filter(x => x.k === k)
  const armT = at('arm-click')
  const finalT = at('rec:final')
  const speakCalledT = at('tts:speak-called')
  const utterStartT = at('tts:utterance-start')     // PROXY for first audible
  const recSpeechEndT = at('rec:speechend')

  // Acoustic: floor from before the fixture could possibly have started.
  const { floor, gate, segs } = segments(r.AC, { floorEnd: (armT ?? 0) + 200 })
  // The fixture segment is the last speech segment that ENDS before the final
  // result; the TTS segment is the first that STARTS after speak was called.
  const fixtureSegs = segs.filter(s => finalT != null && s.start < finalT)
  const fixtureSeg = fixtureSegs.length
    ? { start: fixtureSegs[0].start, end: Math.max(...fixtureSegs.map(s => s.end)), peak: Math.max(...fixtureSegs.map(s => s.peak)) }
    : null
  // TTS does NOT loop back (default output untouched, see above), so there is no
  // acoustic TTS segment to find. first-audible below is the `start` event PROXY.
  const ttsSeg = null

  const uEndAcoustic = fixtureSeg ? fixtureSeg.end : null
  const firstAudibleAcoustic = ttsSeg ? ttsSeg.start : null

  const ms = (a, b) => (a != null && b != null ? +(b - a).toFixed(1) : null)
  // What the APP keeps (useVoice.ts:127-147 accumulates only from e.resultIndex)
  const hyp = (r.EV.filter(e => e.k === 'rec:final').at(-1)?.v?.text) ?? ''
  // What CHROME actually finalised, all segments — observation only.
  const heardAll = (r.EV.filter(e => e.k === 'rec:all-finals').at(-1)?.v?.text) ?? ''
  const ref = REFS[r.fixture] ?? ''
  const w = r.mode === 'turn' ? wer(ref, hyp) : null
  const wAll = r.mode === 'turn' ? wer(ref, heardAll) : null

  return {
    ...r,
    transcript: hyp,
    transcriptAllSegments: heardAll,
    reference: ref,
    wer: w,
    werAllSegments: wAll,
    acoustic: { floor, gate, segments: segs, fixtureSeg, ttsSeg },
    timeline: {
      armClick: armT, recStart: at('rec:start'), recAudioStart: at('rec:audiostart'),
      recSpeechStart: at('rec:speechstart'), recSpeechEnd: recSpeechEndT,
      utteranceEndAcoustic: uEndAcoustic, finalResult: finalT,
      speakCalled: speakCalledT, utteranceStartEvent: utterStartT,
      firstAudibleAcoustic, ttsEnd: at('tts:end'),
      interims: all('rec:interim').map(e => ({ t: e.t, text: e.v.text })),
      states: r.EV.filter(e => e.k === 'state').map(e => `${e.t.toFixed(0)} ${e.v.from}->${e.v.to} (${e.v.ev})`),
    },
    summary: {
      transcript: hyp,
      werPct: w ? +(w.wer * 100).toFixed(1) : null,
      S: w ? w.S : null, I: w ? w.I : null, D: w ? w.D : null, refWords: w ? w.refWords : null,
      transcriptAllSegments: heardAll,
      werPctAllSegments: wAll ? +(wAll.wer * 100).toFixed(1) : null,
      uEnd_to_final_ms: ms(uEndAcoustic, finalT),
      uEnd_to_firstAudibleProxy_ms: ms(uEndAcoustic, utterStartT),
      uEnd_to_utteranceStartEvent_ms: ms(uEndAcoustic, utterStartT),
      final_to_firstAudibleProxy_ms: ms(finalT, utterStartT),
      speakCalled_to_startEvent_ms: ms(speakCalledT, utterStartT),
      recSpeechEnd_to_final_ms: ms(recSpeechEndT, finalT),
    },
  }
}

const stamp = `${MODE}-${CONTINUOUS ? 'continuous' : 'appdefault'}-${FIXDIR}-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.writeFileSync(path.join(OUT, `run-${stamp}.json`), JSON.stringify(results, null, 2))
fs.writeFileSync(path.join(OUT, `run-${stamp}.summary.json`),
  JSON.stringify(results.map(r => ({ fixture: r.fixture, why: r.why, ...r.summary })), null, 2))
console.log(JSON.stringify(results.map(r => ({ fixture: r.fixture, why: r.why, ...r.summary })), null, 2))
