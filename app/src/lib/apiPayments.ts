import { api } from './api';

export interface InitPaymentResponse {
  gatewayPaymentId: string;
  redirectUrl?: string;
}

export interface PaymentInfo {
  id: string;
  status: string;
  amount: number;
}

/**
 * Initiate payment for a service.
 * POST /payments/:id/init
 */
export async function initPayment(
  paymentId: string,
): Promise<InitPaymentResponse> {
  const res = await api.post<InitPaymentResponse>(
    `/payments/${paymentId}/init`,
  );
  return res.data;
}

/**
 * Get payment info by service ID.
 * Uses GET /services/:id which includes payment info.
 */
export async function getPaymentStatus(
  serviceId: string,
): Promise<PaymentInfo | null> {
  const res = await api.get<{ payment?: PaymentInfo }>(
    `/services/${serviceId}`,
  );
  return res.data?.payment ?? null;
}
