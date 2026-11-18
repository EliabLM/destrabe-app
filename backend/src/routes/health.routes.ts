import { Router } from 'express';
import { prisma } from '../lib/prisma';

const DEADLINE_MS = 2000;

type Checks = { db: () => Promise<unknown> };

export function createHealthRouter(
  checks: Checks = { db: () => prisma.$queryRaw`SELECT 1` },
  deadlineMs = DEADLINE_MS,
): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        checks.db(),
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
