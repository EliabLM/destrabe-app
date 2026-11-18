import { createApp } from './app';
import { parseEnv } from './lib/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createShutdown, installShutdownHandlers } from './lib/shutdown';

const env = parseEnv();

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    'destrabe backend listening',
  );
});

// DCC-17: apagado ordenado con SIGTERM/SIGINT. Los procesos de fondo que se
// arranquen aquí (p. ej. el barrido de expiración) van en `steps`.
installShutdownHandlers(
  createShutdown({
    server,
    logger,
    steps: [],
    disconnectDb: () => prisma.$disconnect(),
  }),
);
