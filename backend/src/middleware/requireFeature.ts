import type { RequestHandler } from 'express';
import type { FeatureFlag } from '@destrabe/shared';
import { isFeatureEnabled } from '../lib/featureFlags';
import type { AuthedRequest } from './auth';

/**
 * Protege una ruta con un feature flag (issue #13). Va después de
 * `requireAuth`. Si el flag no está activo para el usuario responde 404,
 * igual que una ruta inexistente, para no revelar features ocultas.
 *
 *   router.post('/x', requireAuth, requireFeature('pagoSimulado'), handler)
 */
export function requireFeature(flag: FeatureFlag): RequestHandler {
  return async (req, res, next) => {
    try {
      if (await isFeatureEnabled(flag, (req as AuthedRequest).user)) {
        return next();
      }
      res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
    } catch (err) {
      next(err);
    }
  };
}
