import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
    .default('test-secret-test-secret-test-secret-32chars'),
  BETTER_AUTH_URL: z
    .string()
    .url('BETTER_AUTH_URL must be a valid URL')
    .default('http://localhost:3000'),
  PLIVO_AUTH_ID: z.string().optional(),
  PLIVO_AUTH_TOKEN: z.string().optional(),
  PLIVO_PHONE_NUMBER: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  input: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(input);
}

// Singleton parsed from `process.env` para que auth.ts/plivo.ts importen `env`
// directamente (parseEnv sigue exportado para tests que inyectan input).
export const env = parseEnv();
