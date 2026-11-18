import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * DCC-07 / DCC-19 — expiración de servicios sin Redis.
 *
 *  - `expireOverdueServices()` — notifica cada servicio cancelado, después
 *    del commit; si otra réplica tiene el lock, no hace nada.
 *  - `startServiceExpirySweeper()` — corre al arrancar y cada intervalo, sin
 *    solaparse, y sigue tras un error.
 *
 * El UPDATE real contra Postgres está en `db/services.expiry.test.ts`.
 */

const queryRawMock = vi.hoisted(() => vi.fn());
const notifyClientMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: queryRawMock }),
    ),
  },
}));

vi.mock('../src/lib/notifications', () => ({
  notifyClient: notifyClientMock,
}));

import {
  expireOverdueServices,
  startServiceExpirySweeper,
} from '../src/jobs/serviceExpiry.job';

describe('expireOverdueServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies the client of every cancelled service', async () => {
    queryRawMock
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([
        { id: 'svc-1', clientProfileId: 'cp-1' },
        { id: 'svc-2', clientProfileId: 'cp-2' },
      ]);

    await expect(expireOverdueServices()).resolves.toBe(2);

    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(notifyClientMock).toHaveBeenCalledTimes(2);
    expect(notifyClientMock).toHaveBeenCalledWith(
      { id: 'svc-1', clientProfileId: 'cp-1' },
      'expired',
    );
    expect(notifyClientMock).toHaveBeenCalledWith(
      { id: 'svc-2', clientProfileId: 'cp-2' },
      'expired',
    );
  });

  it('does nothing when another replica holds the lock', async () => {
    queryRawMock.mockResolvedValueOnce([{ locked: false }]);

    await expect(expireOverdueServices()).resolves.toBe(0);

    expect(queryRawMock).toHaveBeenCalledTimes(1); // no UPDATE
    expect(notifyClientMock).not.toHaveBeenCalled();
  });
});

describe('startServiceExpirySweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at start and then on every interval until stopped', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const sweeper = startServiceExpirySweeper(1000, run);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(4);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('skips a tick while the previous run is still going', async () => {
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const sweeper = startServiceExpirySweeper(1000, run);

    await vi.advanceTimersByTimeAsync(2500);
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    sweeper.stop();
  });

  it('logs a failure and keeps sweeping', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce('boom')
      .mockResolvedValue(0);
    const sweeper = startServiceExpirySweeper(1000, run);

    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith({
      event: 'service_expiry_failed',
      error: 'db down',
    });
    expect(errorSpy).toHaveBeenCalledWith({
      event: 'service_expiry_failed',
      error: 'boom',
    });
    sweeper.stop();
    errorSpy.mockRestore();
  });
});
