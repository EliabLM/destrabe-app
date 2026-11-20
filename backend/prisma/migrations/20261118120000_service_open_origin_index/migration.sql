-- DCC-07: índice espacial parcial para GET /services/nearby.
-- Solo indexa los servicios abiertos a cotización (PENDING y QUOTED), que son
-- los únicos que busca el operador. La expresión es la misma de la consulta
-- (ST_MakePoint(lng, lat)::geography) para que el planificador la use con
-- ST_DWithin. Migración aditiva: no cambia datos ni columnas.
-- Prisma no representa índices por expresión en schema.prisma; vive solo aquí.
CREATE INDEX IF NOT EXISTS "Service_open_origin_geog_idx"
  ON "Service"
  USING GIST ((ST_MakePoint("originLng", "originLat")::geography))
  WHERE status IN ('PENDING'::"ServiceStatus", 'QUOTED'::"ServiceStatus");
