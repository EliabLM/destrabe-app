import { z } from 'zod';
import {
  FEATURE_FLAGS,
  isFeatureFlag,
  type FeatureFlag,
} from '@destrabe/shared';

/**
 * Formato de la variable `FEATURE_FLAGS` (issue #13). JSON con un objeto por
 * flag del catálogo (`@destrabe/shared`):
 *
 *   {"pagoSimulado":{"mode":"allowlist","users":["+573001234567"]},
 *    "ubicacionGps":"all"}
 *
 * - `"off"` / `{"mode":"off"}`: apagado para todos.
 * - `{"mode":"allowlist","users":[...]}`: solo para esos usuarios (id de
 *   usuario o teléfono E.164).
 * - `"all"` / `{"mode":"all"}`: liberado para todos.
 *
 * Un flag que no aparece queda apagado (falla cerrado). JSON inválido, modo
 * desconocido o teléfono mal escrito hacen fallar el arranque.
 */

export type FlagMode = 'off' | 'allowlist' | 'all';

export interface FlagRule {
  mode: FlagMode;
  /** Ids de usuario o teléfonos E.164. Solo cuenta en modo `allowlist`. */
  users: string[];
}

export type FeatureFlagsConfig = Partial<Record<FeatureFlag, FlagRule>>;

const E164 = /^\+[1-9]\d{7,14}$/;

const userEntry = z
  .string()
  .trim()
  .min(1, 'usuario vacío')
  .refine((v) => !v.startsWith('+') || E164.test(v), {
    message: 'teléfono no está en formato E.164 (ej. +573001234567)',
  });

const ruleSchema = z.union([
  z.enum(['off', 'all']).transform((mode) => ({ mode, users: [] })),
  z
    .object({
      mode: z.enum(['off', 'allowlist', 'all']),
      users: z.array(userEntry).default([]),
    })
    .strict(),
]);

const configSchema = z.record(z.string(), ruleSchema);

export function parseFeatureFlagsConfig(
  raw: string | undefined,
  warn: (msg: string) => void = console.warn,
): FeatureFlagsConfig {
  if (raw === undefined || raw.trim() === '') return {};

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `FEATURE_FLAGS no es JSON válido: ${(err as Error).message}`,
    );
  }

  const result = configSchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(raíz)'}: ${i.message}`)
      .join('; ');
    throw new Error(`FEATURE_FLAGS inválida: ${detail}`);
  }

  const config: FeatureFlagsConfig = {};
  for (const [name, rule] of Object.entries(result.data)) {
    if (!isFeatureFlag(name)) {
      // Se ignora (queda apagado) para que retirar un flag del catálogo no
      // tumbe el arranque si la variable aún lo menciona.
      warn(
        `FEATURE_FLAGS: flag desconocido "${name}" ignorado. Válidos: ${FEATURE_FLAGS.join(', ')}`,
      );
      continue;
    }
    config[name] = rule as FlagRule;
  }
  return config;
}
