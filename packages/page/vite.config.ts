import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache all build assets so the shell loads instantly offline
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
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
      manifest: {
        name: 'JM Web Client',
        short_name: 'JM',
        description: 'JM第三方客户端',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192-v3.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512-v3.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512-v3.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-1024-v3.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
