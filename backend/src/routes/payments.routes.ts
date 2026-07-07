import { Router } from 'express';
import { UserRole } from '@destrabe/shared';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import type { ValidatedRequest } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { calculateCommission } from '../services/commission';
import { getPaymentGateway } from '../services/paymentFactory';
import {
  AlreadyProcessedError,
  PaymentPendingError,
  MercadoPagoError,
  type WebhookHeaders,
} from '../services/paymentGateway';

/**
 * Payments routes — cambio-006 / REQ-001, REQ-002, REQ-004.
 *
 * Dos endpoints:
 *   POST /:id/init   — CLIENT dueño inicia pago (requireAuth + requireRole)
 *   POST /webhook    — público, valida X-Webhook-Token, idempotente
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
      const paymentId = req.params.id;

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

      // REQ-003: Calcular comisión
      const { commission, operatorAmount } = calculateCommission(
        payment.amount,
        env.PAYMENT_COMMISSION_RATE,
      );

      // REQ-005: Invocar gateway
      const gateway = getPaymentGateway();
      const gatewayResult = await gateway.initPayment({
        id: payment.id,
        amount: payment.amount,
        commission,
        operatorAmount,
      });

      // REQ-001: Persistir comisión + mpPaymentId
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          commission,
          operatorAmount,
          mpPaymentId: gatewayResult.gatewayPaymentId,
        },
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

    // REQ-003: Recalcular comisión (defensa si amount mutó)
    const { commission, operatorAmount } = calculateCommission(
      payment.amount,
      env.PAYMENT_COMMISSION_RATE,
    );

    // REQ-002/004: Transicionar PENDING → CONFIRMED/FAILED
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result.status as 'CONFIRMED' | 'FAILED',
        commission,
        operatorAmount,
        mpPaymentId: result.gatewayReference ?? payment.mpPaymentId,
      },
    });

    res.json({ status: updated.status });
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
