-- DCC-03: rangos WGS84 para las coordenadas de servicios y operadores.
-- NOT VALID: se aplica a inserciones y actualizaciones nuevas sin revisar las
-- filas existentes, así la migración no falla si hay datos antiguos atípicos.
-- GET /services/nearby además filtra esas filas. Para validarlas más adelante:
--   ALTER TABLE "Service" VALIDATE CONSTRAINT "Service_coordinates_range_check";
--   ALTER TABLE "OperatorProfile" VALIDATE CONSTRAINT "OperatorProfile_coordinates_range_check";

ALTER TABLE "Service" ADD CONSTRAINT "Service_coordinates_range_check" CHECK (
  "originLat" BETWEEN -90 AND 90
  AND "originLng" BETWEEN -180 AND 180
  AND ("destLat" IS NULL OR "destLat" BETWEEN -90 AND 90)
  AND ("destLng" IS NULL OR "destLng" BETWEEN -180 AND 180)
) NOT VALID;

ALTER TABLE "OperatorProfile" ADD CONSTRAINT "OperatorProfile_coordinates_range_check" CHECK (
  ("lastLatitude" IS NULL OR "lastLatitude" BETWEEN -90 AND 90)
  AND ("lastLongitude" IS NULL OR "lastLongitude" BETWEEN -180 AND 180)
) NOT VALID;
