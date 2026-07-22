// Soft two-tone chime for new inbound replies while the app is open.
// WebAudio synth (no audio asset). Browsers require a prior user gesture
// before audio can play — fine here, since you interacted to open the app.

const KEY = 'inbox-chime'

export function chimeEnabled(): boolean {
  return localStorage.getItem(KEY) !== 'off'
}

export function setChimeEnabled(on: boolean): void {
  localStorage.setItem(KEY, on ? 'on' : 'off')
}

let ctx: AudioContext | null = null

export function playChime(): void {
  if (!chimeEnabled()) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime
    for (const [freq, start] of [[880, 0], [1174.7, 0.09]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + start)
      gain.gain.linearRampToValueAtTime(0.12, t0 + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + start)
      osc.stop(t0 + start + 0.55)
    }
  } catch {
    // Audio blocked (no gesture yet) — skip silently.
  }
}
