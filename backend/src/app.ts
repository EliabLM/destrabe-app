import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { router } from './routes';
import { env } from './lib/env';
import { logger as defaultLogger } from './lib/logger';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { parseTrustProxy } from './middleware/clientIp';
import { createRequestLogger } from './middleware/requestLogger';

export interface AppOptions {
  logger?: Logger;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  // DCC-17: no anunciar Express; cabeceras de seguridad por defecto de helmet.
  app.disable('x-powered-by');
  // DCC-05: solo los proxies de TRUST_PROXY (Traefik/Coolify) pueden fijar la
  // IP del cliente vía X-Forwarded-For.
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  // DCC-17: requestId (X-Request-Id) y una línea de log JSON por petición.
  app.use(createRequestLogger(options.logger ?? defaultLogger));
  app.use(helmet());
  app.use(express.json());
  // T2 — CORS middleware (cambio-008 / D4). Origin configurable via env.
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
