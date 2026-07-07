import { api } from './api';
import type { ServiceItem } from '../stores/servicesStore';

export interface CreateServiceInput {
  type: 'BREAKDOWN' | 'TRANSFER';
  originLat: number;
  originLng: number;
  destLat?: number;
  destLng?: number;
  description?: string;
  photoUrl?: string;
}

export interface CreateServiceResponse {
  id: string;
  status: string;
  expiresAt: string;
  type: string;
  originLat: number;
  originLng: number;
}

/**
 * List my services.
 * GET /services
 */
export async function listMyServices(): Promise<ServiceItem[]> {
  const res = await api.get<ServiceItem[]>('/services');
  return res.data;
}

/**
 * Get a single service by ID.
 * GET /services/:id
 */
export async function getService(id: string): Promise<ServiceItem> {
  const res = await api.get<ServiceItem>(`/services/${id}`);
  return res.data;
}

/**
 * Create a new service.
 * POST /services
 */
export async function createService(
  data: CreateServiceInput,
): Promise<CreateServiceResponse> {
  const res = await api.post<CreateServiceResponse>('/services', data);
  return res.data;
}

/**
 * Update service status.
 * PATCH /services/:id/status
 */
export async function updateServiceStatus(
  id: string,
  status: string,
): Promise<unknown> {
  const res = await api.patch(`/services/${id}/status`, { status });
  return res.data;
}

/**
 * Get nearby PENDING services (operator).
 * GET /services/nearby?lat=...&lng=...&radiusKm=...
 */
export async function getNearbyServices(
  lat: number,
  lng: number,
  radiusKm?: number,
): Promise<ServiceItem[]> {
  const res = await api.get<ServiceItem[]>('/services/nearby', {
    params: { lat, lng, radiusKm: radiusKm ?? 5 },
  });
  return res.data;
}
