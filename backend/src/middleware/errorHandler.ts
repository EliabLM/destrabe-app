import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err.status ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';
  res.status(status).json({ error: err.message, code });
};
