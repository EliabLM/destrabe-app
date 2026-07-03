# Design — Cambio-004: Servicios (ciclo de vida + timer)

**Change ID:** `cambio-004-servicios`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-004-servicios/spec.md`
**Branch:** `develop` (HEAD 6a746b3)

> Diseño técnico concreto: FSM pura, endpoints, timer BullMQ, geo-query PostGIS y helpers de test. La implementación (con código) ocurre en `apply` con TDD. No se toca el schema `Service` (cambio-002) ni los modelos de identidad (cambio-003).

## 1. Technical Approach

Máquina de estados **pura** sin IO (`serviceMachine.ts`) como contrato reutilizable por routes y worker. Cuatro endpoints bajo `requireAuth`+`requireRole` montados en `/services` sobre el router Express existente (shape de error `{error, code}`). Timer de expiración con **BullMQ + Redis** (delay exacto, idempotente); el handler `expirePendingService` se aísla como función pura para testear sin Redis ni duraciones reales. Geo-query `/nearby` con **PostGIS raw SQL** (`$queryRaw` + binds, `ST_DWithin`) tras `CREATE EXTENSION postgis` en migración nueva — sin `previewFeatures` (preserva el schema `Float` de cambio-002). `ClientProfile` se crea on-demand en `POST /services`. `notifyClient` es stub log-only (interfaz estable para FCM futuro). Validación con factory Zod genérico `validate(schema, source)`.

## 2. Architecture Decisions

### D1 — FSM: módulo puro + tabla estática

| Opción | Tradeoff | Decisión |
|---|---|---|
| Tabla estática `Record<from,Record<to,Role[]>>` + funcs puras | Requiere disciplina de uso en todas las mutaciones | ✅ Elegida |
| Clase con estado | Acoplamiento instancia, innecesario | ✗ |
| `switch` enum inline | Duplica lógica en routes+worker, no testeable sin Express | ✗ |

**Rationale:** 100% unit-testeable, reutilizable por routes + worker sin acoplarse a Prisma. Toda la tabla (incl. quotes) se cubre en unit; en runtime solo se ejercitan `PENDING→CANCELLED` y `ACTIVE→COMPLETED`.

### D2 — Timer BullMQ + Redis ahora

| Opción | Tradeoff | Decisión |
|---|---|---|
| BullMQ + `ioredis` (redis en compose) | Suma servicio infra; tests unit mockean enqueue | ✅ Elegida |
| Defer timer a cambio-005 | Deja flujo demo manco; `PENDING` cuelga | ✗ |
| `setTimeout` in-process | No sobrevive reinicios; impreciso bajo load | ✗ |
| `node-cron` | No delay exacto desde `expiresAt` | ✗ |

**Rationale:** El timer es core a §7.2 (no decorativo). BullMQ da delay jobs exactos e idempotentes; `expirePendingService` aislada evita depender de Redis/15 min en tests.

### D3 — Geo-query PostGIS raw SQL

| Opción | Tradeoff | Decisión |
|---|---|---|
| `$queryRaw` `ST_DWithin` + migración `CREATE EXTENSION` | Mapeo manual de columnas; Prisma no tipa el resultado | ✅ Elegida |
| `previewFeatures=["postgis"]` | Rompe schema `Float` → migración destructiva + reintegra tests cambio-002 | ✗ |
| Haversine en JS | O(n) en memoria, menos preciso a escala | ✗ (fallback doc) |

**Rationale:** Imagen `postgis` elegida en cambio-002 ex profeso para `/nearby`. Raw SQL con binds (no interpolación) es eficiente, preciso y no rompe el modelo.

### D4 — `ClientProfile` on-demand en `POST /services`

Upsert lazy (`prisma.clientProfile.upsert`) con `userId=req.user.id` vacío antes de crear el `Service`. Evita friction de un endpoint previo y no bloquea el flujo demo.

### D5 — `validate(schema, source)` factory Zod

Genérico reutilizable para cambio-005+; reutiliza `shared` schemas. Error → 400 `{error, code:'VALIDATION_ERROR', issues}`; éxito → `req.validated[source]=parsed` + `next()`.

### D6 — `notifyClient` stub log-only

`notifications.ts` loggea `{event, serviceId, userId}`. No instala `firebase-admin` (overkill MVP). Interfaz estable para enchufar FCM en un cambio futuro sin tocar el worker.

## 3. Data Flow

```
Cliente ─POST /services──▶ services.routes ─▶ validate ─▶ ClientProfile upsert
   │                                              │       └▶ prisma.service.create(PENDING, expiresAt)
   │                                              └▶ queue.enqueue(serviceExpiry, delay)
   │
Operador ─GET /nearby──▶ services.routes ─▶ prisma.$queryRaw(ST_DWithin) ─▶ 200 array
   │
Cliente/Operador ─PATCH /status──▶ load Service ─▶ assertTransition(from,to,role)
                                          │              └▶ 409 INVALID_TRANSITION
                                          └▶ persist ─▶ 200

Worker BullMQ (delay=15min) ─▶ expirePendingService(serviceId)
   └▶ if PENDING: assertTransition('system') + persist CANCELLED + notifyClient(log)
   └▶ else: no-op (idempotente)
```

## 4. File Changes

| File | Action | Descripción |
|------|--------|-------------|
| `backend/src/services/serviceMachine.ts` | Create | FSM pura: tabla de transiciones, `canTransition`/`assertTransition`, `ConflictError` |
| `backend/src/routes/services.routes.ts` | Create | 4 endpoints bajo `requireAuth`+`requireRole`+`validate` |
| `backend/src/middleware/validate.ts` | Create | factory Zod → 400 `VALIDATION_ERROR` |
| `backend/src/lib/queue.ts` | Create | singleton BullMQ `Queue` + factory `Worker` (lazy `ioredis`) |
| `backend/src/jobs/serviceExpiry.job.ts` | Create | `expirePendingService(serviceId)` pura + registro del worker |
| `backend/src/lib/notifications.ts` | Create | `notifyClient(service, event)` log-only |
| `backend/prisma/migrations/{ts}_init_postgis/migration.sql` | Create | `CREATE EXTENSION IF NOT EXISTS postgis;` |
| `backend/src/routes/index.ts` | Modify | montar `servicesRouter` en `/services` |
| `backend/src/lib/env.ts` | Modify | `REDIS_URL` (req dev/prod, opt test), `SERVICE_TIMEOUT_MINUTES`(15), `NEARBY_RADIUS_KM`(5) |
| `backend/.env`, `backend/.env.example` | Modify | nuevas vars |
| `backend/package.json` | Modify | deps `bullmq`, `ioredis` |
| `infra/docker-compose.dev.yml` | Modify | servicio `redis:7-alpine` + volumen `destrabe_redis_dev` + healthcheck |
| `shared/src/schemas/service.schema.ts` | Modify | `createServiceSchema`, `nearbyServicesQuerySchema`, `updateServiceStatusSchema` |
| `shared/src/types/service.ts` | Modify | tipos `z.infer` (`CreateServiceInput`, etc.) |
| `shared/src/{schemas,types}/index.ts` | Modify | barrels (ya hacen `export *` — solo nueva exports) |
| `backend/__tests__/db/helpers.ts` | Verify | `resetDb` ya incluye Service/Quote/Message/Payment/Review — solo confirmar |

## 5. Interfaces / Contracts

```ts
type Actor = UserRole | 'system';
canTransition(from: ServiceStatus, to: ServiceStatus, actor: Actor): boolean;
assertTransition(from, to, actor): void; // throws ConflictError
class ConflictError extends Error { status=409; code='INVALID_TRANSITION' as const; }

validate(schema: ZodSchema, source: 'body'|'query'|'params'): RequestHandler;
// req.validated[source] = parsed; 400 {error, code:'VALIDATION_ERROR', issues}

expirePendingService(serviceId: string): Promise<void>;   // pura, idempotente
enqueueServiceExpiry(serviceId: string, delayMs: number): Promise<void>;
notifyClient(service: {id:string; clientProfileId:string}, event: string): void;

// shared (Zod)
createServiceSchema        // {type, originLat, originLng, destLat?, destLng?, description?, photoUrl?}
nearbyServicesQuerySchema  // {lat, lng, radiusKm? default NEARBY_RADIUS_KM}
updateServiceStatusSchema  // {status: ServiceStatus}
```

## 6. Testing Strategy

| Layer | Qué | Cómo |
|-------|-----|------|
| Unit | `serviceMachine` (TODAS las transiciones legales + ilegales → ConflictError) | table-driven, sin mocks |
| Unit | `validate` (body ok/invalid; next/no-next) | Request/Response stub |
| Unit | `notifications` (loggea `{event,serviceId,userId}`) | spy `console.log` |
| Unit | `expirePendingService` (PENDING→CANCELLED; idempotente CANCELLED; calls notify) | mock prisma + notify |
| Unit | enqueue `queue.add` (name, delay, data.serviceId) | spy BullMQ Queue |
| DB smoke | lifecycle `POST → GET → PATCH(CANCELLED)` + 409 ilegal + 404 ajeno | supertest + cookie jar Better Auth (cambio-003) |
| DB smoke | `/nearby` PostGIS (PENDING 1km dentro, PENDING 10km fuera, COMPLETED 1km fuera) | `$queryRaw` real |
| DB smoke | `_init_postgis` idempotente (`pg_extension`) | `prisma.$queryRaw` |

**Notas:** No esperar 15 min — el timer se testea llamando `expirePendingService` directa. Reutilizar `seedUser`+`resetDb` (helpers ya cubren las tablas del dominio). `QUOTED`/`ACTIVE` inalcanzables en runtime → comentario explícito en routes; cubiertos en unit del machine.

## 7. Migration / Rollout

- Migración `*_init_postgis` vía `prisma migrate dev` (idempotente, `IF NOT EXISTS`).
- `db:up` ampliado: `up -d postgres redis`; documentar en README de apply.
- **Rollback:** revert commits → `prisma migrate resolve --rolled-back _init_postgis` → bajar redis del compose → desinstalar `bullmq`/`ioredis`. El schema `Service` no se toca.

## 8. Open Questions

- [ ] ¿`GET /services/:id` expone `quotes: []` al operador o solo campos públicos? (spec REQ-004: operador ve "público" — definir lista de campos en apply).
- [ ] ¿Worker del BullMQ corre en el proceso Express o en proceso separado? (definir en apply; `server.ts` arranca el worker en dev).

## Next

Etapa `tasks`: descomponer en tareas ordenadas para `apply` (shared schemas → env → FSM + validate → queue/notifs → routes → migración PostGIS → db smoke).