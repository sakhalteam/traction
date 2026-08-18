import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the offline shell worker. Scoped to the deploy's base path (`/traction/`
// in production, `/` in dev) so it can never claim the rest of the origin.
//
// Dev is deliberately excluded: a worker caching the shell fights Vite's HMR and
// leaves you debugging yesterday's bundle.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {/* offline support is a bonus; never break boot over it */})
  })
}
