/**
 * Factoría de PaymentGateway (cambio-006 / REQ-005, cambio-007 / T6).
 *
 * Selecciona la implementación según el env `PAYMENT_GATEWAY`.
 * Acepta un override opcional para tests sin mockear el módulo env.
 */
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { PaymentGateway, StubPaymentGateway } from './paymentGateway';
import { MercadoPagoGateway } from './mercadopagoGateway';

export function getPaymentGateway(gateway?: string): PaymentGateway {
  const g = gateway ?? env.PAYMENT_GATEWAY;
  if (g === 'stub') return new StubPaymentGateway();
  if (g === 'mercadopago') {
    return new MercadoPagoGateway(prisma, {
      accessToken: env.MP_ACCESS_TOKEN ?? '',
      webhookSecret: env.MP_WEBHOOK_SECRET ?? '',
      sandbox: env.MP_SANDBOX,
      webhookUrl: env.MP_WEBHOOK_URL,
    });
  }
  throw new Error(`Unknown payment gateway: ${g}`);
}
