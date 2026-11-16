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

/**
 * Número en query string (`?lat=4.65`). Rechaza el valor vacío, que
 * `z.coerce.number()` convertiría en 0. `transform(Number)` + `pipe` tipa
 * igual con zod 3 y zod 4.
 */
const queryNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .pipe(z.number().finite().min(min).max(max));

export const latitudeQuerySchema = queryNumber(LATITUDE_MIN, LATITUDE_MAX);
export const longitudeQuerySchema = queryNumber(LONGITUDE_MIN, LONGITUDE_MAX);
export const nearbyRadiusKmQuerySchema = queryNumber(
  NEARBY_MIN_RADIUS_KM,
  NEARBY_MAX_RADIUS_KM,
);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * URL absoluta `https:` (sin distinguir mayúsculas en el esquema) de como
 * máximo `PHOTO_URL_MAX_LENGTH` caracteres.
 */
export const httpsUrlSchema = z
  .string()
  .max(PHOTO_URL_MAX_LENGTH)
  .refine(isHttpsUrl, { message: 'URL must use https' });
