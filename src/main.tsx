import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { ConfirmProvider } from './components/ConfirmSheet'
import { PushLaterProvider } from './components/PushLaterSheet'

if (localStorage.getItem('inbox-theme') === 'light') {
  document.documentElement.dataset.theme = 'light'
}

// A new worker skips waiting and claims this page immediately (src/sw.ts) -- but a
// CLAIMED page is still running the bundle it loaded with. Nothing re-fetches
// index.html, so the assets in memory stay whatever they were when the tab opened.
// Ivan keeps this open for days: the draft-card fix was live on the server and
// invisible in his tab for an hour (2026-08-20, "i still cant fucking scroll here").
// Reload once when control passes to a NEW worker. `hadController` is the guard --
// on a first-ever visit the controller also changes, and reloading a fresh install
// is a pointless flash.
if ('serviceWorker' in navigator) {
  // Reload when control passes to a NEW worker, but not on the first claim of a
  // first-ever visit, where reloading a page that just loaded is a pointless
  // flash.
  //
  // 🔴 THIS WAS A LATCH, AND THE LATCH NEVER OPENED. The old guard captured
  // `hadController` once, at script execution, which on a first visit is BEFORE
  // clientsClaim() has run and is therefore always false. It never got
  // recomputed, so that tab skipped the reload for its first claim AND for every
  // deploy afterwards, for as long as it stayed open. Measured: the worker
  // installed and activated on schedule and the page sat on the old bundle.
  //
  // Tracking it as state instead of a snapshot: the first handover is absorbed,
  // every later one reloads.
  let controlled = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return }
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  // ASK WHETHER A NEWER BUILD EXISTS. Nothing else in this app ever did.
  //
  // Everything above assumes the browser has FOUND a new worker. It only looks
  // for one on a navigation inside the scope, or roughly once a day. This app
  // is hash-routed, so moving between lanes is not a navigation, and a tab left
  // open never triggers the check. Meanwhile precacheAndRoute answers the
  // reload from cache, so even Cmd+R returns the same bundle. The result is the
  // failure Ivan has now reported four times across five months, most recently
  // twice in one hour on 2026-08-21 ("dyde its still the same one wtf"): the
  // deploy is genuinely live, verified in a fresh browser, and his tab cannot
  // see it. The two fixes before this one made the update APPLY instantly; none
  // of them made the browser LOOK.
  //
  // update() is a conditional request. When the worker is unchanged the server
  // answers 304 and nothing happens, so a check a minute costs nothing and the
  // visible-only guard keeps background tabs quiet.
  navigator.serviceWorker.ready.then(reg => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      reg.update().catch(() => { /* offline, or the check raced a reload */ })
    }
    check()
    setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
  }).catch(() => { /* no registration yet; the next load registers one */ })
}

console.log('[inbox] build', __BUILD__)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <PushLaterProvider>
        <App />
      </PushLaterProvider>
    </ConfirmProvider>
  </StrictMode>,
)
