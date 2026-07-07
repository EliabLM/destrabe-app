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
  REDIS_URL: 'redis://localhost:6379',
  PAYMENT_WEBHOOK_TOKEN: 'test-webhook-token',
} as const;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SERVICE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  NEARBY_RADIUS_KM: z.coerce.number().positive().default(5),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),
  PLIVO_AUTH_ID: z.string().optional(),
  PLIVO_AUTH_TOKEN: z.string().optional(),
  PLIVO_PHONE_NUMBER: z.string().optional(),
  PAYMENT_GATEWAY: z.enum(['stub', 'mercadopago']).default('stub'),
  PAYMENT_COMMISSION_RATE: z.coerce.number().int().min(0).max(100).default(0),
  PAYMENT_WEBHOOK_TOKEN: z.string().optional(),
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_WEBHOOK_URL: z.string().url().optional(),
  MP_SANDBOX: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  input: Record<string, string | undefined> = process.env,
): Env {
  const nodeEnv = input.NODE_ENV ?? 'development';
  const withTestDefaults =
    nodeEnv === 'test'
      ? {
          ...input,
          BETTER_AUTH_SECRET:
            input.BETTER_AUTH_SECRET ?? TEST_DEFAULTS.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL:
            input.BETTER_AUTH_URL ?? TEST_DEFAULTS.BETTER_AUTH_URL,
          REDIS_URL: input.REDIS_URL ?? TEST_DEFAULTS.REDIS_URL,
          PAYMENT_WEBHOOK_TOKEN:
            input.PAYMENT_WEBHOOK_TOKEN ?? TEST_DEFAULTS.PAYMENT_WEBHOOK_TOKEN,
        }
      : input;

  // REQ-MP-ENV: MP_SANDBOX default true in non-production
  const withSandboxDefault = { ...withTestDefaults };
  if (withSandboxDefault.MP_SANDBOX === undefined) {
    withSandboxDefault.MP_SANDBOX =
      nodeEnv !== 'production' ? 'true' : 'false';
  }
  const parsed = envSchema.parse(withSandboxDefault);

  // REDIS_URL is required in non-test environments
  if (nodeEnv !== 'test' && !input.REDIS_URL) {
    throw new Error(
      'REDIS_URL is required in ' +
        nodeEnv +
        ' environment. Set REDIS_URL in your .env file.',
    );
  }

  // PAYMENT_WEBHOOK_TOKEN is required in non-test environments
  if (nodeEnv !== 'test' && !input.PAYMENT_WEBHOOK_TOKEN) {
    throw new Error(
      'PAYMENT_WEBHOOK_TOKEN is required in ' +
        nodeEnv +
        ' environment. Set PAYMENT_WEBHOOK_TOKEN in your .env file.',
    );
  }

  // REQ-MP-ENV: MP_* vars required when PAYMENT_GATEWAY=mercadopago AND NODE_ENV=production
  const gateway = parsed.PAYMENT_GATEWAY;
  if (gateway === 'mercadopago' && parsed.NODE_ENV === 'production') {
    if (!input.MP_ACCESS_TOKEN) {
      throw new Error(
        'MP_ACCESS_TOKEN is required when PAYMENT_GATEWAY=mercadopago in production',
      );
    }
    if (!input.MP_WEBHOOK_SECRET) {
      throw new Error(
        'MP_WEBHOOK_SECRET is required when PAYMENT_GATEWAY=mercadopago in production',
      );
    }
    if (!input.MP_WEBHOOK_URL) {
      throw new Error(
        'MP_WEBHOOK_URL is required when PAYMENT_GATEWAY=mercadopago in production',
      );
    }
  }

  return parsed;
}

// Singleton parsed from `process.env` para que auth.ts/plivo.ts importen `env`
// directamente (parseEnv sigue exportado para tests que inyectan input).
export const env = parseEnv();
