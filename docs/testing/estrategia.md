# Estrategia de Testing — destrabe

## Filosofía: TDD estricto

Red → Green → Refactor. Cada pieza de código nace de un test que la justifica.

1. Escribir el test primero (RED: falla porque la impl no existe).
2. Escribir la implementación mínima para que pase (GREEN).
3. Refactorizar manteniendo el test verde.

## Suites separadas (backend)

| Suite | Comando            | Requiere DB           | Config                | Alcance                                                              |
| ----- | ------------------ | --------------------- | --------------------- | -------------------------------------------------------------------- |
| unit  | `npm test`         | No                    | `vitest.config.ts`    | schemas Zod, env, middleware, routes (sin tocar Postgres)            |
| db    | `npm run test:db`  | Sí (Postgres/PostGIS) | `vitest.db.config.ts` | relaciones Prisma, cascade, enum constraints (fileParallelism=false) |
| all   | `npm run test:all` | Sí (Postgres/PostGIS) | ambos                 | unit + db                                                            |

Helper de tests DB: `backend/__tests__/db/helpers.ts` — `prisma` + `resetDb()` (TRUNCATE todas las tablas CASCADE, en una sola sentencia para evitar deadlocks).

## CI de pull requests a `main`

`.github/workflows/ci.yml` usa dos jobs independientes en GitHub-hosted `ubuntu-latest` con Node 20 y `npm ci`. No usa secretos, servicios de producción ni compila binarios móviles.

| Job            | Comandos (en orden)                                                                                                                                                                                                                                        | Qué comprueba                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks rápidos | `npm ci`; `npm run build -w @destrabe/shared`; `npx prisma generate --schema=backend/prisma/schema.prisma`; `npm run ts:check -w @destrabe/app`; `npm run build -w @destrabe/backend`; `npm test`; `npm run lint`; `npm run format:check`; `npm run build` | Lock reproducible, tipos de app/backend/shared, suite Vitest no-DB, ESLint y Prettier. El build raíz ejecuta los `build` existentes (shared y backend); NO hace build nativo de Expo. |
| Contratos DB   | `npm ci`; build de shared; generate de Prisma; `npx prisma migrate deploy --schema=backend/prisma/schema.prisma`; `npm run test:db`                                                                                                                        | PostGIS/PostgreSQL 16 aislado, healthchecks, migraciones existentes y suite DB secuencial. `test:db` no admite cero tests (`--passWithNoTests` eliminado).                            |

En CI, `DATABASE_URL` apunta exclusivamente al contenedor temporal `destrabe_ci` ; `NODE_ENV=test` y `PAYMENT_GATEWAY=stub`. Los tests de DB limpian tablas: **nunca** apuntarlos a producción. En local solo ejecutar DB con Postgres/PostGIS de pruebas accesible, URL explícita y migraciones aplicadas; esta VM no dispone de Docker/DB local para validar esa suite, cuya evidencia debe venir del job remoto.

### Matriz de contratos efectivamente ejercitados

| Contrato              | Evidencia automatizada                                                                                                                                                                                                                                                        | Límite                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| OTP y sesión móvil    | `auth.mobile.contract.test.ts` prueba HTTP con Bearer (OTP válido/inválido, `/api/me`, ruta protegida y revocación); `auth.mobile.store.test.ts` prueba rehidratación y borrado del token. `db/auth.otp.flow.test.ts` prueba cookie/OTP persistidos con Better Auth y Prisma. | SMS Plivo reemplazado por mock; no se prueba SMS real ni transporte en dispositivo.           |
| Servicio y cotización | `db/services.lifecycle.test.ts` prueba roles, FSM, aislamiento y búsqueda PostGIS; `db/quotes.lifecycle.test.ts` prueba cotización, aceptación y Payment pendiente.                                                                                                           | `db/services.expiry.test.ts` prueba la expiración real (SQL) y `/nearby` con varias ofertas.  |
| Pago                  | `db/payments.lifecycle.test.ts` prueba iniciación con gateway stub, autenticación webhook, idempotencia, estados y bloqueo de COMPLETED sin pago confirmado.                                                                                                                  | No conecta con MercadoPago sandbox externo, redirección real, webhook público ni dinero real. |

No hay E2E en emulador/dispositivo ni ejecución real de SMS o pasarela. Los checks de tipos no sustituyen Jest/Expo ni verifican interfaz móvil visual. `npm test` excluye `backend/__tests__/db/**`; `npm run test:db` incluye exclusivamente esos archivos y falla si no descubre pruebas. El umbral de cobertura indicado abajo solo se evalúa al ejecutar `npm test -- --coverage`, no en CI.

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
- Estado histórico de foundation: 100% en cambio-001; no representa la cobertura actual de todos los dominios.

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

| Aspecto    | Valor                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Suite      | db (`vitest.db.config.ts`, `fileParallelism=false`)                                                                          |
| Requiere   | Postgres+PostGIS up (`db:up`) + migración `init_postgis` aplicada                                                            |
| Cookie jar | `supertest.agent(createApp())` por usuario; múltiples agentes por test (client, operator, client2)                           |
| Mock plivo | `vi.mock('../../src/lib/plivo', ...)` captura el OTP para reintegrarlo en `/verify`                                          |
| Helper rol | `authenticateAs(phone, role)` — OTP flow + `prisma.user.update({role})` si no es CLIENT (getSession releé el rol de la fila) |
| Limpieza   | `TRUNCATE` de 11 tablas (Service, ClientProfile, User, Session, …) CASCADE por test                                          |
| PostGIS    | `seedService({status, lat, lng})` siembra directamente; Bogotá 4.65/-74.10, ~10km = +0.09 deg lat                            |

Casos cubiertos: POST (201 PENDING + ClientProfile lazy; 401 sin auth; 403 non-CLIENT), GET /:id (dueño completo / operador público / ajeno 404 / inexistente 404), PATCH (PENDING→CANCELLED 200; ilegal 409), GET /nearby (PENDING 1km dentro / ~10km fora / COMPLETED fora; 403 non-OPERATOR), init_postgis idempotente (`pg_extension` + `CREATE EXTENSION IF NOT EXISTS`).

### Suite quotes lifecycle (`quotes.lifecycle.test.ts`)

Db smoke end-to-end de los 3 endpoints de quotes (cambio-005 / REQ-001..007). Autentica CLIENT y OPERATOR vía OTP y ejercita el flujo core: cotizar → aceptar → ACTIVE + Payment stub.

| Aspecto         | Valor                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Suite           | db (`vitest.db.config.ts`, `fileParallelism=false`)                                                             |
| Requiere        | Postgres+PostGIS up (`db:up`) + migración `init_postgis`                                                        |
| Cookie jar      | `supertest.agent(createApp())` por usuario; client + operator + operator2 + client2 en el mismo test            |
| Mock plivo      | `vi.mock('../../src/lib/plivo', ...)` captura el OTP para `/verify`                                             |
| Helper operator | `authenticateOperatorWithProfile(phone)` — OTP flow + `user.update({role:OPERATOR})` + `operatorProfile.create` |
| Limpieza        | `truncateAll` de 11 tablas (incluye Quote/Payment) CASCADE por test                                             |

Casos cubiertos: POST quote (PENDING→QUOTED 201; segunda quote QUOTED no transiciona; reemplazo de la cotización del mismo operador 200, también con dos peticiones simultáneas; índice único en BD; 409 operador no disponible; 400 importe decimal o fuera de rango; 422 sin OperatorProfile; 409 ACTIVE; 403 non-OPERATOR; 401), GET quotes (dueño todas + operator data; operador solo suyas; ajeno 404), POST accept (QUOTED→ACTIVE + Payment con comisión del 10 % + acceptedQuoteId; 409 doble-accept ALREADY_ACCEPTED; 403 no-dueño).

`db/migration.copAmounts.test.ts` devuelve la BD al estado previo a `20261119120000_cop_integer_amounts`, siembra importes con decimales y cotizaciones duplicadas, ejecuta la migración y comprueba el redondeo, la deduplicación y las restricciones. `db/cascade.test.ts` comprueba que borrar un usuario con historial falla por `Restrict`.

## Próximos dominios (futuro)

- **app/ (RN)**: Jest + jest-expo + @testing-library/react-native. Se documentará al iniciar el cambio mobile.
- **E2E**: pendiente (probable Detox o Maestro) — se evalúa en MVP.
