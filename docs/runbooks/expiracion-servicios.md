# Expiración de servicios sin Redis (DCC-07 / DCC-19)

## Qué hace

Un servicio admite cotizaciones mientras está en `PENDING` o `QUOTED` y no ha
vencido `expiresAt` (`SERVICE_TIMEOUT_MINUTES` después de crearlo; 15 por
defecto). Si el cliente no acepta ninguna oferta antes, el servicio pasa a
`CANCELLED` y se notifica al cliente (por ahora, una línea de log
`{ event: 'expired', ... }`).

El proceso de la API ejecuta `expireOverdueServices()` al arrancar y luego cada
`SERVICE_EXPIRY_SWEEP_SECONDS` (60 por defecto). Es un único `UPDATE` en
Postgres protegido con `pg_try_advisory_xact_lock`: con varias réplicas, solo
una barre a la vez y ningún servicio se notifica dos veces.

`/services/nearby` y la vista previa del operador ya filtran por
`expiresAt > NOW()`, así que un servicio vencido deja de verse aunque el
barrido todavía no lo haya cancelado.

## Cambios en Coolify al desplegar

Los aplica `ops` con permiso de Eliab, después de fusionar:

1. La API ya no lee `REDIS_URL`. Se puede borrar la variable (si se deja, se
   ignora).
2. El healthcheck sigue en `GET /health`; ahora solo comprueba Postgres.
3. Con la API desplegada y sana, el recurso Redis de Destrabe deja de usarse y
   se puede retirar para liberar memoria. Retirarlo es una operación aparte.

## Comprobar

```sql
-- Servicios abiertos ya vencidos (debería quedar en 0 tras un barrido).
SELECT count(*) FROM "Service"
WHERE status IN ('PENDING', 'QUOTED') AND "expiresAt" < NOW();
```
