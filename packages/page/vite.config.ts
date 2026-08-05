import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const releaseMetadata = {
  commit: process.env.CF_PAGES_COMMIT_SHA?.trim() || 'local',
  branch: process.env.CF_PAGES_BRANCH?.trim() || 'local',
}

// https://vite.dev/config/
export default defineConfig({
  // Isolate recovery assets from the legacy namespaces implicated in the incident.
  build: {
    assetsDir: 'assets-v3',
  },
  define: {
    __APP_RELEASE_ID__: JSON.stringify(releaseMetadata.commit),
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
    {
      name: 'release-metadata',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: `${JSON.stringify(releaseMetadata, null, 2)}\n`,
        })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['pwa-cache-cleanup-v3.txt'],
        navigateFallback: null,
        inlineWorkboxRuntime: true,
        cleanupOutdatedCaches: true,
        manifestTransforms: [
          async (entries) => ({
            manifest: entries.filter(
              (entry) => entry.url === 'pwa-cache-cleanup-v3.txt',
            ),
            warnings: [],
          }),
        ],
      },
    }),
  ],
})
