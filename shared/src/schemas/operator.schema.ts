import { z } from 'zod';
import {
  httpsUrlSchema,
  latitudeSchema,
  LICENSE_PLATE_MAX_LENGTH,
  longitudeSchema,
  TRUCK_TYPE_MAX_LENGTH,
} from './inputBounds.schema';

/**
 * Schema for `POST /api/operator/profile` (cambio-008 / D1 / REQ-OP-001).
 *
 * Fields:
 * - `truckType` (string, required): tipo de vehículo (ej. "grúa", "plataforma")
 * - `licensePlate` (string, required): placa del vehículo (sin validación formato en Demo)
 * - `photoUrl` (string, optional): URL https de foto del operador/vehículo
 * - `available` (boolean, optional, default false): disponible para tomar servicios
 * - `lastLatitude` (number, optional): última latitud conocida
 * - `lastLongitude` (number, optional): última longitud conocida
 */
export const createOperatorProfileSchema = z.object({
  truckType: z
    .string()
    .min(1, 'truckType is required')
    .max(TRUCK_TYPE_MAX_LENGTH),
  licensePlate: z
    .string()
    .min(1, 'licensePlate is required')
    .max(LICENSE_PLATE_MAX_LENGTH),
  photoUrl: httpsUrlSchema.optional(),
  available: z.boolean().optional().default(false),
  lastLatitude: latitudeSchema.optional(),
  lastLongitude: longitudeSchema.optional(),
});

/**
 * Schema for `PATCH /api/operator/location` (cambio-008 / D2 / REQ-OP-002).
 *
 * Fields:
 * - `lastLatitude` (number, required): nueva latitud
 * - `lastLongitude` (number, required): nueva longitud
 * - `available` (boolean, optional): toggle de disponibilidad
 */
export const updateLocationSchema = z.object({
  lastLatitude: latitudeSchema,
  lastLongitude: longitudeSchema,
  available: z.boolean().optional(),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type CreateOperatorProfileInput = z.infer<
  typeof createOperatorProfileSchema
>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
