import { api } from './api';

export interface CreateOperatorProfileInput {
  truckType: string;
  licensePlate: string;
  photoUrl?: string;
  available?: boolean;
  lastLatitude?: number;
  lastLongitude?: number;
}

/**
 * Create operator profile.
 * POST /api/operator/profile
 */
export async function createOperatorProfile(
  data: CreateOperatorProfileInput,
): Promise<unknown> {
  const res = await api.post('/api/operator/profile', data);
  return res.data;
}

/**
 * Update operator location + availability.
 * PATCH /api/operator/location
 */
export async function updateLocation(data: {
  lastLatitude: number;
  lastLongitude: number;
  available?: boolean;
}): Promise<unknown> {
  const res = await api.patch('/api/operator/location', data);
  return res.data;
}
