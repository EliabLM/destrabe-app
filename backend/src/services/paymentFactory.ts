/**
 * Factoría de PaymentGateway (cambio-006 / REQ-005).
 *
 * Selecciona la implementación según el env `PAYMENT_GATEWAY`.
 * Acepta un override opcional para tests sin mockear el módulo env.
 */
import { env } from '../lib/env';
import { PaymentGateway, StubPaymentGateway } from './paymentGateway';

export function getPaymentGateway(gateway?: string): PaymentGateway {
  const g = gateway ?? env.PAYMENT_GATEWAY;
  if (g === 'stub') return new StubPaymentGateway();
  throw new Error(`Unknown payment gateway: ${g}`);
}
