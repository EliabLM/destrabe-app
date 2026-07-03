import express from 'express';
import { router } from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
