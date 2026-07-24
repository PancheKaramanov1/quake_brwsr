import { defineConfig } from 'vitest/config'

/** Config for long-running load / soak / network / browser suites. */
export default defineConfig({
  test: {
    include: ['tests/load/**/*.test.ts', 'tests/browser/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 180000,
    fileParallelism: false,
  },
})
