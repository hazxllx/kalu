import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/styles/index.css'
import { registerServiceWorker } from '@/lib/pwa'

/**
 * React application entry point.
 *
 * Mounts the root App component to #root. The App shell contains all global
 * providers (Auth, QueryClient, Router, Theme, etc.) that are required for
 * the entire application to function. The route table is defined in AppRoutes.
 *
 * Service worker registration is deferred until after the initial render so
 * offline capability does not block the first paint. The service worker
 * enables offline-first functionality: data can be synced when connectivity
 * is restored, and cached pages/assets are available offline.
 */
ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// Register the offline service worker after boot so it never blocks first paint.
// This enables offline-first functionality and background sync when the user
// reconnects. The service worker is not critical to the initial load.
registerServiceWorker()

