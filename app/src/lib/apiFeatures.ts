import { meFeaturesResponseSchema, type FeatureFlag } from '@destrabe/shared';
import { api } from './api';

/**
 * Flags activos para la sesión actual.
 * GET /api/me/features
 */
export async function getMyFeatures(): Promise<FeatureFlag[]> {
  const res = await api.get('/api/me/features');
  return meFeaturesResponseSchema.parse(res.data).features;
}
