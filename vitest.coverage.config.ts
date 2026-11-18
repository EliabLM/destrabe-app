import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Cobertura sobre unit + DB: las rutas se ejercitan sobre todo en los tests de
// contrato con Postgres. Requiere DATABASE_URL (job "db" de CI).
export default defineConfig({
  test: {
    ...base.test,
    include: [
      'backend/__tests__/**/*.test.ts',
      'shared/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
  },
});
