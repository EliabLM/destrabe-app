import cors from 'cors';
import express from 'express';
import { router } from './routes';
import { env } from './lib/env';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());
  // T2 — CORS middleware (cambio-008 / D4). Origin configurable via env.
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
