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
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
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
