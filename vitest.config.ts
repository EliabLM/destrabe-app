import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'backend/__tests__/**/*.test.ts',
      'shared/__tests__/**/*.test.ts',
    ],
    exclude: ['**/__tests__/db/**', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: ['backend/src/**/*.ts', 'shared/src/**/*.ts'],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/index.ts',
        'backend/src/server.ts',
        'backend/src/lib/prisma.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
