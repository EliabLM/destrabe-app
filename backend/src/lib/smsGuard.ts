import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { APIError } from 'better-auth/api';
import { isColombianMobile } from '@destrabe/shared';
import { env } from './env';
import { maskPhone } from './logMask';
import { isOtpDeliveryRestricted } from './otpDelivery';
import { prisma } from './prisma';

/**
 * Protección del envío de OTP por SMS (DCC-05 / DES-A03, DES-A06).
 *
 * Límites persistentes en Postgres (tabla `SmsSendLog`), ventanas deslizantes:
 * - por número: `SMS_LIMIT_PHONE_15MIN` en 15 min y `SMS_LIMIT_PHONE_DAY` en 24 h;
 * - por IP: `SMS_LIMIT_IP_HOUR` en 1 h y `SMS_LIMIT_IP_DAY` en 24 h;
 * - global: `SMS_DAILY_CAP` en 24 h (tope de coste de Plivo).
 *
 * `checkSmsAllowed` se usa antes de generar el código (respuesta temprana) y
 * `reserveSmsSend` justo antes de enviarlo: comprueba de nuevo y registra el
 * envío dentro de una transacción con *advisory lock*, para que peticiones
 * concurrentes no superen los topes.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Filas más antiguas que esto ya no cuentan para ningún límite. */
const RETENTION_MS = 2 * DAY;
/** Clave arbitraria y fija del `pg_advisory_xact_lock` de los envíos. */
const SMS_LOCK_KEY = 4_205_005;
/**
 * Tiempos de la transacción de conteo: `maxWait` para obtener conexión del
 * pool y `timeout` total (incluye esperar el *advisory lock*).
 */
export const SMS_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
/** Contador usado cuando no se pudo resolver la IP del cliente. */
export const UNKNOWN_IP = 'unknown';

export type SmsLimitReason =
  'PHONE_15MIN' | 'PHONE_DAY' | 'IP_HOUR' | 'IP_DAY' | 'DAILY_CAP';

export interface SmsCounts {
  phone15Min: number;
  phoneDay: number;
  ipHour: number;
  ipDay: number;
  globalDay: number;
}

export interface SmsLimits {
  phone15Min: number;
  phoneDay: number;
  ipHour: number;
  ipDay: number;
  dailyCap: number;
}

export function limitsFromEnv(): SmsLimits {
  return {
    phone15Min: env.SMS_LIMIT_PHONE_15MIN,
    phoneDay: env.SMS_LIMIT_PHONE_DAY,
    ipHour: env.SMS_LIMIT_IP_HOUR,
    ipDay: env.SMS_LIMIT_IP_DAY,
    dailyCap: env.SMS_DAILY_CAP,
  };
}

/** Primer límite alcanzado (el tope global tiene prioridad) o `null`. */
export function evaluateSmsLimits(
  counts: SmsCounts,
  limits: SmsLimits,
): SmsLimitReason | null {
  if (counts.globalDay >= limits.dailyCap) return 'DAILY_CAP';
  if (counts.phone15Min >= limits.phone15Min) return 'PHONE_15MIN';
  if (counts.phoneDay >= limits.phoneDay) return 'PHONE_DAY';
  if (counts.ipHour >= limits.ipHour) return 'IP_HOUR';
  if (counts.ipDay >= limits.ipDay) return 'IP_DAY';
  return null;
}

/** Números de prueba con OTP fijo: solo fuera de producción. */
export function isOtpTestNumber(phone: string): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    Boolean(env.OTP_TEST_CODE) &&
    env.OTP_TEST_NUMBERS.includes(phone)
  );
}

/**
 * IP del cliente tal como la dejó el middleware `normalizeClientIp` (una sola
 * IP en `x-forwarded-for`, calculada por Express con `trust proxy`).
 */
export function clientIpFromHeaders(
  headers: Headers | undefined | null,
): string {
  const value = headers?.get('x-forwarded-for')?.trim();
  return value && isIP(value) ? value : UNKNOWN_IP;
}

function hmac(kind: string, value: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(`${kind}:${value}`)
    .digest('hex');
}

/** HMAC del teléfono y de la IP tal como se guardan en `SmsSendLog`. */
export function smsHashes(phone: string, ip: string) {
  return { phoneHash: hmac('phone', phone), ipHash: hmac('ip', ip) };
}

type Db = Pick<typeof prisma, 'smsSendLog'>;

async function countSends(db: Db, phoneHash: string, ipHash: string) {
  const now = Date.now();
  const since = (ms: number) => ({ gte: new Date(now - ms) });
  const [phone15Min, phoneDay, ipHour, ipDay, globalDay] = await Promise.all([
    db.smsSendLog.count({
      where: { phoneHash, createdAt: since(15 * MINUTE) },
    }),
    db.smsSendLog.count({ where: { phoneHash, createdAt: since(DAY) } }),
    db.smsSendLog.count({ where: { ipHash, createdAt: since(HOUR) } }),
    db.smsSendLog.count({ where: { ipHash, createdAt: since(DAY) } }),
    db.smsSendLog.count({ where: { createdAt: since(DAY) } }),
  ]);
  return { phone15Min, phoneDay, ipHour, ipDay, globalDay };
}

function limitError(reason: SmsLimitReason, phone: string): APIError {
  if (reason === 'DAILY_CAP') {
    console.warn(
      `[sms] Tope diario de SMS alcanzado (SMS_DAILY_CAP=${env.SMS_DAILY_CAP}); envío a ${maskPhone(phone)} bloqueado`,
    );
    return new APIError('SERVICE_UNAVAILABLE', {
      code: 'SMS_DAILY_CAP_REACHED',
      message:
        'No podemos enviar más códigos por SMS hoy. Inténtalo de nuevo mañana.',
    });
  }
  return new APIError('TOO_MANY_REQUESTS', {
    code: 'TOO_MANY_OTP_REQUESTS',
    message:
      'Has pedido demasiados códigos. Espera un poco antes de pedir otro.',
  });
}

function isTransactionTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2028'
  );
}

function busyError(): APIError {
  return new APIError('SERVICE_UNAVAILABLE', {
    code: 'SMS_TEMPORARILY_UNAVAILABLE',
    message:
      'No pudimos enviar el código ahora. Inténtalo de nuevo en unos minutos.',
  });
}

function invalidPhoneError(): APIError {
  return new APIError('BAD_REQUEST', {
    code: 'INVALID_PHONE_NUMBER',
    message: 'Solo se aceptan móviles colombianos (+57 3XX XXX XXXX).',
  });
}

function restrictedLoginError(): APIError {
  return new APIError('FORBIDDEN', {
    code: 'OTP_LOGIN_RESTRICTED',
    message: 'Por ahora el ingreso está limitado a cuentas de prueba.',
  });
}

/** Comprueba sin registrar nada. Lanza `APIError` 400/403/429/503. */
export async function checkSmsAllowed(
  phone: unknown,
  ip: string,
): Promise<void> {
  if (!isColombianMobile(phone)) throw invalidPhoneError();
  const phoneStr = phone as string;
  if (isOtpTestNumber(phoneStr)) return;
  if (isOtpDeliveryRestricted(phoneStr)) throw restrictedLoginError();
  const { phoneHash, ipHash } = smsHashes(phoneStr, ip);
  const counts = await countSends(prisma, phoneHash, ipHash);
  const reason = evaluateSmsLimits(counts, limitsFromEnv());
  if (reason) throw limitError(reason, phoneStr);
}

/**
 * Comprueba y registra un envío de forma atómica. Si lanza, no se envía.
 * El envío cuenta aunque luego falle el proveedor (criterio conservador).
 */
export async function reserveSmsSend(phone: string, ip: string): Promise<void> {
  if (!isColombianMobile(phone)) throw invalidPhoneError();
  if (isOtpDeliveryRestricted(phone)) throw restrictedLoginError();
  const { phoneHash, ipHash } = smsHashes(phone, ip);
  let reason: SmsLimitReason | null;
  try {
    reason = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SMS_LOCK_KEY})`;
      await tx.smsSendLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      });
      const counts = await countSends(tx, phoneHash, ipHash);
      const found = evaluateSmsLimits(counts, limitsFromEnv());
      if (!found) {
        await tx.smsSendLog.create({
          data: { phoneHash, ipHash },
        });
      }
      return found;
    }, SMS_TX_OPTIONS);
  } catch (err) {
    // Ráfaga: no se obtuvo conexión o el bloqueo a tiempo (P2028). Se responde
    // 503 (nunca 500) y no se envía.
    if (isTransactionTimeout(err)) {
      console.warn(
        `[sms] Transacción de límites agotó el tiempo; envío a ${maskPhone(phone)} bloqueado`,
      );
      throw busyError();
    }
    throw err;
  }
  if (reason) throw limitError(reason, phone);
}
