import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS, isFeatureFlag, meFeaturesResponseSchema } from '../src';

describe('catálogo de feature flags', () => {
  it('incluye los flags iniciales', () => {
    expect(FEATURE_FLAGS).toEqual(['pagoSimulado', 'ubicacionGps']);
  });

  it('isFeatureFlag reconoce solo flags del catálogo', () => {
    expect(isFeatureFlag('pagoSimulado')).toBe(true);
    expect(isFeatureFlag('noExiste')).toBe(false);
    expect(isFeatureFlag(42)).toBe(false);
  });

  it('la respuesta de /api/me/features descarta flags desconocidos', () => {
    expect(
      meFeaturesResponseSchema.parse({
        features: ['ubicacionGps', 'flagViejo'],
      }),
    ).toEqual({ features: ['ubicacionGps'] });
  });
});
