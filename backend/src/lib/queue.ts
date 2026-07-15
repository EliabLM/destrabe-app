import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';

/**
 * BullMQ queue singleton + factory Worker (design §D2).
 *
 * Lazy ioredis connection: Redis is only instantiated when `getConnection()` is
 * first called (i.e., on first enqueue or worker creation). This avoids
 * attempting a Redis connection in pure unit tests that don't exercise queue
 * functions.
 *
 * Usage:
 *   import { enqueueServiceExpiry } from '../lib/queue';
 *   await enqueueServiceExpiry(serviceId, delayMs);
 *
 *   import { createWorker } from '../lib/queue';
 *   const worker = createWorker(handler);
 */

let connection: IORedis | null = null;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

/**
 * Singleton BullMQ Queue for service expiry jobs.
 * Created lazily at module load time (connection is lazily resolved inside).
 */
const serviceExpiryQueue = new Queue('serviceExpiry', {
  connection: getConnection() as ConnectionOptions,
});

/**
 * Enqueue a service expiry job with a delay.
 *
 * @param serviceId - The service ID to expire
 * @param delayMs   - Delay in milliseconds (e.g. SERVICE_TIMEOUT_MINUTES * 60_000)
 */
export async function enqueueServiceExpiry(
  serviceId: string,
  delayMs: number,
): Promise<void> {
  await serviceExpiryQueue.add(
    'serviceExpiry',
    { serviceId },
    { delay: delayMs },
  );
}

/**
 * Create a BullMQ Worker for the serviceExpiry queue.
 * The `handler` receives a job with `{ serviceId }` data.
 *
 * Worker runs in-process; in production it could be moved to a separate process.
 */
export function createWorker(
  handler: (job: { data: { serviceId: string } }) => Promise<void>,
): Worker {
  return new Worker('serviceExpiry', handler, {
    connection: getConnection() as ConnectionOptions,
  });
}
