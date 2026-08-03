import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const FN = 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-rt-token'
const session = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8'))
const pcm = readFileSync('/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wavs/f1.wav').subarray(44)
async function mint() {
  const r = await fetch(FN, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'stt' }) })
  return (await r.json()).token
}
const RUN = async ({ token, pcmB64, chunkMs, strategy }) => {
  const bin = atob(pcmB64); const pcm = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i)
  const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${token}&model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=eng&commit_strategy=${strategy}`
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s) }
  return await new Promise((resolve) => {
    const ws = new WebSocket(url)
    const out = { firstPartialMs: null, partialTimes: [], committed: [] }
    let t0 = null
    const timeout = setTimeout(() => { try { ws.close() } catch {}; resolve(out) }, 25000)
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const mt = msg.message_type
      if (mt === 'session_started') {
        const CHUNK = Math.round(16000 * 2 * chunkMs / 1000)
        let off = 0
        t0 = performance.now()
        const tick = setInterval(() => {
          if (off >= pcm.length) {
            clearInterval(tick)
            ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64(new Uint8Array(CHUNK)), commit: strategy === 'manual', sample_rate: 16000 }))
            return
          }
          ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64(pcm.slice(off, off + CHUNK)), commit: false, sample_rate: 16000 }))
          off += CHUNK
        }, chunkMs)
      } else if (mt === 'partial_transcript') {
        if ((msg.text || '').trim()) {
          const dt = performance.now() - t0
          if (out.firstPartialMs === null) out.firstPartialMs = dt
          out.partialTimes.push(Math.round(dt))
        }
      } else if ((mt || '').startsWith('committed')) {
        out.committed.push(msg.text ?? '')
        clearTimeout(timeout); setTimeout(() => { try { ws.close() } catch {}; resolve(out) }, 200)
      } else if ((mt || '').includes('error')) {
        out.committed.push('ERR:' + JSON.stringify(msg).slice(0, 120))
        clearTimeout(timeout); resolve(out)
      }
    }
  })
}
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [chunkMs, strategy] of [[50, 'manual'], [200, 'manual'], [500, 'manual'], [100, 'vad']]) {
  const token = await mint()
  const r = await page.evaluate(RUN, { token, pcmB64: pcm.toString('base64'), chunkMs, strategy })
  console.log(`chunk=${chunkMs}ms strategy=${strategy} firstPartial=${r.firstPartialMs?.toFixed(0)}ms partialTimes=${JSON.stringify(r.partialTimes)} final="${r.committed.join(' ').slice(0, 90)}"`)
}
await browser.close()
