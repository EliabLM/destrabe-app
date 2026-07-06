import { ServiceStatus } from '@destrabe/shared';
import { prisma } from '../lib/prisma';
import { notifyClient } from '../lib/notifications';
import { assertTransition } from '../services/serviceMachine';
import { createWorker } from '../lib/queue';

/**
 * Service expiry job — REQ-006 / design §D2.
 *
 * `expirePendingService(serviceId)` is the pure (isolated) handler:
 *   - If service is PENDING: assertTransition(system), persist CANCELLED, notify.
 *   - If service is NOT PENDING (already CANCELLED, ACTIVE, etc.): no-op (idempotent).
 *
 * `registerServiceExpiryWorker()` creates and returns a BullMQ Worker that
 * invokes `expirePendingService` for each job.
 */

/**
 * Expire a pending service: transition to CANCELLED by system.
 *
 * Idempotent: if the service is already in a non-PENDING status, does nothing.
 * This prevents double-processing if BullMQ retries a completed job.
 */
export async function expirePendingService(serviceId: string): Promise<void> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
  });

  if (!service || service.status !== ServiceStatus.PENDING) return;

  // Assert the transition is legal (throws ConflictError if not)
  assertTransition(ServiceStatus.PENDING, ServiceStatus.CANCELLED, 'system');

  await prisma.service.update({
    where: { id: serviceId },
    data: { status: ServiceStatus.CANCELLED },
  });

  notifyClient(service, 'expired');
}

/**
 * Register a BullMQ Worker that calls `expirePendingService` for each job.
 * Returns the Worker instance (caller should manage its lifecycle).
 */
export function registerServiceExpiryWorker() {
  return createWorker(async (job) => {
    await expirePendingService(job.data.serviceId);
  });
}
