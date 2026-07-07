/**
 * Tests unitarios para MercadoPagoGateway (cambio-007 / T5, D7).
 *
 * Usa `vi.mock('mercadopago')` para evitar llamadas de red.
 * Cobertura: init, HMAC inválido, lookup miss, no terminales ignored,
 * approved/rejected, retry idempotente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MercadoPagoGateway } from '../src/services/mercadopagoGateway';
import type { MpGatewayConfig } from '../src/services/mercadopagoGateway';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPreferenceCreate, mockValidate } = vi.hoisted(() => ({
  mockPreferenceCreate: vi.fn(),
  mockValidate: vi.fn(),
}));

vi.mock('mercadopago', () => ({
  MercadoPagoConfig: vi.fn(),
  Preference: vi.fn(() => ({ create: mockPreferenceCreate })),
  WebhookSignatureValidator: { validate: mockValidate },
}));

// ─── Prisma mock ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG: MpGatewayConfig = {
  accessToken: 'APP_USR-test-access-token',
  webhookSecret: 'test-webhook-secret',
  sandbox: true,
  webhookUrl: 'https://example.com/payments/webhook',
};

const MP_PAYMENT_ID = 'mp-pref-123';
const LOCAL_PAYMENT_ID = 'payment-abc-456';

const validHeaders = {
  'x-signature': 'ts=1700000000,v1=abcdef123456',
  'x-request-id': 'req-789',
};

function createGateway(prisma: ReturnType<typeof createMockPrisma> = createMockPrisma()) {
  return new MercadoPagoGateway(prisma, CONFIG);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MercadoPagoGateway (T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── initPayment ──────────────────────────────────────────────────────────

  describe('initPayment', () => {
    it('creates a Preference and returns gatewayPaymentId + redirectUrl', async () => {
      mockPreferenceCreate.mockResolvedValueOnce({
        id: MP_PAYMENT_ID,
        sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/123',
        init_point: 'https://www.mercadopago.com/checkout/123',
      });

      const gateway = createGateway();
      const result = await gateway.initPayment({
        id: LOCAL_PAYMENT_ID,
        amount: 5000,
        commission: 0,
        operatorAmount: 5000,
      });

      expect(result.gatewayPaymentId).toBe(MP_PAYMENT_ID);
      expect(result.redirectUrl).toBe(
        'https://sandbox.mercadopago.com/checkout/123',
      );
      expect(mockPreferenceCreate).toHaveBeenCalledWith({
        body: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: LOCAL_PAYMENT_ID,
              unit_price: 5000,
            }),
          ]),
          external_reference: LOCAL_PAYMENT_ID,
          notification_url: CONFIG.webhookUrl,
        }),
      });
    });

    it('uses sandbox_init_point when config.sandbox=true', async () => {
      mockPreferenceCreate.mockResolvedValueOnce({
        id: 'mp-456',
        sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/456',
        init_point: 'https://www.mercadopago.com/checkout/456',
      });

      const gateway = createGateway();
      const result = await gateway.initPayment({
        id: 'pay-1',
        amount: 3000,
        commission: 0,
        operatorAmount: 3000,
      });

      expect(result.redirectUrl).toContain('sandbox');
    });

    it('uses init_point when config.sandbox=false', async () => {
      const prodConfig: MpGatewayConfig = { ...CONFIG, sandbox: false };
      mockPreferenceCreate.mockResolvedValueOnce({
        id: 'mp-789',
        sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/789',
        init_point: 'https://www.mercadopago.com/checkout/789',
      });

      const gateway = new MercadoPagoGateway(createMockPrisma(), prodConfig);
      const result = await gateway.initPayment({
        id: 'pay-2',
        amount: 1000,
        commission: 0,
        operatorAmount: 1000,
      });

      expect(result.redirectUrl).toBe(
        'https://www.mercadopago.com/checkout/789',
      );
    });
  });

  // ── processWebhook: HMAC ─────────────────────────────────────────────────

  describe('processWebhook — HMAC validation', () => {
    it('validates HMAC and returns CONFIRMED for approved payment', async () => {
      mockValidate.mockReturnValueOnce(undefined); // OK
      const prisma = createMockPrisma();
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: LOCAL_PAYMENT_ID,
        mpPaymentId: MP_PAYMENT_ID,
        status: 'PENDING',
      });

      const gateway = createGateway(prisma);
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'approved' },
        validHeaders,
      );

      expect(result.paymentId).toBe(LOCAL_PAYMENT_ID);
      expect(result.status).toBe('CONFIRMED');
      expect(result.gatewayReference).toBe(MP_PAYMENT_ID);
      expect(mockValidate).toHaveBeenCalledWith(
        expect.objectContaining({
          xSignature: validHeaders['x-signature'],
          xRequestId: validHeaders['x-request-id'],
          dataId: MP_PAYMENT_ID,
          secret: CONFIG.webhookSecret,
        }),
      );
    });

    it('throws when HMAC validation fails', async () => {
      mockValidate.mockImplementationOnce(() => {
        throw new Error('HMAC signature mismatch');
      });

      const gateway = createGateway();
      await expect(
        gateway.processWebhook(
          { data: { id: MP_PAYMENT_ID } },
          { 'x-signature': 'bad-sig', 'x-request-id': 'req-1' },
        ),
      ).rejects.toThrow('HMAC signature mismatch');
    });
  });

  // ── processWebhook: reverse lookup ───────────────────────────────────────

  describe('processWebhook — reverse lookup', () => {
    it('throws 404 when mpPaymentId not found', async () => {
      mockValidate.mockReturnValueOnce(undefined);
      const prisma = createMockPrisma();
      prisma.payment.findUnique.mockResolvedValueOnce(null);

      const gateway = createGateway(prisma);
      try {
        await gateway.processWebhook(
          { data: { id: 'mp-unknown' } },
          validHeaders,
        );
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.status).toBe(404);
        expect(err.message).toContain('mp-unknown');
      }
    });
  });

  // ── processWebhook: state mapping ────────────────────────────────────────

  describe('processWebhook — state mapping', () => {
    function setupPayment(status: string = 'PENDING') {
      mockValidate.mockReturnValueOnce(undefined);
      const prisma = createMockPrisma();
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: LOCAL_PAYMENT_ID,
        mpPaymentId: MP_PAYMENT_ID,
        status,
      });
      return { prisma, gateway: createGateway(prisma) };
    }

    it('returns ignored for pending status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'pending' },
        validHeaders,
      );
      expect(result.status).toBe('ignored');
    });

    it('returns ignored for in_process status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'in_process' },
        validHeaders,
      );
      expect(result.status).toBe('ignored');
    });

    it('returns ignored for in_mediation status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'in_mediation' },
        validHeaders,
      );
      expect(result.status).toBe('ignored');
    });

    it('returns CONFIRMED for approved status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'approved' },
        validHeaders,
      );
      expect(result.status).toBe('CONFIRMED');
    });

    it('returns FAILED for rejected status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'rejected' },
        validHeaders,
      );
      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED for cancelled status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'cancelled' },
        validHeaders,
      );
      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED for refunded status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'refunded' },
        validHeaders,
      );
      expect(result.status).toBe('FAILED');
    });

    it('returns ignored for unknown status', async () => {
      const { gateway } = setupPayment();
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'unknown_status' },
        validHeaders,
      );
      expect(result.status).toBe('ignored');
    });

    it('handles action field format (e.g. payment.approved)', async () => {
      mockValidate.mockReturnValueOnce(undefined);
      const prisma = createMockPrisma();
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: LOCAL_PAYMENT_ID,
        mpPaymentId: MP_PAYMENT_ID,
        status: 'PENDING',
      });

      const gateway = createGateway(prisma);
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, action: 'payment.approved' },
        validHeaders,
      );
      expect(result.status).toBe('CONFIRMED');
    });
  });

  // ── processWebhook: retry / idempotent ───────────────────────────────────

  describe('processWebhook — idempotent retry', () => {
    it('returns already-terminal status without error when payment is CONFIRMED', async () => {
      mockValidate.mockReturnValueOnce(undefined);
      const prisma = createMockPrisma();
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: LOCAL_PAYMENT_ID,
        mpPaymentId: MP_PAYMENT_ID,
        status: 'CONFIRMED',
      });

      const gateway = createGateway(prisma);
      const result = await gateway.processWebhook(
        { data: { id: MP_PAYMENT_ID }, status: 'approved' },
        validHeaders,
      );

      // Gateway returns CONFIRMED — route handles idempotency
      expect(result.status).toBe('CONFIRMED');
      expect(result.paymentId).toBe(LOCAL_PAYMENT_ID);
    });
  });

  // ── processWebhook: missing data.id ──────────────────────────────────────

  describe('processWebhook — missing data.id', () => {
    it('throws 400 when data.id is missing from payload', async () => {
      mockValidate.mockImplementationOnce(() => {
        // validate passes but there's no data.id
      });

      const gateway = createGateway();
      try {
        await gateway.processWebhook({}, validHeaders);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.status).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
