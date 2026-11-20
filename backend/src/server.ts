import { startServer } from './bootstrap';
import { parseEnv } from './lib/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createShutdown, installShutdownHandlers } from './lib/shutdown';

const running = startServer(parseEnv());

// DCC-17: apagado ordenado con SIGTERM/SIGINT. Primero el servidor HTTP,
// luego el barrido de expiración (DCC-07) y al final la BD.
installShutdownHandlers(
  createShutdown({
    server: running.server,
    logger,
    steps: [
      {
        name: 'service-expiry-sweeper',
        close: () => running.expirySweeper.stop(),
      },
    ],
    disconnectDb: () => prisma.$disconnect(),
  }),
);
