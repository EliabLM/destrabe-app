# Tasks — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Tasks
**Basado en:** `docs/designs/cambio-002-data-model/design.md`
**Branch:** `feature/cambio-002-data-model`

> Tareas ordenadas para `apply`. TDD: test primero donde aplique. Las tareas T3/T4/T6 requieren Docker + Postgres up; T1/T2/T5 no.

---

## T1 — shared: enums (UserRole, ServiceType, PaymentStatus) _(TDD)_

**Test primero:** `shared/__tests__/enums.schema.test.ts`

- cada enum parsea válido (REQ-001)
- cada enum rechaza inválido con ZodError (REQ-001)
- `no-prisma-import.test.ts`: shared no importa `@prisma/client` ni `prisma` (REQ-008)

**Luego impl:**

- `shared/src/types/user.ts` → `enum UserRole`
- `shared/src/types/service.ts` → ampliar con `enum ServiceType` (junto a `ServiceStatus`)
- `shared/src/types/payment.ts` → `enum PaymentStatus`
- `shared/src/schemas/user.schema.ts`, `service.schema.ts` (ampliar), `payment.schema.ts` → `z.nativeEnum`
- Barrels `types/index.ts`, `schemas/index.ts` actualizados.

**Acción:** `npm run build -w @destrabe/shared`.

**Acepta (REQ-001, REQ-008):** unit tests green; dist regenerada.

---

## T2 — Prisma schema (modelos + enums) _(no TDD — es schema)_

**Crea/actualiza:** `backend/prisma/schema.prisma` con 4 enums + 7 modelos (ClientProfile, OperatorProfile, Service, Quote, Payment, Message, Review). `userId` como String sin FK + comentario. `onDelete: Cascade` en FKs a Service/OperatorProfile.

**Acción:** `npx prisma validate --schema=backend/prisma/schema.prisma` y `npx prisma format --schema=backend/prisma/schema.prisma`.

**Acepta (REQ-002, REQ-003):** `prisma validate` exit 0.

---

## T3 — docker-compose dev + env _(requiere Docker para probar)_

**Crea:** `infra/docker-compose.dev.yml` (postgis/postgis:16-3.4-alpine, DB destrabe_db).
**Actualiza:** `backend/.env.example` (POSTGRES_DB/USER/PASSWORD + DATABASE_URL dev).
**Scripts root:** `db:up`, `db:down`, `db:migrate`, `test:db`, `test:all`.

**Acción:** `npm run db:up` → levanta Postgres.

**Acepta (REQ-005):** `docker compose` responde; contenedor en :5432.

---

## T4 — Migración init _(requiere Postgres up)_

**Acción:** `DATABASE_URL=... npx prisma migrate dev --name init --schema=backend/prisma/schema.prisma` → genera `backend/prisma/migrations/<ts>_init/` y aplica. `npx prisma generate`.

**Acepta (REQ-004):** migración versionada creada; `prisma migrate deploy` funciona; `@prisma/client` regenerado con modelos.

---

## T5 — Separación de suites de test _(no Docker)_

**Actualiza:** `vitest.config.ts` (excluir `backend/__tests__/db/**`).
**Crea:** `vitest.db.config.ts` (include solo `backend/__tests__/db/**/*.test.ts`).
**Scripts root:** `test` (unit), `test:db` (db), `test:all`.

**Acepta:** `npm test` corre unit sin tocar DB; `npm run test:db` corre db suite (vacía por ahora, 0 tests OK).

---

## T6 — DB smoke tests _(TDD adaptado, requiere Postgres up + migración)_

**Crea:**

- `backend/__tests__/db/helpers.ts` → `prisma` + `resetDb()` (TRUNCATE 7 tablas CASCADE).
- `backend/__tests__/db/relations.test.ts` → creación encadenada clientProfile→service→quote→payment→message→review (REQ-003, REQ-006).
- `backend/__tests__/db/cascade.test.ts` → borrar Service → borra dependientes (REQ-006).
- `backend/__tests__/db/enum-constraint.test.ts` → insertar ServiceStatus inválido falla (REQ-007).

**Acción:** `npm run db:up && npm run test:db`.

**Acepta (REQ-006, REQ-007):** db tests green.

---

## T7 — Docs _(documentación)_

- `README.md`: sección de setup con `npm run db:up`, `npm run db:migrate`, `npm test` vs `npm run test:db`.
- `docs/testing/estrategia.md`: añadir suites `unit` (sin DB) y `db` (con Postgres), helper `resetDb`.

**Acepta:** docs coherentes.

---

## Orden de ejecución (apply)

`T1 → T2 → T5 → T3 → T4 → T6 → T7`

(T1, T2, T5 no requieren Docker; T3, T4, T6 sí. Se agrupan las dependientes de Docker al final para poder avanzar sin Postgres hasta donde sea posible.)

## Commit strategy

Conventional, un commit por tarea: `feat(shared): add domain enums`, `feat(backend): add prisma data model schema`, `chore(infra): add dev postgres compose`, `feat(backend): add init migration`, `chore(test): split unit/db suites`, `test(backend): add db smoke tests`, `docs: ...`.

## Next

Etapa `apply`: ejecutar T1→T7 con TDD, luego `verify`.
