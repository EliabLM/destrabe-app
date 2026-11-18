import type { Server } from 'node:http';
import type { Logger } from 'pino';

/** Algo que hay que cerrar al apagar: worker, cola, barrido periódico… */
export interface ShutdownStep {
  name: string;
  close: () => unknown;
}

export interface ShutdownOptions {
  server: Server;
  logger: Logger;
  /**
   * Se cierran en orden después del servidor HTTP y antes de la BD. Punto de
   * extensión para el barrido de expiración (DCC-07) u otros procesos de fondo.
   */
  steps?: ShutdownStep[];
  disconnectDb: () => Promise<unknown>;
  /** Tiempo máximo antes de forzar la salida (Docker manda SIGKILL a los 10 s). */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

export const SHUTDOWN_TIMEOUT_MS = 8000;

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    // Las conexiones keep-alive sin petición en curso no deben retrasar el cierre.
    server.closeIdleConnections();
  });
}

/**
 * Apagado ordenado (DCC-17): deja de aceptar conexiones y espera las
 * peticiones en curso, cierra los procesos de fondo, desconecta Prisma y sale.
 * Si algo se cuelga más de `timeoutMs`, sale con código 1.
 * Llamarlo dos veces no repite el cierre.
 */
export function createShutdown(options: ShutdownOptions) {
  const {
    server,
    logger,
    steps = [],
    disconnectDb,
    timeoutMs = SHUTDOWN_TIMEOUT_MS,
    exit = (code) => process.exit(code),
  } = options;
  let running: Promise<void> | undefined;

  return function shutdown(signal: string): Promise<void> {
    if (running) return running;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error({ signal, timeoutMs }, 'shutdown timed out; forcing exit');
      exit(1);
    }, timeoutMs);
    timer.unref();

    running = (async () => {
      let code = 0;
      try {
        await closeServer(server);
        for (const step of steps) {
          try {
            await step.close();
          } catch (err) {
            code = 1;
            logger.error({ err, step: step.name }, 'shutdown step failed');
          }
        }
      } catch (err) {
        code = 1;
        logger.error({ err }, 'failed to close HTTP server');
      } finally {
        try {
          await disconnectDb();
        } catch (err) {
          code = 1;
          logger.error({ err }, 'failed to disconnect database');
        }
      }
      clearTimeout(timer);
      logger.info({ signal, code }, 'shutdown complete');
      exit(code);
    })();
    return running;
  };
}

type SignalSource = Pick<NodeJS.Process, 'once'>;

export function installShutdownHandlers(
  shutdown: (signal: string) => Promise<void>,
  proc: SignalSource = process,
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    proc.once(signal, () => void shutdown(signal));
  }
}
