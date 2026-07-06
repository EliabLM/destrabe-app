import { z } from 'zod';
import { ServiceStatus, ServiceType } from '../types/service';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const serviceStatusSchema = z.nativeEnum(ServiceStatus);
export const serviceTypeSchema = z.nativeEnum(ServiceType);

// ─── Request schemas ─────────────────────────────────────────────────────────

/**
 * Schema for `POST /services`.
 * `originLat`/`originLng` required; `destLat`/`destLng`, `description`, `photoUrl` opcionales.
 */
export const createServiceSchema = z.object({
  type: serviceTypeSchema,
  originLat: z.number(),
  originLng: z.number(),
  destLat: z.number().optional(),
  destLng: z.number().optional(),
  description: z.string().optional(),
  photoUrl: z.string().optional(),
});

/**
 * Schema for `GET /services/nearby` query params.
 * `lat`/`lng` required (coerced from string); `radiusKm` opcional con default 5.
 */
export const nearbyServicesQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusKm: z.coerce.number().default(5),
});

/**
 * Schema for `PATCH /services/:id/status` body.
 * `status` debe ser un valor válido de `ServiceStatus`.
 */
export const updateServiceStatusSchema = z.object({
  status: serviceStatusSchema,
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type NearbyServicesQuery = z.infer<typeof nearbyServicesQuerySchema>;
export type UpdateServiceStatusInput = z.infer<
  typeof updateServiceStatusSchema
>;
