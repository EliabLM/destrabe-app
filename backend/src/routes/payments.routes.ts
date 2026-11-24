import { Router, type RequestHandler } from 'express';
import {
  UserRole,
  simulatePaymentSchema,
  type SimulatePaymentInput,
} from '@destrabe/shared';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { validate, type ValidatedRequest } from '../middleware/validate';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { getPaymentGateway } from '../services/paymentFactory';
import { settlePendingPayment } from '../services/paymentSettlement';
import {
  AlreadyProcessedError,
  PaymentPendingError,
  MercadoPagoError,
  type WebhookHeaders,
} from '../services/paymentGateway';

/**
 * Payments routes — cambio-006 / REQ-001, REQ-002, REQ-004.
 *
 * Endpoints:
 *   POST /:id/init     — CLIENT dueño inicia pago (requireAuth + requireRole)
 *   POST /:id/simulate — demo (#16): el dueño aprueba o rechaza el pago; solo
 *                        con gateway stub y flag `pagoSimulado`
 *   POST /webhook      — público, valida X-Webhook-Token, idempotente
 */

type PaymentRequest = AuthedRequest & ValidatedRequest;

export const paymentsRouter = Router();

// ─── POST /:id/init — Inicializar pago (REQ-001) ────────────────────────────

paymentsRouter.post(
  '/:id/init',
  requireAuth,
  requireRole(UserRole.CLIENT),
  async (req, res, next) => {
    try {
      const sr = req as PaymentRequest;
      const user = sr.user!;
      const paymentId = req.params.id as string;

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { service: { include: { client: true } } },
      });
      if (!payment) {
        return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
      }

      // REQ-001: Ownership — solo el CLIENT dueño del service
      const isOwner = payment.service.client.userId === user.id;
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      }

      // REQ-001: Solo PENDING puede iniciarse
      if (payment.status !== 'PENDING') {
        throw new AlreadyProcessedError('Payment already processed');
      }

      // REQ-005: Invocar gateway con los importes fijados al crear el
      // Payment (DCC-08: la comisión no se recalcula aquí).
      const gateway = getPaymentGateway();
      const gatewayResult = await gateway.initPayment({
        id: payment.id,
        amount: payment.amount,
        commission: payment.commission,
        operatorAmount: payment.operatorAmount,
      });

      // REQ-001: Persistir mpPaymentId
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: { mpPaymentId: gatewayResult.gatewayPaymentId },
      });

      res.json({
        gatewayPaymentId: updated.mpPaymentId,
        redirectUrl: gatewayResult.redirectUrl,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /webhook — Webhook de confirmación (REQ-002, T7) ───────────────────

paymentsRouter.post('/webhook', async (req, res, next) => {
  try {
    // T7: Delegar verificación + parseo al gateway (sin validate middleware)
    const gateway = getPaymentGateway();
    const result = await gateway.processWebhook(
      req.body,
      req.headers as WebhookHeaders,
    );

    if (!result.paymentId) {
      return res
        .status(400)
        .json({ error: 'Validation error', code: 'VALIDATION_ERROR' });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: result.paymentId },
    });
    if (!payment) {
      return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
    }

    // REQ-004: Idempotencia — si terminal, no mutar
    if (payment.status !== 'PENDING') {
      return res.json({ status: payment.status });
    }

    // REQ-MP-NOTIFICATION: no terminal → ignorar sin mutar BD
    if (result.status === 'ignored') {
      return res.json({ status: 'ignored' });
    }

    // REQ-002/004: Transicionar PENDING → CONFIRMED/FAILED (#16: misma
    // transición que la simulación de pago).
    const settled = await settlePendingPayment(
      payment.id,
      result.status,
      result.gatewayReference,
    );
    if (!settled) {
      // Otro proceso lo cerró entre la lectura y la escritura: idempotente.
      const current = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { status: true },
      });
      return res.json({ status: current.status });
    }

    res.json({ status: result.status });
  } catch (err) {
    // T7: Mapear errores de dominio a HTTP
    const e = err as Error & { status?: number; code?: string };
    if (
      e instanceof AlreadyProcessedError ||
      e instanceof PaymentPendingError
    ) {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    if (e instanceof MercadoPagoError) {
      return res.status(502).json({ error: e.message, code: e.code });
    }
    if (e.status === 401 || e.code === 'UNAUTHORIZED') {
      return res.status(401).json({ error: e.message, code: 'UNAUTHORIZED' });
    }
    if (e.status === 404 || e.code === 'NOT_FOUND') {
      return res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    }
    if (e.status === 400 || e.code === 'VALIDATION_ERROR') {
      return res
        .status(400)
        .json({ error: e.message, code: 'VALIDATION_ERROR' });
    }
    next(err);
  }
});

// ─── POST /:id/simulate — Pago simulado de la demo (#16) ─────────────────────

/** 404 (como ruta inexistente) si la pasarela no es el stub. */
const requireStubGateway: RequestHandler = (_req, res, next) => {
  if (env.PAYMENT_GATEWAY !== 'stub') {
    return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
  }
  next();
};

const SIMULATED_STATUS = {
  approved: 'CONFIRMED',
  rejected: 'FAILED',
} as const;

paymentsRouter.post(
  '/:id/simulate',
  requireAuth,
  requireStubGateway,
  requireFeature('pagoSimulado'),
  validate(simulatePaymentSchema, 'body'),
  async (req, res, next) => {
    try {
      const sr = req as PaymentRequest;
      const paymentId = req.params.id as string;
      const { result } = sr.validated!['body'] as SimulatePaymentInput;

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { service: { include: { client: true } } },
      });
      // Inexistente o de otro usuario: 404, sin revelar que existe.
      if (!payment || payment.service.client.userId !== sr.user!.id) {
        return res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' });
      }

      if (payment.status !== 'PENDING') {
        throw new AlreadyProcessedError();
      }

      const status = SIMULATED_STATUS[result];
      if (!(await settlePendingPayment(payment.id, status))) {
        throw new AlreadyProcessedError();
      }

      res.json({ id: payment.id, status });
    } catch (err) {
      next(err);
    }
  },
);
