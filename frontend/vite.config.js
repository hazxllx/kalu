
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import { publicSupabaseConfigurationError } from '../shared/authConnectivity.js'
import { normalizeApiBaseUrl } from './src/services/api/apiBaseUrl.js'
import { loadLocalEnvironment, localIsolationPlugin } from './config/localDevelopment.js'

// https://vite.dev/config/
export default defineConfig(({ mode, command, isPreview }) => {
  if (isPreview) {
    throw new Error('Use npm run dev for local isolation; preview can serve a stale production bundle.')
  }
  if (mode === 'production' && command === 'serve') {
    throw new Error('Local servers must use development mode. Production mode is reserved for deployment builds.')
  }
  const local = mode !== 'production'
  const env = local ? loadLocalEnvironment(mode, __dirname) : loadEnv(mode, __dirname, 'VITE_')
  const required = [
    'VITE_API_URL',
    ...(mode === 'production' ? ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] : []),
  ]
  const missing = required.filter((key) => !env[key]?.trim())

  if (missing.length) {
    throw new Error(
      `${mode} frontend configuration is incomplete. Missing required environment variable(s): ${missing.join(', ')}`,
    )
  }

  try {
    normalizeApiBaseUrl(env.VITE_API_URL)
  } catch (error) {
    throw new Error(`Frontend API configuration is invalid. ${error.message}`)
  }

  // Stop before a browser bundle can expose a misconfigured server credential.
  if (env.VITE_SUPABASE_ANON_KEY || (!local && env.VITE_SUPABASE_URL)) {
    const configurationError = publicSupabaseConfigurationError(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    if (configurationError) throw new Error(`Frontend authentication configuration is invalid. ${configurationError}`)
  }

  return {
  ...(local ? {
    // Disable Vite's implicit .env/.env.local and inherited VITE_ loading.
    envDir: false,
    envPrefix: [],
    define: Object.fromEntries(Object.entries(env).map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)])),
    server: {
      host: new URL(env.VITE_APP_BASE_URL).hostname.replace(/^\[|\]$/g, ''),
      port: Number(new URL(env.VITE_APP_BASE_URL).port) || (new URL(env.VITE_APP_BASE_URL).protocol === 'https:' ? 443 : 80),
      strictPort: true,
      open: false,
      cors: { origin: new URL(env.VITE_APP_BASE_URL).origin },
    },
  } : {}),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    ...(local ? [localIsolationPlugin(env)] : []),
    react(),
    // Offline/PWA foundation. The service worker is authored explicitly in
    // `src/sw.js` (injectManifest) so we can guarantee authenticated API
    // traffic is never cached and provide a dedicated offline navigation
    // fallback. Registration is handled in `src/lib/pwa.js`.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'KALUSAGAP — Community Health Risk Monitoring and Early Intervention System',
        short_name: 'KALUSAGAP',
        description:
          'Community health risk monitoring and early intervention for the Municipal Health Office of Pili, Camarines Sur.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#072F5F',
        background_color: '#F4F6FA',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
          'charts': ['recharts'],
          'utils': ['framer-motion', 'lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  }
});
