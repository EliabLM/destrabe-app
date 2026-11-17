import { describe, expect, it, vi } from 'vitest';

/**
 * DCC-05 (revisión): ante una ráfaga, si la transacción de conteo agota
 * `maxWait`/`timeout` (Prisma P2028), la respuesta es 503 y nunca 500.
 */

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({
  prisma: { $transaction: transactionMock },
}));

import { Prisma } from '@prisma/client';
import { reserveSmsSend, SMS_TX_OPTIONS } from '../src/lib/smsGuard';

describe('reserveSmsSend — tiempos de espera de la transacción', () => {
  it('fija maxWait y timeout explícitos', async () => {
    transactionMock.mockResolvedValueOnce(null);
    await reserveSmsSend('+573001234567', '203.0.113.7');
    expect(SMS_TX_OPTIONS).toEqual({ maxWait: 5_000, timeout: 10_000 });
    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      SMS_TX_OPTIONS,
    );
  });

  it('P2028 (timeout de transacción) → 503 SMS_TEMPORARILY_UNAVAILABLE', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    transactionMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'Transaction API error: Unable to start a transaction in the given time.',
        { code: 'P2028', clientVersion: 'test' },
      ),
    );
    await expect(
      reserveSmsSend('+573001234567', '203.0.113.7'),
    ).rejects.toMatchObject({
      statusCode: 503,
      body: expect.objectContaining({ code: 'SMS_TEMPORARILY_UNAVAILABLE' }),
    });
  });

  it('otros errores de BD no se disfrazan de límite', async () => {
    transactionMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      reserveSmsSend('+573001234567', '203.0.113.7'),
    ).rejects.toThrow('db down');
  });
});
