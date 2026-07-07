/**
 * PaymentGateway interface + StubPaymentGateway + errores (cambio-006 / REQ-005,
 * cambio-007 / T3, T4).
 *
 * La interfaz abstrae el proveedor de pagos (stub para dev, MercadoPago en
 * cambio-007+). El StubPaymentGateway simula un gateway real:
 *  - initPayment → gatewayPaymentId determinístico `stub-{id}` + redirectUrl
 *  - processWebhook → valida X-Webhook-Token, extrae paymentId/status del payload
 */

import { env } from '../lib/env';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentGateway {
  initPayment(payment: {
    id: string;
    amount: number;
    commission: number;
    operatorAmount: number;
  }): Promise<{ gatewayPaymentId: string; redirectUrl?: string }>;

  processWebhook(
    payload: unknown,
    headers?: WebhookHeaders,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED' | 'ignored';
    gatewayReference?: string;
  }>;
}

// ─── StubPaymentGateway ──────────────────────────────────────────────────────

export class StubPaymentGateway implements PaymentGateway {
  async initPayment(payment: {
    id: string;
    amount: number;
    commission: number;
    operatorAmount: number;
  }): Promise<{ gatewayPaymentId: string; redirectUrl?: string }> {
    return {
      gatewayPaymentId: `stub-${payment.id}`,
      redirectUrl: `https://pago.stub/${payment.id}`,
    };
  }

  async processWebhook(
    payload: unknown,
    headers?: WebhookHeaders,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED';
    gatewayReference?: string;
  }> {
    // REQ-002: Validar X-Webhook-Token (movido desde el route en T3)
    const token = headers?.['x-webhook-token'];
    if (typeof token !== 'string' || token !== env.PAYMENT_WEBHOOK_TOKEN) {
      throw Object.assign(new Error('Invalid webhook token'), {
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }

    const data = payload as { paymentId: string; status: string };
    return {
      paymentId: data.paymentId,
      status: data.status === 'FAILED' ? 'FAILED' : 'CONFIRMED',
    };
  }
}

// ─── Errores ─────────────────────────────────────────────────────────────────

/**
 * Error 409 para cuando se intenta procesar un Payment que ya está en estado
 * terminal (CONFIRMED/FAILED). Sigue el patrón de AlreadyAcceptedError en
 * quotes.routes.ts.
 */
export class AlreadyProcessedError extends Error {
  status = 409;
  code = 'ALREADY_PROCESSED' as const;

  constructor(message = 'Payment already processed') {
    super(message);
    this.name = 'AlreadyProcessedError';
  }
}

/**
 * Error 409 para cuando un service tiene Payment PENDING y se intenta
 * ACTIVE→COMPLETED. Sigue el patrón de AlreadyAcceptedError (status+code).
 */
export class PaymentPendingError extends Error {
  status = 409;
  code = 'PAYMENT_PENDING' as const;

  constructor(message = 'Payment is required before completing service') {
    super(message);
    this.name = 'PaymentPendingError';
  }
}

/**
 * Error 502 para errores inesperados del SDK de MercadoPago o de red.
 * Sigue el patrón de errores de dominio (status + code).
 */
export class MercadoPagoError extends Error {
  status = 502;
  code = 'MERCADOPAGO_ERROR' as const;

  constructor(
    message = 'MercadoPago integration error',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MercadoPagoError';
  }
}
