import { Router } from 'express';
import IORedis from 'ioredis';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';

const DEADLINE_MS = 2000;

type Checks = { db: () => Promise<unknown>; redis: () => Promise<unknown> };

async function pingRedis(): Promise<void> {
  // A fresh connection per probe; never leave a health-check socket open.
  const client = new IORedis(env.REDIS_URL!, {
    lazyConnect: true,
    connectTimeout: DEADLINE_MS,
    commandTimeout: DEADLINE_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => {}); // Do not log connection URLs or credentials.
  try {
    await client.connect();
    if ((await client.ping()) !== 'PONG') throw new Error('Redis not ready');
  } finally {
    client.disconnect();
  }
}

export function createHealthRouter(
  checks: Checks = {
    db: () => prisma.$queryRaw`SELECT 1`,
    redis: pingRedis,
  },
  deadlineMs = DEADLINE_MS,
): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([checks.db(), checks.redis()]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('readiness timeout')),
            deadlineMs,
          );
        }),
      ]);
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
}

export const healthRouter = createHealthRouter();
