import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

/**
 * DCC-07 — al arrancar el servidor queda activo el barrido de expiración,
 * con el intervalo de SERVICE_EXPIRY_SWEEP_SECONDS; al cerrar, se detiene.
 */

const expireMock = vi.hoisted(() => vi.fn().mockResolvedValue(0));
vi.mock('../src/jobs/serviceExpiry.job', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/jobs/serviceExpiry.job')>();
  return {
    ...actual,
    startServiceExpirySweeper: vi.fn((ms: number) =>
      actual.startServiceExpirySweeper(ms, expireMock),
    ),
  };
});

import { startServer, type RunningServer } from '../src/bootstrap';
import { startServiceExpirySweeper } from '../src/jobs/serviceExpiry.job';

let running: RunningServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.clearAllMocks();
});

describe('startServer', () => {
  it('starts the HTTP server and the expiry sweeper', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    running = startServer({
      PORT: 0,
      NODE_ENV: 'test',
      SERVICE_EXPIRY_SWEEP_SECONDS: 30,
    });
    await once(running.server, 'listening');

    expect((running.server.address() as AddressInfo).port).toBeGreaterThan(0);
    expect(startServiceExpirySweeper).toHaveBeenCalledWith(30_000);
    // El barrido corre una vez al arrancar.
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  it('stops the sweeper and the server on close', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const stop = vi.fn();
    running = startServer(
      { PORT: 0, NODE_ENV: 'test', SERVICE_EXPIRY_SWEEP_SECONDS: 60 },
      () => ({ stop }),
    );
    await once(running.server, 'listening');

    await running.close();
    running = undefined;
    expect(stop).toHaveBeenCalledOnce();
  });
});
