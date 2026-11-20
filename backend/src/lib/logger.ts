import pino, { type DestinationStream, type Logger } from 'pino';
import { maskPhone } from './logMask';

/**
 * Logger de la API (DCC-17): JSON en stdout, una línea por evento.
 *
 * Nunca deben salir al log credenciales, cookies, teléfonos completos ni OTP.
 * `REDACT_PATHS` cubre los campos con esos nombres en cualquier objeto que se
 * registre (hasta dos niveles); `serializeError` enmascara además los números
 * que aparezcan en el texto de un error (p. ej. los argumentos que Prisma
 * repite en sus mensajes de validación).
 */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-webhook-token',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'otp',
  'otpCode',
  'phone',
  'phoneNumber',
];

// `code` no se redacta en general porque también nombra códigos de error
// (`P2002`, `INTERNAL_ERROR`); los cuerpos con el OTP nunca se registran.
export const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => {
  const prop = /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`;
  return [`*${prop}`, `*.*${prop}`];
}).concat(SENSITIVE_KEYS.filter((key) => !key.includes('-')));

// Teléfonos en texto libre: +573001234567, 3001234567, 573001234567.
const PHONE_IN_TEXT = /\+?\d{10,15}/g;

export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_IN_TEXT, (match) => maskPhone(match));
}

export function serializeError(err: unknown) {
  // pino-http entrega el error ya serializado; pino, el Error original.
  const base = (
    err instanceof Error ? pino.stdSerializers.err(err) : err
  ) as pino.SerializedError;
  if (!base || typeof base !== 'object') return base;
  return {
    ...base,
    message:
      typeof base.message === 'string'
        ? maskPhonesInText(base.message)
        : base.message,
    stack:
      typeof base.stack === 'string'
        ? maskPhonesInText(base.stack)
        : base.stack,
  };
}

export interface LoggerOptions {
  level?: string;
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      base: { service: 'destrabe-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: { err: serializeError, error: serializeError },
    },
    options.destination,
  );
}

/** Logger del proceso. En pruebas queda en silencio para no ensuciar la salida. */
export const logger = createLogger({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
});
