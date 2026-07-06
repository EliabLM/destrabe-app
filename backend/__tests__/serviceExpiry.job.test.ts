import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceStatus } from '@destrabe/shared';

/**
 * T6 — queue.ts + serviceExpiry.job (REQ-006)
 *
 * Unit tests for:
 *  - `expirePendingService(serviceId)` — PENDING → persist CANCELLED + notify;
 *    non-PENDING → idempotent no-op
 *  - `enqueueServiceExpiry(serviceId, delayMs)` — spies on `queue.add()`
 */

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const prismaFindUniqueMock = vi.hoisted(() => vi.fn());
const prismaUpdateMock = vi.hoisted(() => vi.fn());
const notifyClientMock = vi.hoisted(() => vi.fn());
const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    service: {
      findUnique: prismaFindUniqueMock,
      update: prismaUpdateMock,
    },
  },
}));

vi.mock('../src/lib/notifications', () => ({
  notifyClient: notifyClientMock,
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ add: queueAddMock })),
  Worker: vi.fn(() => ({
    run: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({})),
}));

// ─── expirePendingService ────────────────────────────────────────────────────

describe('expirePendingService (REQ-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates PENDING service to CANCELLED and calls notifyClient', async () => {
    prismaFindUniqueMock.mockResolvedValue({
      id: 'svc-1',
      status: ServiceStatus.PENDING,
      clientProfileId: 'cp-456',
    });
    prismaUpdateMock.mockResolvedValue({
      id: 'svc-1',
      status: ServiceStatus.CANCELLED,
    });

    const { expirePendingService } = await import(
      '../src/jobs/serviceExpiry.job'
    );
    await expirePendingService('svc-1');

    // Should assert transition (PENDING → CANCELLED by system) then persist
    expect(prismaFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
    });
    expect(prismaUpdateMock).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: { status: ServiceStatus.CANCELLED },
    });
    expect(notifyClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'svc-1', clientProfileId: 'cp-456' }),
      'expired',
    );
  });

  it('does nothing when service is already CANCELLED (idempotent)', async () => {
    prismaFindUniqueMock.mockResolvedValue({
      id: 'svc-2',
      status: ServiceStatus.CANCELLED,
      clientProfileId: 'cp-789',
    });

    const { expirePendingService } = await import(
      '../src/jobs/serviceExpiry.job'
    );
    await expirePendingService('svc-2');

    expect(prismaUpdateMock).not.toHaveBeenCalled();
    expect(notifyClientMock).not.toHaveBeenCalled();
  });

  it('does nothing when service does not exist (idempotent)', async () => {
    prismaFindUniqueMock.mockResolvedValue(null);

    const { expirePendingService } = await import(
      '../src/jobs/serviceExpiry.job'
    );
    await expirePendingService('svc-nonexistent');

    expect(prismaUpdateMock).not.toHaveBeenCalled();
    expect(notifyClientMock).not.toHaveBeenCalled();
  });

  it('does nothing when service is ACTIVE (idempotent)', async () => {
    prismaFindUniqueMock.mockResolvedValue({
      id: 'svc-3',
      status: ServiceStatus.ACTIVE,
    });

    const { expirePendingService } = await import(
      '../src/jobs/serviceExpiry.job'
    );
    await expirePendingService('svc-3');

    expect(prismaUpdateMock).not.toHaveBeenCalled();
    expect(notifyClientMock).not.toHaveBeenCalled();
  });
});

// ─── enqueueServiceExpiry ────────────────────────────────────────────────────

describe('enqueueServiceExpiry (REQ-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls queue.add with serviceExpiry name, serviceId data, and delay', async () => {
    const { enqueueServiceExpiry } = await import('../src/lib/queue');
    await enqueueServiceExpiry('svc-1', 900_000);

    expect(queueAddMock).toHaveBeenCalledWith(
      'serviceExpiry',
      { serviceId: 'svc-1' },
      { delay: 900_000 },
    );
  });

  it('allows different delays', async () => {
    const { enqueueServiceExpiry } = await import('../src/lib/queue');
    await enqueueServiceExpiry('svc-2', 60_000);

    expect(queueAddMock).toHaveBeenCalledWith(
      'serviceExpiry',
      { serviceId: 'svc-2' },
      { delay: 60_000 },
    );
  });
});
