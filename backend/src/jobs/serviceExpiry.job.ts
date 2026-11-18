import { ServiceStatus } from '@destrabe/shared';
import { prisma } from '../lib/prisma';
import { notifyClient } from '../lib/notifications';
import { canTransition } from '../services/serviceMachine';

/**
 * Expiración de servicios (DCC-07 / DCC-19).
 *
 * Un servicio admite cotizaciones hasta `expiresAt` (POST /services la fija a
 * `SERVICE_TIMEOUT_MINUTES`). Esa misma fecha vale para PENDING y para QUOTED:
 * si el cliente no acepta ninguna oferta antes de `expiresAt`, el servicio se
 * cancela aunque ya tenga cotizaciones.
 *
 * `expireOverdueServices()` hace el cambio con un único UPDATE condicionado,
 * así que es idempotente: una segunda ejecución no encuentra filas y no
 * vuelve a notificar. El disparador es un barrido periódico dentro del proceso
 * (`startServiceExpirySweeper`); no hace falta Redis.
 *
 * Entre `expiresAt` y el siguiente barrido el servicio sigue en PENDING/QUOTED,
 * pero ya no aparece en `/services/nearby` ni en la vista previa del operador,
 * porque esas consultas filtran por `expiresAt > NOW()`.
 */

/** Clave del advisory lock: un solo barrido a la vez entre réplicas. */
export const SERVICE_EXPIRY_LOCK_KEY = 707_001;

const EXPIRABLE = [ServiceStatus.PENDING, ServiceStatus.QUOTED] as const;

// El barrido actúa como `system`: la FSM debe permitirlo para ambos estados.
for (const from of EXPIRABLE) {
  if (!canTransition(from, ServiceStatus.CANCELLED, 'system')) {
    throw new Error(`FSM: system cannot cancel ${from} services`);
  }
}

interface ExpiredRow {
  id: string;
  clientProfileId: string;
}

/**
 * Cancela los servicios PENDING/QUOTED con `expiresAt` vencido y notifica al
 * cliente de cada uno. Devuelve cuántos servicios canceló.
 *
 * Si otra réplica tiene el barrido en curso (advisory lock ocupado), no hace
 * nada y devuelve 0.
 */
export async function expireOverdueServices(): Promise<number> {
  const expired = await prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${SERVICE_EXPIRY_LOCK_KEY}::bigint) AS locked
    `;
    if (!locked) return [];
    return tx.$queryRaw<ExpiredRow[]>`
      UPDATE "Service"
      SET status = 'CANCELLED'::"ServiceStatus", "updatedAt" = NOW()
      WHERE status IN ('PENDING'::"ServiceStatus", 'QUOTED'::"ServiceStatus")
        AND "expiresAt" < NOW()
      RETURNING id, "clientProfileId"
    `;
  });

  // Se notifica después del commit: nunca por un cambio que no se guardó.
  for (const service of expired) notifyClient(service, 'expired');
  return expired.length;
}

export interface ServiceExpirySweeper {
  stop(): void;
}

/**
 * Ejecuta `run` al arrancar y luego cada `intervalMs`. Si una ejecución sigue
 * en curso cuando llega la siguiente, la salta. Los errores se registran y el
 * barrido continúa en el siguiente intervalo.
 */
export function startServiceExpirySweeper(
  intervalMs: number,
  run: () => Promise<unknown> = expireOverdueServices,
): ServiceExpirySweeper {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      console.error({
        event: 'service_expiry_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  // No impide que el proceso termine (p. ej. al apagar el servidor).
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
