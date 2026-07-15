# Exploration — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Explore
**Branch:** `feature/cambio-002-data-model`
**Basado en:** spec técnica §6 (modelo de datos)

## Current State

`cambio-001-foundation` mergeado en `develop` (b48ccdc). El `backend/prisma/schema.prisma` tiene solo `generator client` + `datasource db` (sin modelos). El prisma client placeholder existe en `backend/src/lib/prisma.ts`. No hay migraciones ni DB. La spec §6 define el modelo completo (User, ClientProfile, OperatorProfile, Service, Quote, Payment, Message, Review, Session + enums) que este cambio debe materializar.

## Affected Areas

- `backend/prisma/schema.prisma` — agregar enums y modelos.
- `backend/prisma/migrations/` — nueva carpeta, primera migración.
- `shared/src/types/` — reflejar enums de DB (UserRole, ServiceType, ServiceStatus, PaymentStatus) en `@destrabe/shared`.
- `shared/src/schemas/` — schemas Zod para cada enum + DTOs básicos.
- `backend/src/lib/prisma.ts` — ya existe, sin cambios.
- `backend/.env.example` — `DATABASE_URL` ya listado; este cambio requiere Postgres real para probar.

## Approaches

| Decisión                    | Opción A                                                                            | Opción B                                          | Recomendación                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testing DB                  | Postgres real local (docker-compose)                                                | /testcontainers                                   | **docker-compose dev** con pg + postgis (spec usa pg 16). Registro en compose pero NO incluye prod compose (eso es cambio de infra).                                                                     |
| PostGIS                     | Habilitar extension desde el inicio (spec §6 usa geo-queries para /services/nearby) | Postergar                                         | **Habilitar `postgis` ahora** — futuro /nearby la necesita; añadir `extensions: [postgis]` al datasource                                                                                                 |
| Migraciones                 | `prisma migrate dev --name init` genera SQL histórico                               | `prisma db push` (sincronización sin migraciones) | **migrate dev** — persiste migración versionada para prod (CI deploy usa `prisma migrate deploy`)                                                                                                        |
| Enums compartidos           | Duplicar enums en `shared/types`                                                    | Derivar `shared` desde Prisma client              | **Duplicar** los enum values manualmente en `shared` (es lo que consume el frontend sin depender de prisma). Mantiene shared agnóstico de prisma.                                                        |
| Seed                        | Incluir seed inicial para tests/desarrollo (usuario demo)                           | Postergar seed                                    | **Postergar** — el seed pertenece al cambio de auth (registro) o un cambio dedicado.                                                                                                                     |
| Validación de schema en TDD | Test de capacidad de DB (smoke: prisma puede crear registros)                       | Solo test de tipos (lint)                         | **Smoke test con DB real** vía vitest — crea registros, verifica relaciones, limpia. Estos tests requieren Postgres up (>52). Alternativa: test de schema Prisma parse (sin DB, solo `prisma validate`). |

## Recommendation

**Scope del cambio-002:** materializar el modelo de datos completo de la spec §6 en `backend/prisma/schema.prisma` (enums + 9 modelos) + reflejar 4 enums en `@destrabe/shared` (types + Zod schemas) + primera migración `init` + tests de humo de DB con Postgres real vía docker-compose.

### Decisiones concretas

1. **Schema Prisma completo** con los 4 enums (`UserRole`, `ServiceType`, `ServiceStatus`, `PaymentStatus`) y 9 modelos (`User`, `ClientProfile`, `OperatorProfile`, `Service`, `Quote`, `Payment`, `Message`, `Review`, `Session`). Reproducir fielmente las relaciones de la spec §6. Mantener `@id @default(cuid())` para IDs.
2. **PostGIS**: añadir `previewFeatures = ["postgis"]` y `extensions = [postgis]` en datasource (si la versión de prisma lo soporta). Si no está disponible, usar `Float` para `lastLatitude`/`lastLongitude` (como en la spec original) y defer PostGIS a cambio-004/servicios. **Decisión:oganizar como `Float** ahora (la spec ya los usa así), evaluar PostGIS en/tools/nearby.
3. **Migración `init`** vía `prisma migrate dev --name init` (requiere Postgres up).
4. **docker-compose dev** en `infra/docker-compose.dev.yml` con `postgres:16-alpine` (+ postgis). NO es el prod compose. Solo para dev/test local.
5. **@destrabe/shared** refleja 4 enums (`UserRole`, `ServiceType`, `ServiceStatus` ya existe — ampliar, `PaymentStatus`) + sus Zod schemas en `shared/src/schemas/`. Mantiene `ServiceStatus` existente.
6. **Tests TDD**: smoke tests con DB real — crear user → cliente → service → quote → verificar relaciones y cascade; validar enums inválidos rechazados por DB. Cobertura de prisma no aplica (librería externa); los tests validan el schema relacional.
7. **Env**: añadir `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` al `.env.example` e integrar `DATABASE_URL` completa para dev (apunta al compose).

## Risks

- **Postgres/PostGIS disponibilidad**: prisma `postgis` extension es preview. Mitigación: usar `Float` para lat/lng (como spec), defer PostGIS a cambio/nearby.
- **Tests requieren DB up**: la suite falla si Postgres no corre. Mitigación: (a) `docker compose up -d postgres` antes de `npm test` (documentar), o (b) marcar tests DB como `test:e2e` separados. → Recomo (a) pero separar `unit` (schemas shared, sin DB) de `db` (smoke relacional, requiere PG).
- **Mezclar data model con auth**: Better Auth añade sus propias tablas/session. La spec ya define `Session` y `User` que Better Auth gestiona. Riesgo: el `init` migrado ahora podría chocar con las tablas que Better Auth genera luego. Mitigación: consultar docs de Better Auth en design sobre qué tablas gestiona él; peuede que necesitemos NO definir `User`/`Session` en el schema y dejar que Better Auth los webs. → **Defer `User`+`Session` a cambio-003 (auth)** — este cambio solo define perfiles + entidades de dominio (ClientProfile, OperatorProfile, Service, Quote, Payment, Message, Review). `User` se añadará en auth.

## Ready for Proposal

**Yes** — con un ajuste: **defer `User` y `Session` al cambio-003 (Better Auth)**. Toast la spec los lista, Better Auth los gestiona (según ADR-003, Better Auth usa el mismo Postgres). Definirlos en data-model ahora y sobrescribirlos en auth es retrabajo. El cambio-002 cubre el dominio de negocio; el cambio-003 añade la identidad/auth encima. El próximo paso es `propose`.
