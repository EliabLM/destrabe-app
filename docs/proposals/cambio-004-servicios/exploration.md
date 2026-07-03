# Exploration — Cambio-004: Servicios (ciclo de vida + timer)

**Change ID:** `cambio-004-servicios`
**Etapa SDD:** Explore
**Branch:** `develop` (HEAD 60933c3 — archive de cambio-003 ya mergeado)
**Basado en:** spec §5 (módulos Servicios/Cotizaciones), §6 (modelo `Service`), §7.2 (ciclo de vida), §9 (env), ADR-002 (Express+TS). ADR-derivar del `previewFeatures postgis`.

## Current State

`cambio-001` (foundation), `cambio-002` (data model) y `cambio-003` (Better Auth) están mergeados en `develop`. El backend ya tiene:

- **Schema Prisma** con el modelo `Service` completo + enum `ServiceType` (`BREAKDOWN|TRANSFER`), `ServiceStatus` (`PENDING|QUOTED|ACTIVE|COMPLETED|CANCELLED`), índices en `[clientProfileId]` y `[status]`, campo `expiresAt DateTime` (obligatorio) y `acceptedQuoteId String? @unique` con relación 1:1 a `Quote` (`"AcceptedQuote"`). Los enums `UserRole` y la FK real `ClientProfile.userId → User` también existen (cambio-003). (`backend/prisma/schema.prisma`).
- **Auth middleware** (`backend/src/middleware/auth.ts`): `requireAuth` (puebla `req.user = { id, phone, role }` vía `auth.api.getSession`) y `requireRole(role)` factory (403 si no coincide). Listo para proteger endpoints.
- **App factory** (`backend/src/app.ts`): pipeline `express.json() → router → notFound → errorHandler`. El `errorHandler` normaliza `{ error, code }`. No existe un `validate` middleware de Zod todavía (Zod solo se usa en `lib/env.ts`).
- **Rutas**: solo `health.routes.ts` y montaje del handler de Better Auth en `/api/auth/*` (`routes/index.ts`). Patrón: `Router()` por recurso, importado y montado en el index.
- **Shared**: `shared/src/types/service.ts` (enums `ServiceStatus`, `ServiceType`) y `shared/src/schemas/service.schema.ts` con solo `serviceStatusSchema`/`serviceTypeSchema` (Zod nativeEnum). Faltan schemas de **creación/nearby/status transition**.
- **Infra/colas**: `infra/docker-compose.dev.yml` solo levanta `postgis/postgis:16-3.4-alpine` (Postgres **con extensión PostGIS disponible** en la imagen). **No hay servicio Redis**. `backend/package.json` **no incluye** `bullmq` ni `ioredis`. `backend/src/lib/env.ts` declara `REDIS_URL` como opcional.
- **Env**: la spec §9 también menciona `SERVICE_TIMEOUT_MINUTES=15` y `FCM_*`, pero **ni una ni otra** están en `backend/src/lib/env.ts` todavía.
- **FCM/Push**: no hay cliente `firebase-admin`/`google-fcm` instalado; la spec lo usa solo para push al cliente en CANCELLED.
- **Tests**: patrón dual — unitarios en `backend/__tests__/*.test.ts` (sin DB) y db smoke en `backend/__tests__/db/*.test.ts` (Postgres real, `resetDb` TRUNCATE CASCADE + `seedUser`). El flujo OTP (cambio-003) usa `supertest` con cookie jar y `vi.hoisted` para mock de Plivo, patrón reutilizable.

## Affected Areas

- `backend/src/routes/services.routes.ts` *(nuevo)* — `POST /services`, `GET /services/nearby`, `GET /services/:id`, `PATCH /services/:id/status`.
- `backend/src/routes/index.ts` — montar `servicesRouter`.
- `backend/src/controllers` *(nuevo, opcional)* o handlers inline en el router — preferible controllers separados para no inflar el router (a decidir en design).
- `backend/src/services/serviceMachine.ts` *(nuevo)* — máquina de estados pura (transiciones permitidas + quién puede dispararlas). Sin IO.
- `backend/src/middleware/validate.ts` *(nuevo)* — `validate(schema, source)` factory Zod → 400 `{ error, code: 'VALIDATION_ERROR' }`. Reutilizable en futuros cambios.
- `backend/src/lib/queue.ts` *(nuevo)* — cliente BullMQ (`Queue` + `Worker`) para el timer de 15 min `PENDING → CANCELLED`.
- `backend/src/jobs/serviceExpiry.job.ts` *(nuevo)* — worker que procesa el job de expiración: carga el `Service`, si sigue `PENDING` → `CANCELLED` (+ futuro push, aquí solo log).
- `backend/src/lib/env.ts` — añadir `REDIS_URL` requerido en dev/prod (manteniendo opcional en `test`), `SERVICE_TIMEOUT_MINUTES` (default 15). Mantener `FCM_*` fuera del scope de este cambio.
- `backend/package.json` — deps: `bullmq`, `ioredis`. DevDeps: ya están `supertest`, `vitest`.
- `infra/docker-compose.dev.yml` — añadir servicio `redis:7-alpine` + healthcheck + `destrabe_redis_dev` volume (NB: permanece dev-only, el compose de prod es de otro cambio de infra).
- `shared/src/schemas/service.schema.ts` — ampliar con `createServiceSchema` (type, originLat/Lng, dest opcional, description?, photoUrl?), `nearbyServicesQuerySchema` (lat, lng, radiusKm), `updateServiceStatusSchema` (status + eventual reason). Re-exportar en `shared/src/schemas/index.ts`.
- `shared/src/types/service.ts` — añadir tipos de request/response derivados (`CreateServiceInput`, `NearbyServiceQuery`, `UpdateServiceStatusInput`) vía `z.infer`.
- `backend/prisma/migrations/` — **posible nueva migración** solo si se habilita `CREATE EXTENSION IF NOT EXISTS postgis;` (ver Approaches). No se tocan columnas del modelo `Service`.
- `backend/__tests__/` — unit: `serviceMachine.test.ts`, `validate.test.ts`, `services.routes.test.ts` (mock de prisma + auth). `__tests__/db/`: `services.lifecycle.test.ts` (supertest + cookie jar + BullMQ con Redis real o mockeado).
- `backend/.env.example` — documentar `REDIS_URL`, `SERVICE_TIMEOUT_MINUTES`.

## Approaches

### 1. Alcance (scope) del cambio-004 vs cambio-005 (quotes)

| Opción | Descripción | Pros | Contras | Effort |
| --- | --- | --- | --- | --- |
| **A. Solo máquina + CRUD + timer (defer quotes a cambio-005)** | cambio-004 implementa `POST /services`, `GET /services/nearby`, `GET /services/:id`, `PATCH /services/:id/status`, timer BullMQ 15 min. `POST /services/:id/quotes` y `POST /quotes/:id/accept` viven en cambio-005. | Principio incremental SDD: un flujo coherente, testable de extremo a extremo (`PENDING → CANCELLED` por timer o por cliente, `ACTIVE → COMPLETED` por operador). La interfaz con quotes (transición `PENDING → QUOTED` y `QUOTED → ACTIVE`) queda definida en el `serviceMachine` pero **no disparada** desde este cambio. | `QUOTED` y `ACTIVE` quedan inalcanzables en runtime hasta cambio-005; el flujo demo completo se completa recién con quotes. | Medio |
| B. Incluir `POST /services/:id/quotes` en cambio-004 | Añadir el endpoint de creación de cotización aquí. | Permite probar `PENDING → QUOTED` end-to-end. | Mezcla responsabilidades; duplica scope; el `accept` (que dispara `ACTIVE`) igual queda en cambio-005 →无论如何 el flujo demo no se cierra aquí. | Alto |

**Recomendación: Opción A.** Quotes son\(cambio-005\) por separado. Cambio-004 entrega una máquina de estados **completa y definida** (todas las transiciones legales documentadas y testeadas como unit), pero en runtime solo se ejercitan las ramas alcanzables sin quotes: `PENDING → CANCELLED` (client manual o timer) y `ACTIVE → COMPLETED` (operator). La transición `PENDING → QUOTED` se expone como **callback** `markQuoted(serviceId)` que cambio-005 invocará desde el endpoint de quotes — contrato explícito entre cambios.

### 2. BullMQ + Redis (timer 15 min `PENDING → CANCELLED`)

| Opción | Descripción | Pros | Contras | Effort |
| --- | --- | --- | --- | --- |
| **A. Instalar BullMQ + Redis ahora** | Añadir `redis:7-alpine` al `docker-compose.dev.yml`, instalar `bullmq`/`ioredis`, crear `lib/queue.ts` + `jobs/serviceExpiry.job.ts`. | El timer es **core** al ciclo §7.2 (no decorativo). Mantiene fidelidad con spec stack (§2). Cambio coherente: el `expiresAt` debe cumplirse o el flujo demo queda incompleto. | Suma una dependencia infra (Redis) y un worker process. Los db tests del timer necesitan Redis o un BullMQ mock. | Medio-Alto |
| B. Defer timer a cambio-005 | Exponer solo `expiresAt`; una tarea cron/worker se añade después. | Menor scope de este cambio. | Rompe el ciclo: el `PENDING` puede colgarse para siempre. Infiel a §7.2. | Bajo |
| C. Timer in-process con `setTimeout` | Implementar expiración con `setTimeout` en el proceso Express. | Sin Redis. | No sobrevive reinicios; impreciso bajo load; no esmalo productivo. | Bajo |

**Recomendación: Opción A.** El timer es parte del contrato de ciclo de vida; deferirlo deja un flujo demo manco. BullMQ + Redis se instalan aquí. Para tests db del worker: o (i) `ioredis` mockeado capturando el job y verificando su `data.serviceId` + `delay`, o (ii) Redis real en docker (más fiel, requiere `redis` up en CI/local). Recomendar **mockear en unit** el enqueue (`queue.add` spy) y **db smoke con Redis real** opcional para el job handler (el worker invoca directamente `expirePendingService(serviceId)` — función pura testeable sin queue).

### 3. `GET /services/nearby` — geo-query

PostGIS está disponible en la imagen (`postgis/postgis:16-3.4-alpine`) pero **no habilitado** en la DB (`CREATE EXTENSION postgis;` no se ha corrido) y `schema.prisma` **no** tiene `previewFeatures = ["postgis"]` (lat/lng son `Float`).

| Opción | Descripción | Pros | Contras | Effort |
| --- | --- | --- | --- | --- |
| A. Prisma `postgis` preview feature | Activar `previewFeatures = ["postgis"]`, migrar `originLat/Lng` a `Unsupported("geography(Point,4326)")`. | Type-safe desde Prisma. | **Preview feature inestable** en Prisma 5; rompe el schema actual (Float → geography) y obliga migración destructiva + reintegrar tests db de cambio-002. | Alto |
| **B. Raw SQL `ST_DWithin` + `CREATE EXTENSION postgis`** | Migración que ejecuta `CREATE EXTENSION IF NOT EXISTS postgis;` y `$queryRaw` con `ST_DWithin(geography(originLat,originLng)..., :meters)` ordenado por distancia. | Usa PostGIS real (imagen ya elegida en cambio-002 ex profeso). No toca el modelo. Consulta eficiente + precisa. | Requiere raw SQL (Prisma no tipa el resultado); hay que mapear columnas a mano. | Medio |
| C. Haversine en JS | `prisma.service.findMany({ where: { status: 'PENDING', expiresAt: { gt: now } } })` y filtrar/order en memoria con fórmula haversine. | Sin PostGIS, sin raw SQL. Type-safe. | Ineficiente a escala (carga todos los PENDING vigentes). Para Fase Demo (volúmenes bajos) es aceptable. | Bajo |

**Recomendación: Opción B** si el volumen justifica precisión/escala; **Opción C** si se quiere minimizar riesgo y scope en la Fase Demo. **Inclinación: Opción B** porque la imagen postgis ya está elegida en cambio-002 justamente para `/nearby` (exploration de cambio-002 lo difería explícitamente a "cambio-004/servicios/nearby"). El `CREATE EXTENSION postgis;` se hace una sola vez en una migración nueva `*_init_postgis`. El controller usa `$queryRaw` con parámetros binds (sin string interpolation → safe). Si en design se prefiere postergar, **Opción C** como fallback documentado.

### 4. Máquina de estados — dónde vive la lógica de transiciones

| Opción | Descripción | Pros | Contras |
| --- | --- | --- | --- |
| **A. Módulo puro `serviceMachine.ts`** | Exporta `canTransition(from, to, actor): boolean` + `assertTransition(...)` que lanza `TransitionError` con `code`. Tabla estática de transiciones legales + roles permitidos. Sin IO, sin Prisma. | 100% unit-testeable; contrato reutilizable por routes, worker del timer y futuras quotes. | Requiere disciplina para que **todas** las mutaciones de `status` pasen por el módulo. |
| B. Lógica inline en el handler PATCH | `if (service.status === 'PENDING' && req.body.status === 'CANCELLED') ...` | Menos archivos. | Lógica duplicada entre PATCH y el worker del timer; no testable sin Express. |
| C. Hook de Prisma (`@prisma/client` middleware) | Intercepta `service.update` y valida. | Centralizado a nivel de DB. | Prisma 5 deprecó `_prismaClientMiddleware; frágil; mezcla validación de dominio con persistencia. |

**Recomendación: Opción A.** Tabla de transiciones:

```
PENDING  → QUOTED     : sistema (callback markQuoted, invocado por cambio-005 quote-create)
PENDING  → CANCELLED  : CLIENT (PATCH manual) | sistema (timer expira)
QUOTED   → ACTIVE     : CLIENT (cambio-005 accept-quote) | sistema (callback markActive)
QUOTED   → CANCELLED  : CLIENT (cambio-005, antes de aceptar)
ACTIVE   → COMPLETED  : OPERATOR (PATCH)
ACTIVE   → CANCELLED  : (no permitido en demo — un servicio activo no se cancela; defer a MVP)
```

El worker del timer y el handler `PATCH /status` llaman ambos a `assertTransition`. Cambio-004 solo **ejercita** en runtime `PENDING → CANCELLED` y `ACTIVE → COMPLETED`; el resto se define y se unit-testea pero queda disparado por cambio-005.

### 5. Guards auth/rol

| Endpoint | Auth | Rol | Regla de dominio |
| --- | --- | --- | --- |
| `POST /services` | `requireAuth` | `requireRole(CLIENT)` | Debe tener `ClientProfile` (si no existe, se crea on-demand o se rechaza 403 `NO_PROFILE`). `clientProfileId` se deriva de `req.user.id`. |
| `GET /services/nearby` | `requireAuth` | `requireRole(OPERATOR)` | Requiere `OperatorProfile` + `available=true`. `lat`/`lng` vienen del query (o de `lastLatitude/lastLongitude` si no se pasan). |
| `GET /services/:id` | `requireAuth` | cualquier rol | Cliente dueño (`service.clientProfile.userId === req.user.id`) **o** operador disponible (`OperatorProfile.available=true`) ven el detalle; sino 403. |
| `PATCH /services/:id/status` | `requireAuth` | según transición (`assertTransition` valida rol) | Carga el `Service`, valida `canTransition(current, target, role)`, persiste. |

### 6. Validación Zod — reutilizar vs ampliar

`shared/src/schemas/service.schema.ts` solo tiene los enums. **Recomendación: ampliarlo** con `createServiceSchema`, `nearbyServicesQuerySchema`, `updateServiceStatusSchema` (pensar si `status` aceota solo los targets alcanzables aquí: `CANCELLED`, `COMPLETED`). Validación en el router vía un **nuevo `validate(schema, source)` middleware** (`backend/src/middleware/validate.ts`) que parsea y compara `req[source]`, devolviendo 400 `{ error, code: 'VALIDATION_ERROR', issues }` si falla. Reutilizable para cambio-005 y siguientes. Cumple spec §2 "Zod — schemas compartibles con frontend".

### 7. FCM / push al cliente en CANCELLED

| Opción | Descripción | Effort |
| --- | --- | --- |
| **A. Defer FCM (log-only)** | En el job que expira, tras `assertTransition PENDING→CANCELLED` se loggea `notifyClient(service.client.userId, 'REQUEST_EXPIRED')`. Se deja un módulo stub `lib/notifications.ts` con interfaz `notifyClient(userId, event)` que por ahora solo loggea. | Bajo |
| B. Instalar `firebase-admin` ahora | Implementar FCM real. | Alto; añade vars `FCM_*`, credentials, tests con mocking. Sale del alcance demo. |

**Recomendación: Opción A.** Notificaciones push son MVP, no Fase Demo. El stub con interfaz clara permite enchufar FCM en un cambio futuro sin tocar el worker.

## Recommendation

**Scope del cambio-004:**

1. **`serviceMachine.ts`** (puro, unit-testeado) con la tabla de transiciones + `canTransition`/`assertTransition` (rol + estados). Define el contrato completo del ciclo pero en runtime solo se ejercitan `PENDING→CANCELLED` y `ACTIVE→COMPLETED`.
2. **`validate` middleware** Zod genérico (`src/middleware/validate.ts`).
3. **Ampliar `shared/src/schemas/service.schema.ts`** con `createServiceSchema`, `nearbyServicesQuerySchema`, `updateServiceStatusSchema` (+ re-export y tipos `z.infer` en `types/service.ts`).
4. **`services.routes.ts`** con cuatro endpoints (`POST /services`, `GET /services/nearby`, `GET /services/:id`, `PATCH /services/:id/status`) bajo `requireAuth` + `requireRole` + `validate`. Montado en `routes/index.ts`.
5. **BullMQ + Redis**: añadir `redis:7-alpine` a `docker-compose.dev.yml`, instalar `bullmq`/`ioredis`, `lib/queue.ts` (singleton `Queue` + factory de `Worker`), `jobs/serviceExpiry.job.ts` (worker que llama a `expirePendingService(serviceId)` = load + `assertTransition(PENDING,CANCELLED,'system')` + persist). `enqueue` en `POST /services` con `delay = SERVICE_TIMEOUT_MINUTES * 60_000`.
6. **`lib/notifications.ts`** stub con `notifyClient(userId, event)` (log). Intefaz futura para FCM.
7. **`env.ts`**: `REDIS_URL` (requerido en dev/prod, opcional en test), `SERVICE_TIMEOUT_MINUTES` (default 15). Mantener fuera `FCM_*`.
8. **`/nearby`**: Opción B (raw SQL `ST_DWithin` tras `CREATE EXTENSION postgis;` en migración nueva). Si en design surge riesgo, fallback documentado a Opción C (haversine en JS).
9. **TDD**: unit para `serviceMachine`, `validate`, `notifications`, `lib/queue` (mock `ioredis`/BullMQ). Routes tests con `supertest` mockeando prisma + auth (`req.user` inyectado). db smoke en `__tests__/db/services.lifecycle.test.ts`: flujo `POST → GET → PATCH(CANCELLED)` con cookie jar real (Better Auth); flujo timer con `expirePendingService` invocada directamente (sin esperar 15 min) y, opcional, BullMQ + Redis real.

### Interfaz con cambio-005 (quotes)

- `serviceMachine` expone `markQuoted(serviceId)` y `markActive(serviceId, acceptedQuoteId)` como callbacks internos (no como endpoints). Cambio-005 los invoca desde `POST /services/:id/quotes` (al insertar la primera quote) y `POST /quotes/:id/accept` respectivamente.
- `acceptedQuoteId` **no se setea** en cambio-004 (queda `null`); el campo ya existe en el schema.
- En cambio-004, `GET /services/:id` puede devolver `quotes: []` (vacío) — la relación `ServiceQuotes` ya está definida.

## Risks

- **Redis en CI/local**: añadir un servicio más a levantar. Mitigación: `db:up` extendido a `up -d postgres redis`; doc en README; tests unit del timer no dependen de Redis (mockean el enqueue).
- **PostGIS `CREATE EXTENSION`**: la extensión existe en la imagen pero debe habilitarse por DB. Mitigación: migración `*_init_postgis` idempotente; validarlo en db smoke (`SELECT extname FROM pg_extension`).
- **BullMQ en test**: BullMQ usa timers de Redis; durations reales son lentas. Mitigación: el handler `expirePendingService` se aísla como función pura; el test llama directo sin pasar por la `Queue`. El `enqueue` se valida con spy en `queue.add`.
- **Sesiones Better Auth cookies en supertest**: ya resuelto en cambio-003 (cookie jar). Reutilizar el helper.
- **`QUOTED`/`ACTIVE` inalcanzables en runtime hasta cambio-005**: puede confundir en smoke. Mitigación: el `serviceMachine` define y unit-testea todas las transiciones; comentario explícito en routes de que las ramas quotes se activan en cambio-005.
- **`previewFeatures postgis`** tentador pero arriesgado: NO usarlo en este cambio (rompería el schema Float de cambio-002). La Opción B raw SQL evita tocar el modelo.
- **FCM out-of-scope**: la "push al cliente" de §7.2 queda como log stub. Documentar como desviación intencional de Fase Demo.
- **Service sin `ClientProfile`**: el usuario `CLIENT` recién verificado (cambio-003) puede no tener perfil. Decidir en design: crear on-demand en `POST /services` o requerir perfil previo. Recomendación: crear on-demand (1:1 con User) para optimizar el onboarding.

## Ready for Proposal

**Yes.** Stack, límite con cambio-005 y enfoques de timer/PostGIS/state-machine claros. Próximo: etapa `propose`.