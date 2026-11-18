import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { ServiceStatus, UserRole } from '@destrabe/shared';
import type { CreateQuoteInput } from '@destrabe/shared';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import type { ValidatedRequest } from '../middleware/validate';
import { createQuoteSchema, acceptQuoteSchema } from '@destrabe/shared';
import { prisma } from '../lib/prisma';
import { assertTransition, ConflictError } from '../services/serviceMachine';
import { notifyClient } from '../lib/notifications';
import { env } from '../lib/env';
import { calculateCommission } from '../services/commission';

/**
 * Quotes routes — cambio-005 / REQ-001..007.
 *
 * Dos routers (design §D1):
 *   - serviceQuotesRouter: montado bajo /services → /:id/quotes (POST, GET)
 *   - quotesAcceptRouter:  montado bajo /quotes   → /:id/accept (POST)
 *
 * Reutiliza FSM (assertTransition), validate, requireAuth/requireRole y
 * notifyClient de cambio-004 sin modificar serviceMachine.ts.
 */

type ServiceRequest = AuthedRequest & ValidatedRequest;

/**
 * Error para idempotencia de accept (design §D3).
 * `ConflictError` en serviceMachine.ts tiene `code='INVALID_TRANSITION'` as
 * const (hardcoded), así que no se puede reutilizar para ALREADY_ACCEPTED sin
 * modificar la FSM. Esta clase local replica el formato (status+code) que
 * espera `errorHandler`.
 */
export class AlreadyAcceptedError extends Error {
  status = 409;
  code = 'ALREADY_ACCEPTED' as const;

  constructor(message = 'Service already accepted a quote') {
    super(message);
    this.name = 'AlreadyAcceptedError';
  }
}

// ─── Router /services/:id/quotes ─────────────────────────────────────────────

export const serviceQuotesRouter = Router();

serviceQuotesRouter.use(requireAuth);

// POST /:id/quotes — Operador crea cotización (REQ-001/007)
serviceQuotesRouter.post(
  '/:id/quotes',
  requireRole(UserRole.OPERATOR),
  validate(createQuoteSchema, 'body'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const user = sr.user!;
      const serviceId = req.params.id as string;
      const data = sr.validated!['body'] as CreateQuoteInput;

      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { client: true },
      });
      if (!service) {
        return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
      }

      // REQ-001: solo PENDING o QUOTED aceptan quotes
      if (
        service.status !== ServiceStatus.PENDING &&
        service.status !== ServiceStatus.QUOTED
      ) {
        return res.status(409).json({
          error: 'Service not accepting quotes',
          code: 'INVALID_TRANSITION',
        });
      }

      // REQ-001: OperatorProfile preexistente requerido
      const operatorProfile = await prisma.operatorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!operatorProfile) {
        return res.status(422).json({
          error: 'Operator profile required to quote',
          code: 'OPERATOR_PROFILE_REQUIRED',
        });
      }

      // DCC-08: solo cotiza un operador disponible.
      if (!operatorProfile.available) {
        return res.status(409).json({
          error: 'Operator must be available to quote',
          code: 'OPERATOR_NOT_AVAILABLE',
        });
      }

      // DCC-08: una cotización por operador y servicio. Si ya cotizó, la nueva
      // reemplaza a la anterior. La fila del servicio se bloquea para que una
      // aceptación simultánea no cobre un importe distinto del guardado.
      const result = await prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: ServiceStatus }[]>`
          SELECT status FROM "Service" WHERE id = ${serviceId} FOR UPDATE`;
        if (
          !locked ||
          (locked.status !== ServiceStatus.PENDING &&
            locked.status !== ServiceStatus.QUOTED)
        ) {
          return null;
        }

        const key = {
          serviceId_operatorProfileId: {
            serviceId,
            operatorProfileId: operatorProfile.id,
          },
        };
        const fields = {
          amount: data.amount,
          estimatedMinutes: data.estimatedMinutes ?? null,
          note: data.note ?? null,
        };
        const existing = await tx.quote.findUnique({
          where: key,
          select: { id: true },
        });
        const q = existing
          ? await tx.quote.update({
              where: key,
              data: { ...fields, createdAt: new Date() },
            })
          : await tx.quote.create({
              data: {
                serviceId,
                operatorProfileId: operatorProfile.id,
                ...fields,
              },
            });

        if (locked.status === ServiceStatus.PENDING) {
          assertTransition(
            ServiceStatus.PENDING,
            ServiceStatus.QUOTED,
            'system',
          );
          await tx.service.update({
            where: { id: serviceId },
            data: { status: ServiceStatus.QUOTED },
          });
        }
        return { quote: q, replaced: existing !== null };
      });

      if (!result) {
        return res.status(409).json({
          error: 'Service not accepting quotes',
          code: 'INVALID_TRANSITION',
        });
      }
      const { quote, replaced } = result;

      // REQ-007: notifica al cliente en CADA quote (service original, pre-update)
      notifyClient(service, 'quote_received');

      res.status(replaced ? 200 : 201).json({
        id: quote.id,
        amount: quote.amount,
        estimatedMinutes: quote.estimatedMinutes,
        note: quote.note,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /:id/quotes — Visibilidad por rol (REQ-002)
serviceQuotesRouter.get('/:id/quotes', async (req, res, next) => {
  try {
    const sr = req as ServiceRequest;
    const user = sr.user!;
    const serviceId = req.params.id as string;

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { client: true },
    });
    if (!service) {
      return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
    }

    const isOwner = service.client.userId === user.id;
    const isAdmin = user.role === UserRole.ADMIN;

    if (isOwner || isAdmin) {
      // REQ-002: dueño/admin ven todas con datos públicos del operador
      const quotes = await prisma.quote.findMany({
        where: { serviceId },
        include: {
          operator: {
            select: { truckType: true, licensePlate: true, rating: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(quotes);
    }

    if (user.role === UserRole.OPERATOR) {
      // REQ-002: operador ve solo sus quotes
      const operatorProfile = await prisma.operatorProfile.findUnique({
        where: { userId: user.id },
      });
      if (!operatorProfile) return res.json([]);
      const quotes = await prisma.quote.findMany({
        where: { serviceId, operatorProfileId: operatorProfile.id },
        orderBy: { createdAt: 'desc' },
      });
      return res.json(quotes);
    }

    // REQ-002: ajeno → 404 (no revela existencia)
    return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
  } catch (err) {
    next(err);
  }
});

// ─── Router /quotes/:id/accept ───────────────────────────────────────────────

export const quotesAcceptRouter = Router();

quotesAcceptRouter.use(requireAuth);

// POST /:id/accept — Cliente dueño acepta cotización (REQ-003/006)
quotesAcceptRouter.post(
  '/:id/accept',
  requireRole(UserRole.CLIENT),
  validate(acceptQuoteSchema, 'body'),
  async (req, res, next) => {
    try {
      const sr = req as ServiceRequest;
      const user = sr.user!;
      const quoteId = req.params.id as string;

      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
        include: { service: { include: { client: true } } },
      });
      if (!quote) {
        return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
      }

      const service = quote.service;
      const isOwner = service.client.userId === user.id;
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      }

      // REQ-003: idempotencia — ya ACTIVE
      if (service.status === ServiceStatus.ACTIVE) {
        throw new AlreadyAcceptedError();
      }

      // REQ-003: FSM transition QUOTED→ACTIVE por CLIENT
      assertTransition(
        service.status as ServiceStatus,
        ServiceStatus.ACTIVE,
        'CLIENT',
      );

      // REQ-003/006: $transaction — Service ACTIVE+acceptedQuoteId + Payment.
      // DCC-08: el importe se relee dentro de la transacción, después de
      // bloquear el servicio, y la comisión se calcula aquí y solo aquí.
      try {
        const updated = await prisma.$transaction(async (tx) => {
          const { count } = await tx.service.updateMany({
            where: { id: service.id, status: ServiceStatus.QUOTED },
            data: {
              status: ServiceStatus.ACTIVE,
              acceptedQuoteId: quote.id,
              assignedOperatorProfileId: quote.operatorProfileId,
            },
          });
          if (count !== 1) {
            // Otra petición lo aceptó o el barrido lo canceló entre la
            // lectura y la transacción.
            const now = await tx.service.findUniqueOrThrow({
              where: { id: service.id },
              select: { status: true },
            });
            if (now.status === ServiceStatus.ACTIVE) {
              throw new AlreadyAcceptedError();
            }
            throw new ConflictError(
              `Cannot accept a quote on a ${now.status} service`,
            );
          }
          const current = await tx.quote.findUniqueOrThrow({
            where: { id: quote.id },
            select: { amount: true },
          });
          const { commission, operatorAmount } = calculateCommission(
            current.amount,
            env.PAYMENT_COMMISSION_RATE,
          );
          await tx.payment.create({
            data: {
              serviceId: service.id,
              amount: current.amount,
              commission,
              operatorAmount,
              status: 'PENDING',
              mpPaymentId: null,
            },
          });
          return tx.service.findUniqueOrThrow({ where: { id: service.id } });
        });
        res.json(updated);
      } catch (err) {
        // REQ-003: P2002 @unique violation (race en acceptedQuoteId / payment.serviceId)
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new AlreadyAcceptedError();
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);
