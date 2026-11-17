import { ServiceStatus } from '@destrabe/shared';

/**
 * Reglas de acceso del rol OPERATOR a un servicio (DCC-02).
 *
 * - El operador asignado (`assignedOperatorProfileId`) ve el detalle completo
 *   y es el único que puede cambiar su estado.
 * - Un operador no asignado solo ve servicios abiertos a cotización
 *   (PENDING/QUOTED sin expirar) y en vista previa: coordenadas aproximadas y
 *   sin foto, direcciones ni datos del cliente.
 */

/** 3 decimales ≈ 110 m de latitud; precisión suficiente para cotizar. */
const COORD_DECIMALS = 3;
const COORD_FACTOR = 10 ** COORD_DECIMALS;

export function roundCoord(value: number): number;
export function roundCoord(value: number | null): number | null;
export function roundCoord(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * COORD_FACTOR) / COORD_FACTOR;
}

export function isOpenForQuotes(
  service: { status: string; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    (service.status === ServiceStatus.PENDING ||
      service.status === ServiceStatus.QUOTED) &&
    service.expiresAt.getTime() > now.getTime()
  );
}

export interface ServicePreviewSource {
  id: string;
  type: string;
  status: string;
  description: string | null;
  originLat: number;
  originLng: number;
  destLat: number | null;
  destLng: number | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Vista previa para operadores no asignados (lista blanca de campos). */
export function toOperatorPreview(service: ServicePreviewSource) {
  return {
    id: service.id,
    type: service.type,
    status: service.status,
    description: service.description,
    originLat: roundCoord(service.originLat),
    originLng: roundCoord(service.originLng),
    destLat: roundCoord(service.destLat),
    destLng: roundCoord(service.destLng),
    expiresAt: service.expiresAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}
