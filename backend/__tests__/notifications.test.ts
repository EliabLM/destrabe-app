import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T5 — notifications stub (REQ-007)
 *
 * `notifyClient(service, event)` logs a structured event to console.
 * Unit test: spy on `console.log` — no FCM, no IO.
 */

describe('notifyClient (REQ-007)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs event with serviceId and userId when called', async () => {
    const { notifyClient } = await import('../src/lib/notifications');

    notifyClient({ id: 'svc-123', clientProfileId: 'cp-456' }, 'expired');

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = consoleSpy.mock.calls[0][0];
    expect(logArg).toMatchObject({
      event: 'expired',
      serviceId: 'svc-123',
      userId: 'cp-456',
    });
  });

  it('logs different events correctly', async () => {
    const { notifyClient } = await import('../src/lib/notifications');

    notifyClient({ id: 'svc-789', clientProfileId: 'cp-999' }, 'status_change');

    const logArg = consoleSpy.mock.calls[0][0];
    expect(logArg).toMatchObject({
      event: 'status_change',
      serviceId: 'svc-789',
      userId: 'cp-999',
    });
  });

  it('does not throw when called', async () => {
    const { notifyClient } = await import('../src/lib/notifications');

    expect(() =>
      notifyClient({ id: 'svc-1', clientProfileId: 'cp-1' }, 'test'),
    ).not.toThrow();
  });
});
