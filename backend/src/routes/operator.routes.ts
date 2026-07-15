import { Router } from 'express';
import { UserRole } from '@destrabe/shared';
import type {
  CreateOperatorProfileInput,
  UpdateLocationInput,
} from '@destrabe/shared';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import type { ValidatedRequest } from '../middleware/validate';
import {
  createOperatorProfileSchema,
  updateLocationSchema,
} from '@destrabe/shared';
import { prisma } from '../lib/prisma';

/**
 * Operator routes — cambio-008 / D1-D2 / REQ-OP-001, REQ-OP-002.
 *
 * 2 endpoints bajo requireAuth + requireRole(OPERATOR):
 *   POST /api/operator/profile       — crear perfil (201) o 409 si ya existe
 *   PATCH /api/operator/location     — actualizar ubicación (200) o 404 si no hay perfil
 */

type OperatorRequest = AuthedRequest & ValidatedRequest;

export const operatorRouter = Router();

// ─── All routes require authentication ───────────────────────────────────────

operatorRouter.use(requireAuth);

// ─── POST /api/operator/profile — Create profile ────────────────────────────

operatorRouter.post(
  '/profile',
  requireRole(UserRole.OPERATOR),
  validate(createOperatorProfileSchema, 'body'),
  async (req, res, next) => {
    try {
      const r = req as OperatorRequest;
      const user = r.user!;
      const data = r.validated!['body'] as CreateOperatorProfileInput;

      // REQ-OP-001: Check if profile already exists
      const existing = await prisma.operatorProfile.findUnique({
        where: { userId: user.id },
      });
      if (existing) {
        return res.status(409).json({
          error: 'Profile already exists',
          code: 'PROFILE_EXISTS',
        });
      }

      // REQ-OP-001: Create profile
      const profile = await prisma.operatorProfile.create({
        data: {
          userId: user.id,
          truckType: data.truckType,
          licensePlate: data.licensePlate,
          photoUrl: data.photoUrl ?? null,
          available: data.available ?? false,
          lastLatitude: data.lastLatitude ?? null,
          lastLongitude: data.lastLongitude ?? null,
        },
      });

      res.status(201).json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH /api/operator/location — Update location ──────────────────────────

operatorRouter.patch(
  '/location',
  requireRole(UserRole.OPERATOR),
  validate(updateLocationSchema, 'body'),
  async (req, res, next) => {
    try {
      const r = req as OperatorRequest;
      const user = r.user!;
      const data = r.validated!['body'] as UpdateLocationInput;

      // REQ-OP-002: Check profile exists
      const existing = await prisma.operatorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!existing) {
        return res.status(404).json({
          error: 'Operator profile not found',
          code: 'NOT_FOUND',
        });
      }

      // REQ-OP-002: Update location + lastSeenAt
      const updated = await prisma.operatorProfile.update({
        where: { userId: user.id },
        data: {
          lastLatitude: data.lastLatitude,
          lastLongitude: data.lastLongitude,
          available: data.available ?? existing.available,
          lastSeenAt: new Date(),
        },
      });

      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  },
);
