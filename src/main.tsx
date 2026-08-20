import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { ConfirmProvider } from './components/ConfirmSheet'
import { PushLaterProvider } from './components/PushLaterSheet'

if (localStorage.getItem('inbox-theme') === 'light') {
  document.documentElement.dataset.theme = 'light'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <PushLaterProvider>
        <App />
      </PushLaterProvider>
    </ConfirmProvider>
  </StrictMode>,
)
