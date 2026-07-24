import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/load/**',
      'tests/browser/**',
    ],
    environment: 'node',
    globals: false,
    testTimeout: 30000,
  },
})
