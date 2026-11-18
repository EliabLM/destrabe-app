import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { serializeError } from '../lib/logger';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Se acepta el id que mande el proxy o el cliente solo si es corto y seguro
// para un log; si no, se genera uno nuevo.
const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

function pathOnly(url: string | undefined): string | undefined {
  // La query puede traer datos personales; al log solo va la ruta.
  return url?.split('?')[0];
}

/**
 * Middleware de logs por petición (DCC-17): asigna `req.id`, lo devuelve en
 * `X-Request-Id` y registra una línea JSON al terminar. No registra cabeceras,
 * query ni cuerpo. Las sondas de salud que responden bien no se registran.
 */
export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const incoming = req.headers['x-request-id'];
      const id =
        typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
          ? incoming
          : randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    autoLogging: {
      ignore: (req) => pathOnly(req.url)?.startsWith('/health') ?? false,
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: pathOnly(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
  });
}
