import { z } from 'zod';

/**
 * Defaults aplicados únicamente cuando `NODE_ENV === 'test'` (ver design §5).
 *
 * En `development`/`production` las vars de auth son **requeridas** — si faltan,
 * `parseEnv` lanza un error claro que menciona el campo que falta (fail-fast).
 * Bajo vitest ( NODE_ENV === 'test' por defecto ) inyectamos estos defaults
 * para que el singleton `env = parseEnv()` y los tests que no las seteen sigan
 * funcionando sin tocar una DB ni requerir un `.env`.
 */
const TEST_DEFAULTS = {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-32chars',
  BETTER_AUTH_URL: 'http://localhost:3000',
} as const;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
  PLIVO_AUTH_ID: z.string().optional(),
  PLIVO_AUTH_TOKEN: z.string().optional(),
  PLIVO_PHONE_NUMBER: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  input: Record<string, string | undefined> = process.env,
): Env {
  const withTestDefaults =
    (input.NODE_ENV ?? 'development') === 'test'
      ? {
          ...input,
          BETTER_AUTH_SECRET:
            input.BETTER_AUTH_SECRET ?? TEST_DEFAULTS.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL:
            input.BETTER_AUTH_URL ?? TEST_DEFAULTS.BETTER_AUTH_URL,
        }
      : input;
  return envSchema.parse(withTestDefaults);
}

// Singleton parsed from `process.env` para que auth.ts/plivo.ts importen `env`
// directamente (parseEnv sigue exportado para tests que inyectan input).
export const env = parseEnv();
