import {
  FEATURE_FLAGS,
  isFeatureFlag,
  type FeatureFlag,
} from '@destrabe/shared';
import { env } from './env';
import type { FeatureFlagsConfig, FlagRule } from './featureFlagsConfig';

/**
 * Feature flags por usuario (issue #13). Guía: docs/runbooks/feature-flags.md.
 *
 * Los llamadores solo usan `isFeatureEnabled`, `getEnabledFeatures` y el
 * middleware `requireFeature`. De dónde salen las reglas lo decide el
 * `FeatureFlagStore` activo (hoy, la variable `FEATURE_FLAGS`); para pasar a
 * una tabla en BD basta con otro store, sin tocar a los llamadores.
 */

/** Lo mínimo del usuario que hace falta para evaluar un flag. */
export interface FeatureUser {
  id: string;
  phone?: string | null;
}

export interface FeatureFlagStore {
  getRule(flag: FeatureFlag): Promise<FlagRule | undefined>;
}

export function configFlagStore(config: FeatureFlagsConfig): FeatureFlagStore {
  return { getRule: async (flag) => config[flag] };
}

let store: FeatureFlagStore = configFlagStore(env.FEATURE_FLAGS);

/** Cambia el origen de las reglas (tests o, en el futuro, BD). */
export function setFeatureFlagStore(next: FeatureFlagStore): void {
  store = next;
}

export function ruleAllows(
  rule: FlagRule | undefined,
  user: FeatureUser | null | undefined,
): boolean {
  if (!rule) return false;
  if (rule.mode === 'all') return true;
  if (rule.mode !== 'allowlist' || !user) return false;
  return rule.users.some(
    (entry) => entry === user.id || (!!user.phone && entry === user.phone),
  );
}

/**
 * ¿Está activo `flag` para `user`? Flag desconocido, sin configurar o sin
 * usuario → false (falla cerrado).
 */
export async function isFeatureEnabled(
  flag: FeatureFlag,
  user: FeatureUser | null | undefined,
): Promise<boolean> {
  if (!isFeatureFlag(flag)) return false;
  return ruleAllows(await store.getRule(flag), user);
}

/** Flags del catálogo activos para `user`. */
export async function getEnabledFeatures(
  user: FeatureUser | null | undefined,
): Promise<FeatureFlag[]> {
  const checks = await Promise.all(
    FEATURE_FLAGS.map(
      async (flag) => [flag, await isFeatureEnabled(flag, user)] as const,
    ),
  );
  return checks.filter(([, on]) => on).map(([flag]) => flag);
}
