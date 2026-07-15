import { api } from './api';

export interface QuoteItem {
  id: string;
  amount: number;
  estimatedMinutes: number | null;
  note: string | null;
  operator?: {
    truckType: string;
    licensePlate: string;
    rating: number | null;
  };
  createdAt?: string;
}

export interface CreateQuoteInput {
  amount: number;
  estimatedMinutes?: number;
  note?: string;
}

export interface CreateQuoteResponse {
  id: string;
  amount: number;
  estimatedMinutes: number | null;
  note: string | null;
}

/**
 * List quotes for a service (client: all; operator: own).
 * GET /services/:id/quotes
 */
export async function listQuotes(serviceId: string): Promise<QuoteItem[]> {
  const res = await api.get<QuoteItem[]>(`/services/${serviceId}/quotes`);
  return res.data;
}

/**
 * Create a quote (operator).
 * POST /services/:id/quotes
 */
export async function createQuote(
  serviceId: string,
  data: CreateQuoteInput,
): Promise<CreateQuoteResponse> {
  const res = await api.post<CreateQuoteResponse>(
    `/services/${serviceId}/quotes`,
    data,
  );
  return res.data;
}

/**
 * Accept a quote (client).
 * POST /quotes/:id/accept
 * NOTE: Backend endpoint is /quotes/:id/accept, NOT /services/:id/quotes/:qid/accept.
 * Mapping per design D11.
 */
export async function acceptQuote(quoteId: string): Promise<unknown> {
  const res = await api.post(`/quotes/${quoteId}/accept`, {});
  return res.data;
}
