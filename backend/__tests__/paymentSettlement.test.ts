import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settlePendingPayment } from '../src/services/paymentSettlement';

/**
 * #16 — Transición PENDING → CONFIRMED/FAILED compartida por el webhook y
 * la simulación de pago. Solo cambia el pago si sigue PENDING.
 */

const updateMany = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/prisma', () => ({
  prisma: { payment: { updateMany } },
}));

beforeEach(() => updateMany.mockReset());

describe('settlePendingPayment', () => {
  it('confirma un pago PENDING y devuelve true', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await expect(settlePendingPayment('pay-1', 'CONFIRMED')).resolves.toBe(
      true,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
  });

  it('guarda la referencia de la pasarela si viene', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await settlePendingPayment('pay-1', 'FAILED', 'mp-99');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: 'PENDING' },
      data: { status: 'FAILED', mpPaymentId: 'mp-99' },
    });
  });

  it('devuelve false si el pago ya no estaba PENDING', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(settlePendingPayment('pay-1', 'CONFIRMED')).resolves.toBe(
      false,
    );
  });
});
