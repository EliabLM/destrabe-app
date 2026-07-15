-- Cambio-004 / T8 — Habilita la extensión PostGIS.
-- Requerido por GET /services/nearby (ST_DWithin + ST_MakePoint + ::geography).
-- Idempotente: IF NOT EXISTS evita error si ya está instalada.
CREATE EXTENSION IF NOT EXISTS postgis;
