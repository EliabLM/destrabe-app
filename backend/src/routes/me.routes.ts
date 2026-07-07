import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

/**
 * /me route — cambio-008 / D3 / REQ-AUTH-011.
 *
 * Endpoint de hidratación de sesión compuesta. La app móvil lo llama
 * tras verify OTP o al reabrir la app para restaurar el estado del usuario.
 *
 * GET /api/me — requireAuth. Retorna el usuario con sus perfiles asociados
 * (clientProfile, operatorProfile). Sin sesión → 401.
 */

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user!;

    const result = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        clientProfile: true,
        operatorProfile: true,
      },
    });

    if (!result) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // REQ-AUTH-011: Separate user fields from profiles. Profiles go at top
    // level so the mobile app can access them directly.
    const { clientProfile, operatorProfile, ...userFields } = result;

    const response: Record<string, unknown> = {
      user: userFields,
    };
    if (clientProfile) {
      response.clientProfile = clientProfile;
    }
    if (operatorProfile) {
      response.operatorProfile = operatorProfile;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});
