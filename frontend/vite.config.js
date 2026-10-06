
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
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
});
