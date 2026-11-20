import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger';

function statusOf(err: { status?: unknown; statusCode?: unknown }): number {
  const status = err.status ?? err.statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599
    ? status
    : 500;
}

/**
 * Errores de la API (DCC-17).
 *
 * - 4xx: mismo contrato de siempre, `{ error: err.message, code }`.
 * - 5xx: mensaje genérico y el `requestId` para buscar el error en el log.
 *   El mensaje, el código interno (p. ej. `P2002` de Prisma) y la traza solo
 *   van al log. Los errores de dominio 5xx (con `status` propio, como
 *   `MercadoPagoError`) conservan su `code`.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = statusOf(err ?? {});
  if (status < 500) {
    res
      .status(status)
      .json({ error: err.message, code: err.code ?? 'INTERNAL_ERROR' });
    return;
  }
  const requestId = req.id === undefined ? undefined : String(req.id);
  if (req.log) {
    // pino-http lo registra al terminar la respuesta, junto al requestId.
    res.err = err;
  } else {
    logger.error({ err, status }, 'request failed');
  }
  const domainCode =
    typeof err?.status === 'number' && typeof err.code === 'string'
      ? err.code
      : undefined;
  res.status(status).json({
    error: 'Internal Server Error',
    code: domainCode ?? 'INTERNAL_ERROR',
    ...(requestId ? { requestId } : {}),
  });
};
