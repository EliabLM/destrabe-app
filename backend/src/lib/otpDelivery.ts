import { env } from './env';

/**
 * Cómo se entrega el OTP (DCC-22). Solo depende de `env`, para que `plivo.ts`
 * y `smsGuard.ts` lo compartan sin importarse entre sí.
 */

/** Hay credenciales de Plivo para enviar SMS. */
export function isSmsProviderConfigured(): boolean {
  return Boolean(env.PLIVO_AUTH_ID && env.PLIVO_AUTH_TOKEN);
}

/** Número de la demo: su código va al log del backend, no por SMS. */
export function isOtpLogNumber(phone: string): boolean {
  return env.OTP_LOG_NUMBERS.includes(phone);
}

/**
 * En producción, sin proveedor de SMS, solo pueden pedir código los números
 * de `OTP_LOG_NUMBERS`. Fuera de producción el código va al log (modo dev).
 */
export function isOtpDeliveryRestricted(phone: string): boolean {
  return (
    env.NODE_ENV === 'production' &&
    !isSmsProviderConfigured() &&
    !isOtpLogNumber(phone)
  );
}
