import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { createShutdown, installShutdownHandlers } from '../src/lib/shutdown';
import { captureLogs } from './helpers/logCapture';

function listen() {
  const app = express();
  app.get('/slow', (_req, res) => {
    setTimeout(() => res.send('done'), 50);
  });
  return new Promise<import('node:http').Server>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('graceful shutdown (DCC-17)', () => {
  it('on SIGTERM closes the HTTP server, then the steps, then Prisma, then exits 0', async () => {
    const server = await listen();
    const order: string[] = [];
    const exited = new Promise<number>((resolve) => {
      const shutdown = createShutdown({
        server,
        logger: captureLogs().logger,
        steps: [{ name: 'expiry', close: () => void order.push('expiry') }],
        disconnectDb: async () => {
          order.push(server.listening ? 'db (server open!)' : 'db');
        },
        exit: (code) => {
          order.push('exit');
          resolve(code);
        },
      });
      const proc = new EventEmitter();
      installShutdownHandlers(shutdown, proc);
      proc.emit('SIGTERM');
    });

    expect(await exited).toBe(0);
    expect(server.listening).toBe(false);
    expect(order).toEqual(['expiry', 'db', 'exit']);
  });

  it('waits for in-flight requests before disconnecting Prisma', async () => {
    const server = await listen();
    const { port } = server.address() as AddressInfo;
    const inFlight = fetch(`http://127.0.0.1:${port}/slow`).then((r) =>
      r.text(),
    );
    await new Promise((r) => setTimeout(r, 10));

    const disconnectDb = vi.fn(async () => {});
    const exit = vi.fn();
    await createShutdown({
      server,
      logger: captureLogs().logger,
      disconnectDb,
      exit,
    })('SIGTERM');

    expect(await inFlight).toBe('done');
    expect(disconnectDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('runs once even if the signal arrives twice', async () => {
    const server = await listen();
    const disconnectDb = vi.fn(async () => {});
    const shutdown = createShutdown({
      server,
      logger: captureLogs().logger,
      disconnectDb,
      exit: () => {},
    });
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(disconnectDb).toHaveBeenCalledOnce();
  });

  it('still disconnects Prisma and exits 1 when a step fails', async () => {
    const server = await listen();
    const disconnectDb = vi.fn(async () => {});
    const exit = vi.fn();
    const logs = captureLogs();
    await createShutdown({
      server,
      logger: logs.logger,
      steps: [
        {
          name: 'broken',
          close: () => {
            throw new Error('cannot stop');
          },
        },
      ],
      disconnectDb,
      exit,
    })('SIGTERM');
    expect(disconnectDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.text()).toContain('shutdown step failed');
  });

  it('forces exit 1 when shutdown exceeds the timeout', async () => {
    vi.useFakeTimers();
    const server = await listen();
    const exit = vi.fn();
    void createShutdown({
      server,
      logger: captureLogs().logger,
      steps: [{ name: 'hangs', close: () => new Promise(() => {}) }],
      disconnectDb: async () => {},
      timeoutMs: 1000,
      exit,
    })('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
