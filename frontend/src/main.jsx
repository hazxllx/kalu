import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/styles/index.css'
import { registerServiceWorker } from '@/lib/pwa'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Register the offline service worker after boot so it never blocks first paint.
registerServiceWorker()

