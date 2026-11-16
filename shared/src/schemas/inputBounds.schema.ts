import { z } from 'zod';

/**
 * Límites de entrada compartidos (DCC-03).
 *
 * Coordenadas WGS84 finitas en rango; textos y URL acotados; radio y número
 * de resultados de `GET /services/nearby` con tope.
 */

export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/** Radio de búsqueda permitido en `GET /services/nearby` (km). */
export const NEARBY_MIN_RADIUS_KM = 1;
export const NEARBY_MAX_RADIUS_KM = 25;
/** Máximo de filas que devuelve `GET /services/nearby`. */
export const NEARBY_MAX_RESULTS = 50;

export const SERVICE_DESCRIPTION_MAX_LENGTH = 500;
export const PHOTO_URL_MAX_LENGTH = 2048;
export const TRUCK_TYPE_MAX_LENGTH = 60;
export const LICENSE_PLATE_MAX_LENGTH = 20;

export const latitudeSchema = z
  .number()
  .finite()
  .min(LATITUDE_MIN)
  .max(LATITUDE_MAX);

export const longitudeSchema = z
  .number()
  .finite()
  .min(LONGITUDE_MIN)
  .max(LONGITUDE_MAX);

/** Variantes para query string (`?lat=4.65`). */
export const latitudeQuerySchema = z.coerce
  .number()
  .finite()
  .min(LATITUDE_MIN)
  .max(LATITUDE_MAX);

export const longitudeQuerySchema = z.coerce
  .number()
  .finite()
  .min(LONGITUDE_MIN)
  .max(LONGITUDE_MAX);

/** URL absoluta `https://` de como máximo `PHOTO_URL_MAX_LENGTH` caracteres. */
export const httpsUrlSchema = z
  .string()
  .max(PHOTO_URL_MAX_LENGTH)
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'URL must use https',
  });
