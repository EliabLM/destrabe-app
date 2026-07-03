# Verify — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Verify
**Branch:** `feature/cambio-002-data-model`
**Fecha:** Julio 2026

## Gate de verificación

| Check             | Comando                          | Resultado                                   |
| ----------------- | -------------------------------- | ------------------------------------------- |
| Build (typecheck) | `npm run build`                  | PASS (shared `tsc`, backend `tsc --noEmit`) |
| Lint              | `npm run lint`                   | PASS (0 errores)                            |
| Format            | `npm run format:check`           | PASS                                        |
| Unit tests        | `npm test`                       | PASS (18/18)                                |
| DB tests          | `npm run test:db`                | PASS (6/6) (requiere `db:up`)               |
| Prisma validate   | `npx prisma validate`            | PASS (schema válido)                        |
| Migración         | `prisma migrate dev --name init` | PASS (migración versionada)                 |

## Mapeo requisito → evidencia

| REQ     | Descripción                 | Estado | Evidencia                                                     |
| ------- | --------------------------- | ------ | ------------------------------------------------------------- |
| REQ-001 | Enums compartidos en shared | PASS   | `enums.schema.test.ts` (6 tests)                              |
| REQ-002 | Schema Prisma válido        | PASS   | `prisma validate` exit 0                                      |
| REQ-003 | Relaciones del dominio      | PASS   | `relations.test.ts` (creación encadenada + acceptedQuote 1:1) |
| REQ-004 | Migración init versionada   | PASS   | `prisma/migrations/20260703041037_init/migration.sql`         |
| REQ-005 | docker-compose dev Postgres | PASS   | `infra/docker-compose.dev.yml` levanta en :5432               |
| REQ-006 | Cascade delete              | PASS   | `cascade.test.ts` (Service y OperatorProfile)                 |
| REQ-007 | Enums inválidos rechazados  | PASS   | `enum-constraint.test.ts` (cliente + DB vía raw SQL)          |
| REQ-008 | shared agnóstico de prisma  | PASS   | `no-prisma-import.test.ts`                                    |

## Tareas (T1–T7)

Todas completadas y commiteadas. TDD estricto en T1 (enums). T6 (db tests) usó TDD adaptado (schema+migración primero, tests después — prisma requiere schema materializado).

## Desviaciones del design (pragmáticas)

- **Suite db con `fileParallelism: false`**: vitest corría archivos en paralelo y el `resetDb` causó deadlock en la DB compartida de dev. Fix: un único `TRUNCATE` (en lugar de uno por tabla) + `fileParallelism: false` en `vitest.db.config.ts`.
- **Test de enum con `PrismaClientValidationError`**: prisma valida enums en el cliente (TS) antes de la DB — lanza `PrismaClientValidationError`, no `PrismaClientKnownRequestError`. El test matchea ambos. Se añadió un test extra con raw SQL para validar la restricción DB-side (`enum-constraint.test.ts`).
- **Rating `Int` sin CHECK 1..5 en DB**: confirmado en design (validación en Zod/app). Eliminé el test que esperaba rechazo de `rating: 0` (no es un constraint de DB, es de app layer).

## Veredicto

**APROBADO.** El cambio-002-data-model cumple spec, design y tasks. Listo para `archive`.

## Notas

- Tests DB requieren Postgres up: `npm run db:up` antes de `npm run test:db`.
- `backend/.env` (gitignored) creado para dev con `DATABASE_URL`.
- `User` y `Session` diferidos a cambio-003 (Better Auth) — los perfiles referencian `userId` como String sin FK.
