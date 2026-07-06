import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authHandler } from '../lib/auth';
import { servicesRouter } from './services.routes';
import { serviceQuotesRouter, quotesAcceptRouter } from './quotes.routes';

export const router = Router();

router.use(healthRouter);
// Better Auth: monta todos los endpoints bajo /api/auth/* (cambio-003 / REQ-006).
// `authHandler` (toNodeHandler(auth.handler)) reconstruye la URL completa a
// partir de `req.baseUrl`+`req.url`, así que el prefijo de Express no rompe
// el basePath `/api/auth` que espera Better Auth internamente.
router.use('/api/auth', authHandler);

// Services: monta servicios bajo /services (cambio-004 / T7).
router.use('/services', servicesRouter);

// Quotes: dual mount (cambio-005 / T5, design §D1).
// serviceQuotesRouter bajo /services → /:id/quotes (POST, GET).
// quotesAcceptRouter bajo /quotes → /:id/accept (POST).
router.use('/services', serviceQuotesRouter);
router.use('/quotes', quotesAcceptRouter);
