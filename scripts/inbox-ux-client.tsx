import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { Fixture } from './inbox-ux-fixture'
const config = JSON.parse(document.documentElement.dataset.fixture!)
function App() {
  const [recipientError, setRecipientError] = useState(false)
  useEffect(() => {
    const fail = () => setRecipientError(true)
    window.addEventListener('fixture:recipient-error', fail)
    return () => window.removeEventListener('fixture:recipient-error', fail)
  }, [])
  return Fixture(config.phone, config.legacy, config.long, config.ownSend, config.baseline, recipientError)
}
createRoot(document.getElementById('root')!).render(<App />)
