// Aggregates every run in raw/ into the per-fixture table and the verdict.
// Also validates the acoustic utterance-end detector against the fixture files:
// the detected speech span must match the span ffmpeg's silencedetect finds in
// the WAV, or the latency numbers are measured off a phantom.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const RAW = path.join(HERE, 'raw')
const FIX = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-fixtures'
const FIXTURES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9_noisy', 'f10_fast']

// --- file-derived speech span, for validating the acoustic detector ---
// ffmpeg writes silencedetect to stderr and exits 0, so stderr must be captured
// from the successful call, not from a thrown error.
function fileSpeechSpan(f) {
  const r = spawnSync('/opt/homebrew/bin/ffmpeg',
    ['-nostdin', '-i', path.join(FIX, 'roomtone', `${f}.wav`), '-af', 'silencedetect=noise=-40dB:d=0.15', '-f', 'null', '-'],
    { encoding: 'utf8' })
  const err = (r.stderr || '')
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1])
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1])
  const speechStart = ends[0] ?? null
  const speechEnd = starts.find(s => speechStart != null && s > speechStart) ?? null
  return speechStart != null && speechEnd != null
    ? { speechStart, speechEnd, dur: +(speechEnd - speechStart).toFixed(3) } : null
}
const fileSpan = {}
for (const f of FIXTURES) fileSpan[f] = fileSpeechSpan(f)

const load = pre => fs.readdirSync(RAW).filter(x => x.startsWith(pre) && !x.includes('summary'))
  .sort().flatMap(x => JSON.parse(fs.readFileSync(path.join(RAW, x), 'utf8')))

const cont = load('run-turn-continuous')
const appd = load('run-turn-appdefault')

const num = a => a.filter(x => typeof x === 'number' && isFinite(x))
const med = a => { const s = num(a).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const mean = a => { const s = num(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null }
const r1 = v => (v == null ? null : +v.toFixed(1))

function perFixture(runs, fx) {
  const rs = runs.filter(r => r.fixture === fx)
  const ok = rs.filter(r => r.transcript)
  return {
    n: rs.length, completed: ok.length,
    ref: rs[0]?.reference ?? '',
    refWords: rs[0]?.wer?.refWords ?? null,
    transcripts: [...new Set(rs.map(r => r.transcript))].filter(Boolean),
    werPct: ok.length ? r1(mean(ok.map(r => r.wer.wer * 100))) : null,
    S: ok.length ? r1(mean(ok.map(r => r.wer.S))) : null,
    I: ok.length ? r1(mean(ok.map(r => r.wer.I))) : null,
    D: ok.length ? r1(mean(ok.map(r => r.wer.D))) : null,
    // failed runs count as full deletion of every reference word
    werPctInclFailures: r1(mean(rs.map(r => (r.transcript ? r.wer.wer : 1) * 100))),
    uEnd_to_final_ms: r1(med(ok.map(r => r.summary.uEnd_to_final_ms))),
    uEnd_to_firstAudibleProxy_ms: r1(med(ok.map(r => r.summary.uEnd_to_firstAudibleProxy_ms))),
    final_to_speakStart_ms: r1(med(ok.map(r => r.summary.final_to_firstAudibleProxy_ms))),
    all_uEnd_to_firstAudible: num(ok.map(r => r.summary.uEnd_to_firstAudibleProxy_ms)).map(r1),
    // acoustic detector validation
    acousticDurMs: r1(med(ok.map(r => r.acoustic.fixtureSeg ? r.acoustic.fixtureSeg.end - r.acoustic.fixtureSeg.start : null))),
    fileDurMs: fileSpan[fx] ? r1(fileSpan[fx].dur * 1000) : null,
  }
}

const table = FIXTURES.map(fx => ({ fixture: fx, ...perFixture(cont, fx) }))
const tableApp = FIXTURES.map(fx => ({ fixture: fx, ...perFixture(appd, fx) }))

const okAll = cont.filter(r => r.transcript)
const agg = {
  runsPerFixture: cont.length / FIXTURES.length,
  turnsAttempted: cont.length,
  turnsCompleted: okAll.length,
  completionRatePct: r1(okAll.length / cont.length * 100),
  werPct_completedOnly: r1(mean(okAll.map(r => r.wer.wer * 100))),
  werPct_microAvg_completedOnly: r1(okAll.reduce((a, r) => a + r.wer.errors, 0) / okAll.reduce((a, r) => a + r.wer.refWords, 0) * 100),
  werPct_inclFailures: r1(mean(cont.map(r => (r.transcript ? r.wer.wer : 1) * 100))),
  uEnd_to_final_ms: { median: r1(med(okAll.map(r => r.summary.uEnd_to_final_ms))), min: r1(Math.min(...num(okAll.map(r => r.summary.uEnd_to_final_ms)))), max: r1(Math.max(...num(okAll.map(r => r.summary.uEnd_to_final_ms)))) },
  uEnd_to_firstAudibleProxy_ms: {
    median: r1(med(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms))),
    mean: r1(mean(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms))),
    min: r1(Math.min(...num(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms)))),
    max: r1(Math.max(...num(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms)))),
    underTargetCount: num(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms)).filter(v => v < 1200).length,
    total: num(okAll.map(r => r.summary.uEnd_to_firstAudibleProxy_ms)).length,
  },
  final_to_speakStart_ms: { median: r1(med(okAll.map(r => r.summary.final_to_firstAudibleProxy_ms))), max: r1(Math.max(...num(okAll.map(r => r.summary.final_to_firstAudibleProxy_ms)))) },
  speakCalled_to_startEvent_ms: { median: r1(med(okAll.map(r => r.summary.speakCalled_to_startEvent_ms))) },
  appDefault: { attempted: appd.length, completed: appd.filter(r => r.transcript).length },
}

const out = { generated: new Date().toISOString(), fileSpan, aggregate: agg, continuousTable: table, appDefaultTable: tableApp }
fs.writeFileSync(path.join(RAW, 'aggregate.json'), JSON.stringify(out, null, 2))

const pad = (s, n) => String(s ?? '-').padEnd(n)
console.log('\n=== CONTINUOUS VARIANT (one-line change), n=%d per fixture ===', agg.runsPerFixture)
console.log(pad('fixture', 10), pad('wds', 4), pad('ok', 6), pad('WER%', 6), pad('S', 5), pad('I', 5), pad('D', 5), pad('uEnd→final', 11), pad('uEnd→audio', 11), pad('acDur/fileDur', 14))
for (const t of table) console.log(pad(t.fixture, 10), pad(t.refWords, 4), pad(`${t.completed}/${t.n}`, 6), pad(t.werPct, 6), pad(t.S, 5), pad(t.I, 5), pad(t.D, 5), pad(t.uEnd_to_final_ms, 11), pad(t.uEnd_to_firstAudibleProxy_ms, 11), pad(`${t.acousticDurMs}/${t.fileDurMs}`, 14))
console.log('\nAGGREGATE:', JSON.stringify(agg, null, 2))
console.log('\n=== APP AS WRITTEN (continuous=false) ===')
for (const t of tableApp) console.log(pad(t.fixture, 10), pad(`${t.completed}/${t.n}`, 6), pad(t.werPct, 6), pad(t.uEnd_to_firstAudibleProxy_ms, 11))
