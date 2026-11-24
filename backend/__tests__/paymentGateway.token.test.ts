import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StubPaymentGateway } from '../src/services/paymentGateway';

/**
 * #16 (DES-A08) — el stub compara X-Webhook-Token en tiempo constante.
 * Token válido en tests: `TEST_DEFAULTS.PAYMENT_WEBHOOK_TOKEN` de env.ts.
 */

const timingSafeEqual = vi.hoisted(() => vi.fn());
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual };
});

const BODY = { paymentId: 'pay-1', status: 'CONFIRMED' };
const gateway = new StubPaymentGateway();

beforeEach(() => {
  timingSafeEqual.mockClear();
});

describe('StubPaymentGateway — token del webhook', () => {
  it('compara el token con timingSafeEqual', async () => {
    await gateway.processWebhook(BODY, {
      'x-webhook-token': 'test-webhook-token',
    });
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it.each(['x', 'test-webhook-tokeN', 'test-webhook-token-mas-largo'])(
    'token distinto (%s) → 401 sin lanzar otro error',
    async (token) => {
      await expect(
        gateway.processWebhook(BODY, { 'x-webhook-token': token }),
      ).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    },
  );
});
