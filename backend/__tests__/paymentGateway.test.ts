import { describe, it, expect } from 'vitest';
import {
  StubPaymentGateway,
  AlreadyProcessedError,
  MercadoPagoError,
  type WebhookHeaders,
} from '../src/services/paymentGateway';
import { getPaymentGateway } from '../src/services/paymentFactory';
import { MercadoPagoGateway } from '../src/services/mercadopagoGateway';

/** Webhook token coincidente con `TEST_DEFAULTS.PAYMENT_WEBHOOK_TOKEN` en env.ts */
const VALID_TOKEN = 'test-webhook-token';
const AUTH_HEADERS: WebhookHeaders = { 'x-webhook-token': VALID_TOKEN };

/**
 * T4 — PaymentGateway + Stub + factory (REQ-005)
 *
 * Cobertura: stub retorna id determinístico; factory default 'stub'.
 */

// ─── StubPaymentGateway ───────────────────────────────────────────────────────

describe('StubPaymentGateway (REQ-005)', () => {
  const gateway = new StubPaymentGateway();

  it('initPayment returns deterministic gatewayPaymentId', async () => {
    const result = await gateway.initPayment({
      id: 'pay-123',
      amount: 5000,
      commission: 500,
      operatorAmount: 4500,
    });

    expect(result.gatewayPaymentId).toBe('stub-pay-123');
    expect(result.redirectUrl).toBe('https://pago.stub/pay-123');
  });

  it('initPayment works with different id', async () => {
    const result = await gateway.initPayment({
      id: 'pay-456',
      amount: 3000,
      commission: 0,
      operatorAmount: 3000,
    });

    expect(result.gatewayPaymentId).toBe('stub-pay-456');
  });

  it('processWebhook returns CONFIRMED with paymentId from payload', async () => {
    const result = await gateway.processWebhook(
      { paymentId: 'pay-123', status: 'CONFIRMED' },
      AUTH_HEADERS,
    );

    expect(result.paymentId).toBe('pay-123');
    expect(result.status).toBe('CONFIRMED');
  });

  it('processWebhook returns FAILED when payload status is FAILED', async () => {
    const result = await gateway.processWebhook(
      { paymentId: 'pay-456', status: 'FAILED' },
      AUTH_HEADERS,
    );

    expect(result.paymentId).toBe('pay-456');
    expect(result.status).toBe('FAILED');
  });

  it('processWebhook throws 401 when X-Webhook-Token is missing', async () => {
    await expect(
      gateway.processWebhook({ paymentId: 'pay-123', status: 'CONFIRMED' }),
    ).rejects.toThrow('Invalid webhook token');
  });

  it('processWebhook throws 401 when X-Webhook-Token is wrong', async () => {
    await expect(
      gateway.processWebhook(
        { paymentId: 'pay-123', status: 'CONFIRMED' },
        { 'x-webhook-token': 'wrong-token' },
      ),
    ).rejects.toThrow('Invalid webhook token');
  });

  it('processWebhook thrown error has status=401 and code=UNAUTHORIZED', async () => {
    await expect(
      gateway.processWebhook(
        { paymentId: 'pay-123', status: 'CONFIRMED' },
        { 'x-webhook-token': 'wrong-token' },
      ),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });
});

// ─── Factory ──────────────────────────────────────────────────────────────────

describe('getPaymentGateway factory (REQ-005)', () => {
  it('returns StubPaymentGateway when gateway is stub', () => {
    const gateway = getPaymentGateway('stub');
    expect(gateway).toBeInstanceOf(StubPaymentGateway);
  });

  it('throws for unknown gateway', () => {
    expect(() => getPaymentGateway('unknown')).toThrow(
      'Unknown payment gateway',
    );
  });

  it('returns MercadoPagoGateway when gateway is mercadopago', () => {
    const gateway = getPaymentGateway('mercadopago');
    expect(gateway).toBeInstanceOf(MercadoPagoGateway);
  });
});

// ─── AlreadyProcessedError ────────────────────────────────────────────────────

describe('AlreadyProcessedError', () => {
  it('has status=409, code="ALREADY_PROCESSED", and message', () => {
    const err = new AlreadyProcessedError('Payment already processed');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.code).toBe('ALREADY_PROCESSED');
    expect(err.message).toBe('Payment already processed');
  });

  it('uses default message when not provided', () => {
    const err = new AlreadyProcessedError();
    expect(err.message).toBe('Payment already processed');
  });
});

// ─── MercadoPagoError (T4) ──────────────────────────────────────────────────

describe('MercadoPagoError (T4)', () => {
  it('has status=502, code="MERCADOPAGO_ERROR", and message', () => {
    const err = new MercadoPagoError('MP API failure');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(502);
    expect(err.code).toBe('MERCADOPAGO_ERROR');
    expect(err.message).toBe('MP API failure');
  });

  it('uses default message when not provided', () => {
    const err = new MercadoPagoError();
    expect(err.message).toBe('MercadoPago integration error');
  });

  it('accepts cause option', () => {
    const cause = new Error('underlying network error');
    const err = new MercadoPagoError('MP failure', { cause });
    expect(err.cause).toBe(cause);
  });
});
