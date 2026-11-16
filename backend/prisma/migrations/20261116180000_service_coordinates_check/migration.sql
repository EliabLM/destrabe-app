-- DCC-03: rangos WGS84 para las coordenadas de servicios y operadores.
-- Primero se limpian los datos inválidos que existan y después se añade la
-- restricción ya validada, para que ninguna fila quede bloqueada en UPDATE.

-- Operador: la última ubicación inválida se descarta.
UPDATE "OperatorProfile"
SET "lastLatitude" = NULL, "lastLongitude" = NULL
WHERE NOT (
  COALESCE("lastLatitude", 0) BETWEEN -90 AND 90
  AND COALESCE("lastLongitude", 0) BETWEEN -180 AND 180
);

-- Destino opcional: el destino inválido se descarta.
UPDATE "Service"
SET "destLat" = NULL, "destLng" = NULL, "updatedAt" = NOW()
WHERE NOT (
  COALESCE("destLat", 0) BETWEEN -90 AND 90
  AND COALESCE("destLng", 0) BETWEEN -180 AND 180
);

-- Origen obligatorio: se acota al rango (lo mismo que hace PostGIS al
-- convertir a geography) y se cancelan los servicios aún abiertos.
UPDATE "Service"
SET
  "status" = CASE
    WHEN "status" IN ('PENDING', 'QUOTED') THEN 'CANCELLED'::"ServiceStatus"
    ELSE "status"
  END,
  "originLat" = LEAST(GREATEST("originLat", -90), 90),
  "originLng" = LEAST(GREATEST("originLng", -180), 180),
  "updatedAt" = NOW()
WHERE NOT (
  "originLat" BETWEEN -90 AND 90
  AND "originLng" BETWEEN -180 AND 180
);

ALTER TABLE "Service" ADD CONSTRAINT "Service_coordinates_range_check" CHECK (
  "originLat" BETWEEN -90 AND 90
  AND "originLng" BETWEEN -180 AND 180
  AND ("destLat" IS NULL OR "destLat" BETWEEN -90 AND 90)
  AND ("destLng" IS NULL OR "destLng" BETWEEN -180 AND 180)
);

ALTER TABLE "OperatorProfile" ADD CONSTRAINT "OperatorProfile_coordinates_range_check" CHECK (
  ("lastLatitude" IS NULL OR "lastLatitude" BETWEEN -90 AND 90)
  AND ("lastLongitude" IS NULL OR "lastLongitude" BETWEEN -180 AND 180)
);
