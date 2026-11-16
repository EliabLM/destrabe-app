import { z } from 'zod';
import { ServiceStatus, ServiceType } from '../types/service';
import {
  httpsUrlSchema,
  latitudeQuerySchema,
  latitudeSchema,
  longitudeQuerySchema,
  longitudeSchema,
  nearbyRadiusKmQuerySchema,
  SERVICE_DESCRIPTION_MAX_LENGTH,
} from './inputBounds.schema';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const serviceStatusSchema = z.nativeEnum(ServiceStatus);
export const serviceTypeSchema = z.nativeEnum(ServiceType);

// ─── Request schemas ─────────────────────────────────────────────────────────

/**
 * Schema for `POST /services`.
 * `originLat`/`originLng` required; `destLat`/`destLng`, `description`, `photoUrl` opcionales.
 * Coordenadas en rango WGS84, `description` ≤ 500 y `photoUrl` https (DCC-03).
 */
export const createServiceSchema = z.object({
  type: serviceTypeSchema,
  originLat: latitudeSchema,
  originLng: longitudeSchema,
  destLat: latitudeSchema.optional(),
  destLng: longitudeSchema.optional(),
  description: z.string().max(SERVICE_DESCRIPTION_MAX_LENGTH).optional(),
  photoUrl: httpsUrlSchema.optional(),
});

/**
 * Schema for `GET /services/nearby` query params.
 * `lat`/`lng` required (coerced from string, en rango); `radiusKm` opcional
 * entre 1 y 25 km. Sin `radiusKm`, el backend aplica `NEARBY_RADIUS_KM`.
 */
export const nearbyServicesQuerySchema = z.object({
  lat: latitudeQuerySchema,
  lng: longitudeQuerySchema,
  radiusKm: nearbyRadiusKmQuerySchema.optional(),
});

/**
 * Schema for `PATCH /services/:id/status` body.
 * `status` debe ser un valor válido de `ServiceStatus`.
 */
export const updateServiceStatusSchema = z.object({
  status: serviceStatusSchema,
});

/**
 * Schema for `POST /services/:id/quotes` body (cambio-005 / REQ-004).
 * `amount` requerido (positivo); `estimatedMinutes` y `note` opcionales.
 */
export const createQuoteSchema = z.object({
  amount: z.number().positive('amount must be positive'),
  estimatedMinutes: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

/**
 * Schema for `POST /quotes/:id/accept` body (cambio-005 / REQ-004).
 * Body vacío — el accept no recibe payload, solo valida que el body sea `{}`.
 */
export const acceptQuoteSchema = z.object({});

// GET /services: strict query prevents client-controlled identity selectors.
export const listServicesQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default('20'),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/)
      .optional(),
  })
  .strict();

export const serviceListItemSchema = z
  .object({
    id: z.string(),
    type: serviceTypeSchema,
    status: serviceStatusSchema,
    originLat: z.number(),
    originLng: z.number(),
    destLat: z.number().nullable(),
    destLng: z.number().nullable(),
    description: z.string().nullable(),
    photoUrl: z.string().nullable(),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const listServicesResponseSchema = z
  .object({
    items: z.array(serviceListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type ServiceListItem = z.infer<typeof serviceListItemSchema>;
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;

// ─── Inferred types ──────────────────────────────────────────────────────────

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type NearbyServicesQuery = z.infer<typeof nearbyServicesQuerySchema>;
export type UpdateServiceStatusInput = z.infer<
  typeof updateServiceStatusSchema
>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type AcceptQuoteInput = z.infer<typeof acceptQuoteSchema>;
