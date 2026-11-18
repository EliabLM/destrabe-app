import { z } from 'zod';
import {
  parseFeatureFlagsConfig,
  type FeatureFlagsConfig,
} from './featureFlagsConfig';

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
  // T1 — CORS origin for Express cors() middleware (cambio-008 / D4).
  // Default '*' for Demo; configure specific origin(s) for production.
  CORS_ORIGIN: z.string().default('*'),
  // DCC-05 — Proxies de confianza para Express (`trust proxy`): lista de IP o
  // CIDR (o los alias de proxy-addr `loopback`, `linklocal`, `uniquelocal`).
  // Por defecto: loopback + redes privadas (la red Docker de Traefik/Coolify).
  // `false` desactiva la confianza (la IP será la del socket).
  TRUST_PROXY: z.string().trim().min(1).default('loopback,uniquelocal'),
  // DCC-05 — Límites de envío de OTP por SMS, persistidos en Postgres.
  SMS_LIMIT_PHONE_15MIN: z.coerce.number().int().positive().default(3),
  SMS_LIMIT_PHONE_DAY: z.coerce.number().int().positive().default(10),
  SMS_LIMIT_IP_HOUR: z.coerce.number().int().positive().default(10),
  SMS_LIMIT_IP_DAY: z.coerce.number().int().positive().default(30),
  // Tope de coste: 20 SMS × hasta USD 0,38 ≈ USD 7,6/día en el peor caso.
  SMS_DAILY_CAP: z.coerce.number().int().positive().default(20),
  // DCC-05 — Solo fuera de producción: números (coma) con OTP fijo, sin SMS.
  OTP_TEST_NUMBERS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z
          .string()
          .regex(/^\+573\d{9}$/, 'OTP_TEST_NUMBERS: solo móviles +573…'),
      ),
    ),
  OTP_TEST_CODE: z
    .string()
    .regex(/^\d{6}$/, 'OTP_TEST_CODE debe tener 6 dígitos')
    .optional(),
  // DCC-22 — Demo: números (coma) cuyo OTP se escribe en el log en vez de
  // enviarse por SMS. Permitido en producción; vacío = apagado.
  OTP_LOG_NUMBERS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.string().regex(/^\+573\d{9}$/, 'OTP_LOG_NUMBERS: solo móviles +573…'),
      ),
    ),
  // Issue #13 — feature flags por usuario (JSON; ver featureFlagsConfig.ts).
  FEATURE_FLAGS: z.string().optional(),
});

export type Env = Omit<z.infer<typeof envSchema>, 'FEATURE_FLAGS'> & {
  FEATURE_FLAGS: FeatureFlagsConfig;
};

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
    withSandboxDefault.MP_SANDBOX = nodeEnv !== 'production' ? 'true' : 'false';
  }
  if (nodeEnv === 'production') {
    for (const name of ['DATABASE_URL', 'CORS_ORIGIN'] as const) {
      if (!input[name]?.trim()) {
        throw new Error(`${name} is required in production`);
      }
    }
    // DCC-05: el OTP fijo de pruebas nunca puede existir en producción.
    for (const name of ['OTP_TEST_NUMBERS', 'OTP_TEST_CODE'] as const) {
      if (input[name] !== undefined) {
        throw new Error(`${name} must not be set in production`);
      }
    }
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

  if (parsed.OTP_TEST_NUMBERS.length > 0 && !parsed.OTP_TEST_CODE) {
    throw new Error('OTP_TEST_CODE is required when OTP_TEST_NUMBERS is set');
  }

  return {
    ...parsed,
    FEATURE_FLAGS: parseFeatureFlagsConfig(parsed.FEATURE_FLAGS),
  };
}

// Singleton parsed from `process.env` para que auth.ts/plivo.ts importen `env`
// directamente (parseEnv sigue exportado para tests que inyectan input).
export const env = parseEnv();
