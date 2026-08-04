import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Keep recovery assets outside both cache namespaces poisoned by earlier workers.
  build: {
    assetsDir: 'assets-v3',
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['pwa-cache-cleanup-v3.txt'],
        navigateFallback: null,
        inlineWorkboxRuntime: true,
        manifestTransforms: [
          async (entries) => ({
            manifest: entries.filter((entry) => entry.url === 'pwa-cache-cleanup-v3.txt'),
            warnings: [],
          }),
        ],
        // API calls to the backend worker are always network-only
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/search') ||
              url.pathname.startsWith('/album') ||
              url.pathname.startsWith('/photo') ||
              url.pathname.startsWith('/batch-album'),
            handler: 'NetworkOnly',
          },
          // Cover images: cache-first, 7-day expiry, max 500 entries
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
})
