import { prisma } from '../lib/prisma';

/**
 * Transición PENDING → CONFIRMED/FAILED de un Payment (#16).
 *
 * La usan el webhook de la pasarela y la simulación de pago de la demo, para
 * no duplicar la lógica. Solo actualiza si el pago sigue PENDING (condición
 * en el `where`), así dos confirmaciones simultáneas no se pisan.
 *
 * @returns `true` si el pago cambió; `false` si ya no estaba PENDING.
 */
export async function settlePendingPayment(
  paymentId: string,
  status: 'CONFIRMED' | 'FAILED',
  gatewayReference?: string,
): Promise<boolean> {
  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: {
      status,
      ...(gatewayReference ? { mpPaymentId: gatewayReference } : {}),
    },
  });
  return count === 1;
}
