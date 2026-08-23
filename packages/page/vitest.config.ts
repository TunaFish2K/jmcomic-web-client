import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __APP_RELEASE_ID__: JSON.stringify('test'),
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
        'src/reader/{ReaderOverlay,useReaderData,input,network}.{ts,tsx}': {
          statements: 98,
          branches: 95,
          functions: 98,
          lines: 98,
        },
        'src/reader/index.tsx': {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 98,
        },
        'src/api.ts': {
          statements: 98,
          branches: 95,
          functions: 98,
          lines: 98,
        },
        'src/home/{CoverImage,useAlbumBatch,useSearchState}.{ts,tsx}': {
          statements: 98,
          branches: 95,
          functions: 98,
          lines: 98,
        },
      },
    },
  },
});
