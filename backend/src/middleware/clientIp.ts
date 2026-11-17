import type { RequestHandler } from 'express';

/**
 * Valor de `app.set('trust proxy', …)` a partir de `TRUST_PROXY` (DCC-05).
 *
 * - `false`: no se confía en ningún proxy (IP del socket).
 * - un entero: número de saltos de confianza.
 * - si no, lista separada por comas de IP/CIDR o alias de proxy-addr
 *   (`loopback`, `linklocal`, `uniquelocal`). `true` no se admite: confiaría en
 *   cualquier `X-Forwarded-For` y permitiría falsear la IP.
 */
export function parseTrustProxy(value: string): false | number | string[] {
  const v = value.trim();
  if (v === 'false') return false;
  if (v === 'true') {
    throw new Error('TRUST_PROXY=true is not allowed; list the proxy networks');
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sustituye `X-Forwarded-For` por la IP del cliente que calculó Express con
 * `trust proxy` (`req.ip`), antes de pasar la petición a Better Auth. Así los
 * límites por IP y la IP de la sesión salen de la misma fuente y una cabecera
 * con varios saltos (o falsificada) nunca cae en un contador compartido.
 */
export const normalizeClientIp: RequestHandler = (req, _res, next) => {
  if (req.ip) req.headers['x-forwarded-for'] = req.ip;
  else delete req.headers['x-forwarded-for'];
  next();
};
