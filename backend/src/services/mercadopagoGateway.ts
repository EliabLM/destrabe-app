/**
 * MercadoPagoGateway — implementación real de PaymentGateway (cambio-007 / REQ-001 MODIFIED, REQ-002, REQ-005).
 *
 * Usa el SDK oficial `mercadopago` (~3.2.0) para:
 *   - Crear Checkout Pro Preferences (initPayment)
 *   - Validar webhooks via HMAC (processWebhook)
 *
 * El constructor recibe PrismaClient + config snapshot (sin importar env).
 * Tests usan `vi.mock('mercadopago')` (D7).
 */

import { MercadoPagoConfig, Preference, WebhookSignatureValidator } from 'mercadopago';
import type { PrismaClient } from '@prisma/client';
import type { PaymentGateway, WebhookHeaders } from './paymentGateway';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface MpGatewayConfig {
  accessToken: string;
  webhookSecret: string;
  sandbox: boolean;
  webhookUrl?: string;
}

// ─── Gateway ─────────────────────────────────────────────────────────────────

export class MercadoPagoGateway implements PaymentGateway {
  private prisma: PrismaClient;
  private config: MpGatewayConfig;

  constructor(prisma: PrismaClient, config: MpGatewayConfig) {
    this.prisma = prisma;
    this.config = config;
  }

  /**
   * Crea una Preference de Checkout Pro en MercadoPago.
   * Persiste el `preference.id` como `mpPaymentId` en la BD (el route lo guarda).
   */
  async initPayment(payment: {
    id: string;
    amount: number;
    commission: number;
    operatorAmount: number;
  }): Promise<{ gatewayPaymentId: string; redirectUrl?: string }> {
    const mpConfig = new MercadoPagoConfig({
      accessToken: this.config.accessToken,
    });
    const preferenceClient = new Preference(mpConfig);

    const preference = await preferenceClient.create({
      body: {
        items: [
          {
            id: payment.id,
            title: `Payment ${payment.id}`,
            quantity: 1,
            unit_price: payment.amount,
          },
        ],
        external_reference: payment.id,
        notification_url: this.config.webhookUrl,
      },
    });

    return {
      gatewayPaymentId: preference.id!,
      redirectUrl: this.config.sandbox
        ? preference.sandbox_init_point
        : preference.init_point,
    };
  }

  /**
   * Procesa una notificación IPN/webhook de MercadoPago:
   *   1. Valida HMAC via `WebhookSignatureValidator.validate`
   *   2. Reverse-lookup: `body.data.id` (mpPaymentId) → `payment.id`
   *   3. Mapea estado MP → estado local
   *
   * Estados no terminales (pending, in_process, in_mediation) → `{ status: 'ignored' }`
   * approved → CONFIRMED, rejected/cancelled/refunded → FAILED
   */
  async processWebhook(
    payload: unknown,
    headers?: WebhookHeaders,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED' | 'ignored';
    gatewayReference?: string;
  }> {
    const body = payload as Record<string, unknown>;
    const dataId =
      (body?.data as Record<string, unknown> | undefined)?.id ?? (body?.id as string | undefined);

    // 1. Validar HMAC
    const dataIdStr = dataId as string | undefined;

    WebhookSignatureValidator.validate({
      xSignature: headers?.['x-signature'],
      xRequestId: headers?.['x-request-id'],
      dataId: dataIdStr,
      secret: this.config.webhookSecret,
      toleranceSeconds: 300,
    });

    if (!dataIdStr) {
      throw Object.assign(new Error('Missing data.id in webhook payload'), {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    // 2. Reverse-lookup by mpPaymentId
    const payment = await this.prisma.payment.findUnique({
      where: { mpPaymentId: dataIdStr },
    });

    if (!payment) {
      throw Object.assign(
        new Error(`Payment not found for mpPaymentId: ${dataIdStr}`),
        {
          status: 404,
          code: 'NOT_FOUND',
        },
      );
    }

    // 3. Mapear estado MP → local
    const mpStatus =
      (body?.action as string)?.replace(/^payment\./, '') ??
      (body?.status as string) ??
      '';

    // Estados no terminales → ignorar
    if (['pending', 'in_process', 'in_mediation'].includes(mpStatus)) {
      return { paymentId: payment.id, status: 'ignored' };
    }

    // Estados terminales
    if (mpStatus === 'approved') {
      return { paymentId: payment.id, status: 'CONFIRMED', gatewayReference: dataIdStr };
    }

    if (['rejected', 'cancelled', 'refunded'].includes(mpStatus)) {
      return { paymentId: payment.id, status: 'FAILED', gatewayReference: dataIdStr };
    }

    // Estado desconocido → ignorar por defecto (no terminal)
    return { paymentId: payment.id, status: 'ignored' };
  }
}
