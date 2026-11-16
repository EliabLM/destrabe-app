import { Router } from 'express';
import { ServiceStatus, ServiceType, UserRole } from '@destrabe/shared';
import type { ServiceStatus as ServiceStatusEnum } from '@destrabe/shared';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import type { ValidatedRequest } from '../middleware/validate';
import {
  createServiceSchema,
  NEARBY_MAX_RADIUS_KM,
  NEARBY_MAX_RESULTS,
  nearbyServicesQuerySchema,
  listServicesQuerySchema,
  updateServiceStatusSchema,
} from '@destrabe/shared';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { assertTransition } from '../services/serviceMachine';
import { enqueueServiceExpiry } from '../lib/queue';
import { PaymentPendingError } from '../services/paymentGateway';

/**
 * Combined request type: authenticated (`user`) + validated (`validated`).
 * Express types `req` as `Request` in handlers; cast to this to access both.
 */
type ServiceRequest = AuthedRequest & ValidatedRequest;

/**
 * Services router — cambio-004 / REQ-002, REQ-003, REQ-004, REQ-005.
 *
 * 5 endpoints bajo requireAuth:
 *   POST  /services              — create (CLIENT role)
 *   GET   /services              — own paginated list (CLIENT role)
 *   GET   /services/nearby       — radius search (OPERATOR role, PostGIS ST_DWithin)
 *   GET   /services/:id          — get by id (owner full / operator public / other 404)
 *   PATCH /services/:id/status   — update status (owner, FSM assertTransition)
 */
export const servicesRouter = Router();

// ─── All routes require authentication ───────────────────────────────────────

servicesRouter.use(requireAuth);

// ─── POST /services — Create service (CLIENT) ────────────────────────────────

servicesRouter.post(
  '/',
  requireRole(UserRole.CLIENT),
  validate(createServiceSchema, 'body'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const user = sr.user!;
      const data = sr.validated!['body'] as {
        type: ServiceType;
        originLat: number;
        originLng: number;
        destLat?: number;
        destLng?: number;
        description?: string;
        photoUrl?: string;
      };

      // REQ-002: Lazy upsert ClientProfile (design §D4)
      const clientProfile = await prisma.clientProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });

      const expiresAt = new Date(
        Date.now() + env.SERVICE_TIMEOUT_MINUTES * 60 * 1000,
      );

      // REQ-002: Create Service with status PENDING
      const service = await prisma.service.create({
        data: {
          clientProfileId: clientProfile.id,
          type: data.type,
          originLat: data.originLat,
          originLng: data.originLng,
          destLat: data.destLat ?? null,
          destLng: data.destLng ?? null,
          description: data.description ?? null,
          photoUrl: data.photoUrl ?? null,
          status: ServiceStatus.PENDING,
          expiresAt,
        },
      });

      // REQ-002: Enqueue expiry job (skip in test env to avoid Redis dependency)
      if (env.NODE_ENV !== 'test') {
        await enqueueServiceExpiry(
          service.id,
          env.SERVICE_TIMEOUT_MINUTES * 60 * 1000,
        );
      }

      // REQ-002: 201 response
      res.status(201).json({
        id: service.id,
        status: service.status,
        expiresAt: service.expiresAt,
        type: service.type,
        originLat: service.originLat,
        originLng: service.originLng,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /services — own, keyset-paginated list (CLIENT) ────────────────────
// Cursor is an opaque, canonical base64url tuple; it never carries identity.
function decodeListCursor(
  value: string,
): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return null;
    const tuple: unknown = JSON.parse(decoded.toString('utf8'));
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 2 ||
      typeof tuple[0] !== 'string' ||
      typeof tuple[1] !== 'string' ||
      tuple[1].length < 1 ||
      tuple[1].length > 128
    )
      return null;
    const date = new Date(tuple[0]);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== tuple[0])
      return null;
    return { createdAt: date, id: tuple[1] };
  } catch {
    return null;
  }
}

servicesRouter.get(
  '/',
  requireRole(UserRole.CLIENT),
  validate(listServicesQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const { limit, cursor } = sr.validated!['query'] as {
        limit: number;
        cursor?: string;
      };
      const position = cursor ? decodeListCursor(cursor) : null;
      if (cursor && !position) {
        return res
          .status(400)
          .json({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
      }
      // Identity comes only from requireAuth, never from a client parameter.
      const profile = await prisma.clientProfile.findUnique({
        where: { userId: sr.user!.id },
        select: { id: true },
      });
      if (!profile) return res.json({ items: [], nextCursor: null });

      const rows = await prisma.service.findMany({
        where: {
          clientProfileId: profile.id,
          ...(position
            ? {
                OR: [
                  { createdAt: { lt: position.createdAt } },
                  { createdAt: position.createdAt, id: { lt: position.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          type: true,
          status: true,
          originLat: true,
          originLng: true,
          destLat: true,
          destLng: true,
          description: true,
          photoUrl: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return res.json({
        items: page.map((row) => ({
          ...row,
          expiresAt: row.expiresAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify([last.createdAt.toISOString(), last.id]),
              ).toString('base64url')
            : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /services/nearby — Radius search (OPERATOR, PostGIS) ────────────────

servicesRouter.get(
  '/nearby',
  requireRole(UserRole.OPERATOR),
  validate(nearbyServicesQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const { lat, lng, radiusKm } = sr.validated!['query'] as {
        lat: number;
        lng: number;
        radiusKm?: number;
      };
      // DCC-03: radio acotado por el schema; por defecto NEARBY_RADIUS_KM
      // (también acotado al máximo permitido).
      const radiusMeters =
        (radiusKm ?? Math.min(env.NEARBY_RADIUS_KM, NEARBY_MAX_RADIUS_KM)) *
        1000;

      // REQ-003 / REQ-010: PostGIS ST_DWithin via $queryRaw with binds.
      // Requires PostGIS extension (applied in T8 migration).
      // No previewFeatures — raw SQL with parameterized binds.
      const services = await prisma.$queryRaw<
        Array<{
          id: string;
          type: string;
          status: string;
          originLat: number;
          originLng: number;
          destLat: number | null;
          destLng: number | null;
          description: string | null;
          photoUrl: string | null;
          expiresAt: Date;
          createdAt: Date;
          updatedAt: Date;
        }>
      >`
        SELECT
          id, type, status, "originLat", "originLng",
          "destLat", "destLng", description, "photoUrl",
          "expiresAt", "createdAt", "updatedAt"
        FROM "Service"
        WHERE
          ST_DWithin(
            ST_MakePoint("originLng", "originLat")::geography,
            ST_MakePoint(${lng}::float8, ${lat}::float8)::geography,
            ${radiusMeters}::float8
          )
          AND status = 'PENDING'::"ServiceStatus"
          AND "expiresAt" > NOW()
          -- DCC-03: excluye filas antiguas con coordenadas fuera de rango
          -- (el CHECK de BD es NOT VALID y no las corrige).
          AND "originLat" BETWEEN -90 AND 90
          AND "originLng" BETWEEN -180 AND 180
        ORDER BY "createdAt" DESC
        LIMIT ${NEARBY_MAX_RESULTS}
      `;

      // REQ-003: Array público sin datos sensibles del cliente
      res.json(services);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /services/:id — Get service by id ───────────────────────────────────

servicesRouter.get('/:id', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user!;
    const serviceId = req.params.id;

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { client: true },
    });

    if (!service) {
      // REQ-004: Inexistente → 404 (no revela existencia)
      return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
    }

    const isOwner = service.client.userId === user.id;
    const isOperator = user.role === UserRole.OPERATOR;
    const isAdmin = user.role === UserRole.ADMIN;

    if (isOwner || isAdmin) {
      // REQ-004: Dueño/Admin ve completo
      return res.json(service);
    }

    if (isOperator) {
      // REQ-004: Operador ve público (sin datos sensibles del cliente)
      const {
        client: _client,
        clientProfileId: _cpid,
        ...publicData
      } = service;
      return res.json(publicData);
    }

    // REQ-004: Ajeno → 404 (no revela existencia)
    return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /services/:id/status — Update status (owner/assigned) ─────────────

servicesRouter.patch(
  '/:id/status',
  validate(updateServiceStatusSchema, 'body'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const user = sr.user!;
      const serviceId = req.params.id;
      const { status: targetStatus } = sr.validated!['body'] as {
        status: ServiceStatusEnum;
      };

      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { client: true },
      });

      if (!service) {
        return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
      }

      const fromStatus = service.status as ServiceStatusEnum;
      const isOwner = service.client.userId === user.id;

      // REQ-005: Ownership checks based on target transition
      if (user.role === UserRole.CLIENT) {
        // CLIENT can only cancel own services (PENDING→CANCELLED)
        if (!isOwner) {
          return res
            .status(403)
            .json({ error: 'Forbidden', code: 'FORBIDDEN' });
        }
      } else if (user.role === UserRole.OPERATOR) {
        // OPERATOR can only complete assigned services (ACTIVE→COMPLETED)
        if (targetStatus !== ServiceStatus.COMPLETED) {
          return res
            .status(403)
            .json({ error: 'Forbidden', code: 'FORBIDDEN' });
        }
        if (!service.acceptedQuoteId) {
          return res.status(409).json({
            error: 'Not assigned to this service',
            code: 'INVALID_TRANSITION',
          });
        }
      } else {
        // ADMIN and other roles not permitted via API
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      }

      // NOTE: QUOTED→ACTIVE is unreachable at runtime in cambio-004
      // (no quotes yet). The FSM allows it (CLIENT + acceptedQuoteId), but
      // there is no code path that produces a QUOTED service. Transition
      // is covered by unit tests of serviceMachine and by comentario
      // explícito per REQ-005 / design §6.

      // REQ-005 / REQ-001: FSM assertTransition
      assertTransition(fromStatus, targetStatus, user.role);

      // REQ-005 / service-lifecycle: Guard de pago ACTIVE→COMPLETED
      if (
        fromStatus === ServiceStatus.ACTIVE &&
        targetStatus === ServiceStatus.COMPLETED
      ) {
        const payment = await prisma.payment.findUnique({
          where: { serviceId },
        });
        if (!payment || payment.status !== 'CONFIRMED') {
          throw new PaymentPendingError();
        }
      }

      // REQ-005: Persist
      const updated = await prisma.service.update({
        where: { id: serviceId },
        data: { status: targetStatus },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);
