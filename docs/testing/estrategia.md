# Estrategia de Testing — destrabe

## Filosofía: TDD estricto

Red → Green → Refactor. Cada pieza de código nace de un test que la justifica.

1. Escribir el test primero (RED: falla porque la impl no existe).
2. Escribir la implementación mínima para que pase (GREEN).
3. Refactorizar manteniendo el test verde.

## Suites separadas (backend)

| Suite | Comando            | Requiere DB  | Config                | Alcance                                                              |
| ----- | ------------------ | ------------ | --------------------- | -------------------------------------------------------------------- |
| unit  | `npm test`         | No           | `vitest.config.ts`    | schemas Zod, env, middleware, routes (sin tocar Postgres)            |
| db    | `npm run test:db`  | Sí (`db:up`) | `vitest.db.config.ts` | relaciones Prisma, cascade, enum constraints (fileParallelism=false) |
| all   | `npm run test:all` | Sí           | ambos                 | unit + db                                                            |

Helper de tests DB: `backend/__tests__/db/helpers.ts` — `prisma` + `resetDb()` (TRUNCATE todas las tablas CASCADE, en una sola sentencia para evitar deadlocks).

## Runners por dominio

| Dominio                    | Runner           | Alcance                                      |
| -------------------------- | ---------------- | -------------------------------------------- |
| backend + shared (Node)    | Vitest           | API Express, schemas Zod, lógica de servidor |
| app/ (React Native + Expo) | Jest + jest-expo | componentes, hooks, stores (futuro)          |

Vitest se eligió por soporte nativo de TS, watch rápido y ESM. RN usará Jest porque Expo lo integra por defecto. Los runners están scoped por dominio (no se mezclan).

## Cobertura

- Herramienta: `@vitest/coverage-v8` (provider v8).
- Umbral mínimo: 80% en lines, branches, functions y statements (global backend+shared).
- Config: `vitest.config.ts` raíz. `include: backend/src/**/*.ts`, `shared/src/**/*.ts`.
- Exclusiones de cobertura: barrels (`**/index.ts`), `backend/src/server.ts` (entry de arranque), `backend/src/lib/prisma.ts` (placeholder).
- Estado actual: 100% (cambio-001-foundation).

## Convenciones

- Archivos de test: `*.test.ts` dentro de `__tests__/` por paquete.
- Helpers de test: `__tests__/helpers/` si hace falta.
- `describe`: nombre del módulo o ruta.
- Tests HTTP (backend): `supertest` contra `createApp()` (factory sin `listen`).
- Tests unitarios de middleware: llamada directa con mocks o mini-app Express.

## Comandos

```bash
npm test                      # corre toda la suite (vitest run)
npm test -- --coverage        # con reporte de cobertura
npm run test:watch            # modo watch (TDD)
npm run test -w @destrabe/shared   # solo shared
npm run test -w @destrabe/backend  # solo backend
```

## Integración vs unitario

- **Unitario**: schemas (shared), `parseEnv`, middleware directo, config de auth (`auth.config.test.ts`), Plivo client (`plivo.test.ts`).
- **Integración**: `/health` vía supertest, resolución de workspace (`@destrabe/shared` desde backend), montaje de auth handler (`auth.mount.test.ts`).
- **DB smoke (auth flow)**: `auth.otp.flow.test.ts` — flujo OTP end-to-end (send → verify → get-session → sign-out) con Postgres real, `request.agent` (cookie jar) y mock de Plivo que captura el código generado por el plugin. Cubre REQ-006/007/010 de `cambio-003-auth`.

### Suite auth flow (`auth.otp.flow.test.ts`)

| Aspecto        | Valor                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Suite          | db (`vitest.db.config.ts`, `fileParallelism=false`)                                                                                      |
| Requiere       | Postgres up + migración `add_auth_identity` aplicada                                                                                     |
| Cookie jar     | `supertest.agent(app)` conserva cookies entre requests                                                                                   |
| Mock           | `vi.mock('../src/lib/plivo', ...)` captura `sendOtp({phoneNumber, code})`                                                                |
| Limpieza       | `TRUNCATE` de `User/Session/Account/Verification` (CASCADE) por test                                                                     |
| `DATABASE_URL` | Debes inyectarla al proceso que lanza vitest (no basta `process.env` dentro del test — el singleton `prisma` lo captura en construcción) |

> **Desviación documentada:** las rutas reales del plugin `phoneNumber` son `/phone-number/send-otp` y `/phone-number/verify` (no `/phone/send-otp` y `/phone/verify-otp` como decía la spec §7.1). Ver ADR-003 y cabecera del test.

### Suite services lifecycle (`services.lifecycle.test.ts`)

Db smoke end-to-end de los 4 endpoints de `/services` (cambio-004 / REQ-002/003/004/005/010). Autentica CLIENT y OPERATOR vía el flujo OTP (reusa el mock de Plivo) y ejercita la FSM, la búsqueda PostGIS y la migración `init_postgis`.

| Aspecto          | Valor                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Suite            | db (`vitest.db.config.ts`, `fileParallelism=false`)                                                                            |
| Requiere         | Postgres+PostGIS up + Redis up (`db:up`) + migración `init_postgis` aplicada                                                   |
| Cookie jar       | `supertest.agent(createApp())` por usuario; múltiples agentes por test (client, operator, client2)                             |
| Mock plivo       | `vi.mock('../../src/lib/plivo', ...)` captura el OTP para reintegrarlo en `/verify`                                            |
| Mock queue       | `vi.mock('../../src/lib/queue', ...)` no-op `enqueueServiceExpiry` — evita `new Queue`/`new IORedis` al cargar `queue.ts`       |
| Helper rol       | `authenticateAs(phone, role)` — OTP flow + `prisma.user.update({role})` si no es CLIENT (getSession releé el rol de la fila)    |
| Limpieza         | `TRUNCATE` de 11 tablas (Service, ClientProfile, User, Session, …) CASCADE por test                                            |
| PostGIS          | `seedService({status, lat, lng})` siembra directamente; Bogotá 4.65/-74.10, ~10km = +0.09 deg lat                              |

Casos cubiertos: POST (201 PENDING + ClientProfile lazy; 401 sin auth; 403 non-CLIENT), GET /:id (dueño completo / operador público / ajeno 404 / inexistente 404), PATCH (PENDING→CANCELLED 200; ilegal 409), GET /nearby (PENDING 1km dentro / ~10km fora / COMPLETED fora; 403 non-OPERATOR), init_postgis idempotente (`pg_extension` + `CREATE EXTENSION IF NOT EXISTS`).

## Próximos dominios (futuro)

- **app/ (RN)**: Jest + jest-expo + @testing-library/react-native. Se documentará al iniciar el cambio mobile.
- **E2E**: pendiente (probable Detox o Maestro) — se evalúa en MVP.
