import { z } from 'zod';
import { PaymentStatus } from '../types/payment';

export const paymentStatusSchema = z.nativeEnum(PaymentStatus);

/**
 * Schema for `POST /payments/webhook` body (cambio-006 / REQ-002).
 */
export const webhookEventSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
  status: z.enum(['CONFIRMED', 'FAILED']),
  gatewayReference: z.string().optional(),
});

/**
 * Schema for `POST /payments/:id/init` response (cambio-006 / REQ-001).
 */
export const initPaymentResponseSchema = z.object({
  gatewayPaymentId: z.string(),
  redirectUrl: z.string().optional(),
});
