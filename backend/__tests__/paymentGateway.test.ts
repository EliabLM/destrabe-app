import { describe, it, expect, vi } from 'vitest';
import { StubPaymentGateway, AlreadyProcessedError } from '../src/services/paymentGateway';
import { getPaymentGateway } from '../src/services/paymentFactory';

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
    const result = await gateway.processWebhook({
      paymentId: 'pay-123',
      status: 'CONFIRMED',
    });

    expect(result.paymentId).toBe('pay-123');
    expect(result.status).toBe('CONFIRMED');
  });

  it('processWebhook returns FAILED when payload status is FAILED', async () => {
    const result = await gateway.processWebhook({
      paymentId: 'pay-456',
      status: 'FAILED',
    });

    expect(result.paymentId).toBe('pay-456');
    expect(result.status).toBe('FAILED');
  });
});

// ─── Factory ──────────────────────────────────────────────────────────────────

describe('getPaymentGateway factory (REQ-005)', () => {
  it('returns StubPaymentGateway when gateway is stub', () => {
    const gateway = getPaymentGateway('stub');
    expect(gateway).toBeInstanceOf(StubPaymentGateway);
  });

  it('throws for unknown gateway', () => {
    expect(() => getPaymentGateway('unknown')).toThrow('Unknown payment gateway');
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
