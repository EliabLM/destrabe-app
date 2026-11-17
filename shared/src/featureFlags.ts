import { z } from 'zod';

/**
 * Catálogo de feature flags (issue #13).
 *
 * Única fuente de nombres válidos para backend y app. Para crear un flag nuevo
 * se añade aquí; para retirarlo, se borra de aquí y de sus usos. El estado de
 * cada flag (apagado, solo allowlist, todos) NO vive aquí: se configura en el
 * backend con la variable `FEATURE_FLAGS` (ver docs/runbooks/feature-flags.md).
 */
export const FEATURE_FLAGS = ['pagoSimulado', 'ubicacionGps'] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export function isFeatureFlag(value: unknown): value is FeatureFlag {
  return (
    typeof value === 'string' &&
    (FEATURE_FLAGS as readonly string[]).includes(value)
  );
}

/**
 * Respuesta de `GET /api/me/features`. Los nombres que la app no conoce (p. ej.
 * una app vieja frente a un backend nuevo) se descartan en lugar de fallar.
 */
export const meFeaturesResponseSchema = z.object({
  features: z.array(z.string()).transform((list) => list.filter(isFeatureFlag)),
});

export type MeFeaturesResponse = { features: FeatureFlag[] };
