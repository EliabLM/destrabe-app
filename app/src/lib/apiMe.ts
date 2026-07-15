import { api } from './api';

export interface MeResponse {
  user: {
    id: string;
    phoneNumber: string;
    role: string;
    email?: string | null;
    name?: string | null;
  };
  clientProfile?: {
    id: string;
    userId: string;
  } | null;
  operatorProfile?: {
    id: string;
    userId: string;
    truckType: string;
    licensePlate: string;
    photoUrl?: string | null;
    available: boolean;
    lastLatitude?: number | null;
    lastLongitude?: number | null;
    rating?: number | null;
  } | null;
}

/**
 * Get current user with profiles.
 * GET /api/me
 */
export async function getMe(): Promise<MeResponse> {
  const res = await api.get<MeResponse>('/api/me');
  return res.data;
}
