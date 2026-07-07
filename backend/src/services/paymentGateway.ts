/**
 * PaymentGateway interface + StubPaymentGateway + errores (cambio-006 / REQ-005).
 *
 * La interfaz abstrae el proveedor de pagos (stub para dev, MercadoPago en
 * cambio-007+). El StubPaymentGateway simula un gateway real:
 *  - initPayment → gatewayPaymentId determinístico `stub-{id}` + redirectUrl
 *  - processWebhook → extrae paymentId/status del payload, aprueba todo
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PaymentGateway {
  initPayment(payment: {
    id: string;
    amount: number;
    commission: number;
    operatorAmount: number;
  }): Promise<{ gatewayPaymentId: string; redirectUrl?: string }>;

  processWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED';
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
    _signature?: string,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED';
    gatewayReference?: string;
  }> {
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
