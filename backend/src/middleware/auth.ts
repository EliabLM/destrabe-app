import type { Request, RequestHandler } from 'express';
import { UserRole } from '@destrabe/shared';
import { auth } from '../lib/auth';

/**
 * Middleware de autenticación y autorización (cambio-003 / REQ-008, REQ-009).
 *
 * - `requireAuth`: valida la sesión vía Better Auth (`auth.api.getSession`)
 *   usando los headers de la request (la cookie la lee Better Auth
 *   internamente). Sin sesión → 401 `{ error, code: 'UNAUTHORIZED' }`.
 *   Con sesión → setea `req.user` y delega a `next()`.
 * - `requireRole(role)`: factory que devuelve un guard sobre `req.user.role`.
 *   Si no coincide → 403 `{ error, code: 'FORBIDDEN' }`.
 *
 * TDD: cubierto por `backend/__tests__/middleware.auth.test.ts`.
 */

/** Request autenticada: `requireAuth` pobla `user` antes de delegar. */
export interface AuthedRequest extends Request {
  user?: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

/**
 * Shape del user devuelto por Better Auth (campos relevantes para el mw).
 *
 * NOTA: el plugin `phoneNumber` de Better Auth expone el teléfono en el campo
 * `phoneNumber` (no `phone`), aunque la spec REQ-001/§6 use `phone` como nombre
 * de columna en Prisma. La discrepancia se resuelve en T3 (schema) / T9
 * (flujo); aquí leemos `phoneNumber` que es lo que devuelve `getSession`.
 * El additionalField `role` se almacena como string; se castea a UserRole.
 */
interface BetterAuthUser {
  id: string;
  phoneNumber?: string | null;
  role: string;
}

interface BetterAuthSession {
  user: BetterAuthUser;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return res
        .status(401)
        .json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const s = session as BetterAuthSession;
    (req as AuthedRequest).user = {
      id: s.user.id,
      phone: s.user.phoneNumber ?? '',
      role: s.user.role as UserRole,
    };
    next();
  } catch {
    // Cualquier fallo leyendo la sesión se trata como no autenticado.
    return res
      .status(401)
      .json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
};

export function requireRole(role: UserRole): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthedRequest).user;
    if (!user || user.role !== role) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}
