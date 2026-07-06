import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authHandler } from '../lib/auth';
import { servicesRouter } from './services.routes';

export const router = Router();

router.use(healthRouter);
// Better Auth: monta todos los endpoints bajo /api/auth/* (cambio-003 / REQ-006).
// `authHandler` (toNodeHandler(auth.handler)) reconstruye la URL completa a
// partir de `req.baseUrl`+`req.url`, así que el prefijo de Express no rompe
// el basePath `/api/auth` que espera Better Auth internamente.
router.use('/api/auth', authHandler);

// Services: monta servicios bajo /services (cambio-004 / T7).
router.use('/services', servicesRouter);
