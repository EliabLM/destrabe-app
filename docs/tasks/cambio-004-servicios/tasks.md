# Tasks — Cambio-004: Servicios (ciclo de vida + timer)

**Change ID:** `cambio-004-servicios` · **Basado en:** `docs/designs/cambio-004-servicios/design.md` · **Branch:** `develop`

> TDD donde aplique. T1-T6/T10 no requieren Docker; T7-T9 requieren Postgres+PostGIS+Redis up.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600-900 (7 new + 8 modified + 5 test + migración) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (T1-T6 libs puros) → PR 2 (T7-T9 routes+migración+db smoke) → PR 3 (T10-T11 env tests+docs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-unique
400-line budget risk: High

> **Decisión del usuario:** Feature branch única (`feature/cambio-004-servicios`)
> con commits por grupo lógico (T1-T6, T7-T9, T10-T11), merge --no-ff a develop
> al archive. Mismo flujo que cambio-001/002/003.

---

## T1 — Shared schemas + tipos (Zod) _(no Docker)_

**Acción:** Ampliar `shared/src/schemas/service.schema.ts` (`createServiceSchema`, `nearbyServicesQuerySchema` lat/lng req radiusKm? default 5, `updateServiceStatusSchema`); `shared/src/types/service.ts` con `z.infer`; confirmar barrels; `npm run build -w @destrabe/shared`.

**Acepta (REQ-002/003/005 parcial):** build shared OK.

---

## T2 — Env + deps + infra compose _(no Docker)_

**Acción:** `npm install bullmq ioredis -w @destrabe/backend`; `backend/src/lib/env.ts` añade `REDIS_URL` (req dev/prod, opt test), `SERVICE_TIMEOUT_MINUTES`(15), `NEARBY_RADIUS_KM`(5); `.env`+`.env.example`; `infra/docker-compose.dev.yml` añade `redis:7-alpine`+volumen+healthcheck; confirmar `resetDb` cubre tablas del dominio.

**Acepta (REQ-008):** env valida; `up -d postgres redis` corre.

---

## T3 — serviceMachine pura (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/serviceMachine.test.ts` table-driven cubriendo TODAS las transiciones legales (true) + ilegales (`ConflictError` status=409 code='INVALID_TRANSITION') + rol no autorizado.

**Luego impl:** `backend/src/services/serviceMachine.ts` (tabla estática, `canTransition`/`assertTransition`, `class ConflictError`).

**Acepta (REQ-001):** tests unit green.

---

## T4 — validate middleware (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/validate.test.ts` — body válido → `req.validated.body`+`next()`; inválido → 400 `{error, code:'VALIDATION_ERROR', issues}`, `next` no llamado; query/params.

**Luego impl:** `backend/src/middleware/validate.ts`.

**Acepta (REQ-009):** tests unit green.

---

## T5 — notifications stub (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/notifications.test.ts` — spy `console.log` con estructura `{event, serviceId, userId}`.

**Luego impl:** `backend/src/lib/notifications.ts` (`notifyClient(service, event)` log-only).

**Acepta (REQ-007):** tests unit green.

---

## T6 — queue.ts + serviceExpiry.job (TDD) _(unit, no Docker)_

**Test primero:** `backend/__tests__/serviceExpiry.job.test.ts` con prisma mock — `expirePendingService`: PENDING→persist CANCELLED+`notifyClient`; no-PENDING→no-op idempotente; spy `queue.add('serviceExpiry', data, {delay})`.

**Luego impl:** `backend/src/lib/queue.ts` (singleton BullMQ `Queue`+factory `Worker` lazy `ioredis`) + `backend/src/jobs/serviceExpiry.job.ts` (`expirePendingService` pura+registro worker).

**Acepta (REQ-006):** tests unit green.

---

## T7 — services.routes (POST+GET+PATCH) _(requiere PG up)_

**Acción:** Impl `backend/src/routes/services.routes.ts` (4 endpoints con `requireAuth`+`requireRole`+`validate`+`serviceMachine`; ClientProfile upsert lazy en POST; comentario `QUOTED→ACTIVE` inalcanzable runtime); montar `servicesRouter` en `backend/src/routes/index.ts` bajo `/services`.

**Acepta (REQ-002/003/004/005 parcial):** boot OK; endpoints responden (401 sin auth).

---

## T8 — Migración _init_postgis + nearby raw SQL _(requiere PG up)_

**Acción:** `npx prisma migrate dev --name init_postgis` con `CREATE EXTENSION IF NOT EXISTS postgis;`; impl raw SQL `ST_DWithin` en `GET /services/nearby` con `$queryRaw`+binds (sin `previewFeatures`).

**Acepta (REQ-010, REQ-003):** migración aplicada; nearby devuelve PENDING en radio.

---

## T9 — Db smoke lifecycle (TDD) _(requiere PG+Redis up)_

**Test primero:** `backend/__tests__/db/services.lifecycle.test.ts` (supertest+cookie jar Better Auth): POST (PENDING+ClientProfile lazy+enqueue mock); GET (dueño completo/operador público/ajeno 404); PATCH (PENDING→CANCELLED dueño; 409 ilegal); GET /nearby PostGIS (PENDING 1km dentro, 10km fuera, COMPLETED 1km fuera); `_init_postgis` idempotente (`pg_extension`).

**Acepta (REQ-002/003/004/005/010):** tests db green.

---

## T10 — Ampliar tests env (TDD) _(unit, no Docker)_

**Test primero:** ampliar `backend/__tests__/env.test.ts` — `REDIS_URL` req dev/prod opt test (ausente en prod lanza error que menciona `REDIS_URL`); `SERVICE_TIMEOUT_MINUTES===15`, `NEARBY_RADIUS_KM===5` defaults.

**Acepta (REQ-008):** tests unit green.

---

## T11 — README + testing strategy docs _(sin test)_

**Acción:** `README.md` (sección servicios + `db:up` ampliado: `up -d postgres redis`); `docs/testing/estrategia.md` (suite db services lifecycle).

**Acepta:** docs coherentes.

---

## Orden de ejecución (apply)

`T1 → T2 → T3 → T4 → T5 → T6 → T10 → T7 → T8 → T9 → T11`

(No-Docker primero; Docker al final por capa.)

## Commit strategy

Conventional por grupo: `feat(shared): add service schemas`; `chore(backend): install bullmq ioredis and add env vars`; `feat(infra): add redis to dev compose`; `feat(backend): add serviceMachine FSM pure`; `feat(backend): add validate middleware`; `feat(backend): add notifyClient log stub`; `feat(backend): add serviceExpiry queue and worker`; `feat(backend): add services routes`; `feat(backend): add init_postgis migration and nearby sql`; `test(backend): add services lifecycle db smoke`; `test(backend): extend env tests`; `docs: add services readme and testing strategy`.

## Next

Etapa `apply`: ejecutar T1→T11 con TDD. **Orchestrator:** pedir decisión de chained PRs antes de apply.

---

## Progreso apply

- [x] T1 — Shared schemas + tipos (Zod)
- [x] T2 — Env + deps + infra compose
- [x] T3 — serviceMachine pura (TDD)
- [x] T4 — validate middleware (TDD)
- [x] T5 — notifications stub (TDD)
- [x] T6 — queue.ts + serviceExpiry.job (TDD)
- [ ] T7 — services.routes (POST+GET+PATCH)
- [ ] T8 — Migración _init_postgis + nearby raw SQL
- [ ] T9 — Db smoke lifecycle (TDD)
- [ ] T10 — Ampliar tests env (TDD)
- [ ] T11 — README + testing strategy docs