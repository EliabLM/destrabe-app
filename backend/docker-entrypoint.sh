#!/bin/sh
# Entrada del contenedor (DCC-17): aplica las migraciones y, solo si terminan
# bien, reemplaza este shell por Node con `exec`. Así Node es el PID 1 y recibe
# SIGTERM directamente para el apagado ordenado.
set -eu
./node_modules/.bin/prisma migrate deploy --schema=backend/prisma/schema.prisma
exec node backend/dist/server.js
