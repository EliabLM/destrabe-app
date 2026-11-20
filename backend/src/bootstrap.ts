import type { Server } from 'node:http';
import { createApp } from './app';
import type { Env } from './lib/env';
import { logger } from './lib/logger';
import {
  startServiceExpirySweeper,
  type ServiceExpirySweeper,
} from './jobs/serviceExpiry.job';

export interface RunningServer {
  server: Server;
  expirySweeper: ServiceExpirySweeper;
  /** Detiene el barrido y cierra el servidor HTTP. */
  close(): Promise<void>;
}

type StartEnv = Pick<Env, 'PORT' | 'NODE_ENV' | 'SERVICE_EXPIRY_SWEEP_SECONDS'>;

/**
 * Arranca la API y el barrido de expiración de servicios (DCC-07). El barrido
 * corre en el mismo proceso; con varias réplicas, el advisory lock de
 * `expireOverdueServices` evita que trabajen a la vez.
 */
export function startServer(
  env: StartEnv,
  startSweeper: (intervalMs: number) => ServiceExpirySweeper = (ms) =>
    startServiceExpirySweeper(ms),
): RunningServer {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      'destrabe backend listening',
    );
  });
  const expirySweeper = startSweeper(env.SERVICE_EXPIRY_SWEEP_SECONDS * 1000);

  return {
    server,
    expirySweeper,
    close: () =>
      new Promise<void>((resolve, reject) => {
        expirySweeper.stop();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
