import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gzipSync } from 'node:zlib'
import {
  ORT_MJS_ASSET_PATH,
  ORT_WASM_GZIP_ASSET_PATH,
} from './src/translation/ort-assets'

const require = createRequire(import.meta.url)
const ortWasmPath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm')
const ortMjsPath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs')

const releaseMetadata = {
  commit: process.env.CF_PAGES_COMMIT_SHA?.trim() || 'local',
  branch: process.env.CF_PAGES_BRANCH?.trim() || 'local',
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    conditions: [
      'onnxruntime-web-use-extern-wasm',
      'module',
      'browser',
      'development|production',
    ],
  },
  // Isolate recovery assets from the legacy namespaces implicated in the incident.
  build: {
    assetsDir: 'assets-v3',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@paddleocr/paddleocr-js/')) return 'ocr-runtime'
        },
      },
    },
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
    {
      name: 'compressed-ort-runtime',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: ORT_WASM_GZIP_ASSET_PATH.replace(/^\//, ''),
          source: gzipSync(readFileSync(ortWasmPath), { level: 9 }),
        })
        this.emitFile({
          type: 'asset',
          fileName: ORT_MJS_ASSET_PATH.replace(/^\//, ''),
          source: readFileSync(ortMjsPath),
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
