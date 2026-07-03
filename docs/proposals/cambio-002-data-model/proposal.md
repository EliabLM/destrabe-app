# Change Proposal — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Propose
**Estado:** Aprobado para spec
**Branch:** `feature/cambio-002-data-model`
**Basado en:** `docs/proposals/cambio-002-data-model/exploration.md`

## Intent

Materializar el modelo de datos del dominio de destrabe en `backend/prisma/schema.prisma`, generar la primera migración `init`, y reflejar los enums compartidos en `@destrabe/shared` para que backend y (futuro) mobile compartan contratos. Al terminar: el schema Prisma define el dominio de negocio, la migración `init` está versionada, y un Postgres de dev (docker-compose) permite correr tests de humo relacionales.

## Context

La spec §6 define el modelo completo (9 modelos + 4 enums). El `cambio-001-foundation` dejó `schema.prisma` con solo `datasource`+`generator`. Este cambio pobla el schema con el dominio de negocio. **Decisión clave (override de la spec):** `User` y `Session` se defieren al `cambio-003` (Better Auth), porque Better Auth gestiona identidad/sesiones en el mismo Postgres (ADR-003). Definirlos ahora y sobrescribirlos después es retrabajo.

## Scope

### In scope

- **`backend/prisma/schema.prisma`**: 4 enums (`UserRole`, `ServiceType`, `ServiceStatus`, `PaymentStatus`) + 7 modelos de dominio (`ClientProfile`, `OperatorProfile`, `Service`, `Quote`, `Payment`, `Message`, `Review`) con relaciones fieles a la spec §6.
  - **Nota:** los modelos de la spec que referencian `User` (ClientProfile.userId, OperatorProfile.userId, Message.senderId) se modelan con `String` + `@unique`/index, **sin FK a User** (User se añade en cambio-003). Se deja un comentario `// FK a User (cambio-003)`.
- **Primera migración**: `prisma migrate dev --name init` → `backend/prisma/migrations/`.
- **`@destrabe/shared`**: reflejar los 4 enums (types + Zod schemas). `ServiceStatus` ya existe — ampliar con `UserRole`, `ServiceType`, `PaymentStatus`. Barrels actualizados.
- **`infra/docker-compose.dev.yml`**: servicio `postgres:16-alpine` (+ extensión postgis) con volumen y vars de `.env`. Solo dev, NO prod.
- **`backend/.env.example`**: añadir `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`; aclarar `DATABASE_URL` apuntando al compose.
- **Tests TDD**:
  - Unit (sin DB): schemas Zod de los 4 enums (parse válido / rechazo inválido) en `shared/__tests__/`.
  - DB smoke (con Postgres up): crear registros encadenados (clientProfile → service → quote → payment → message → review), verificar relaciones y cascade de deletes. En `backend/__tests__/db/`, marcados como suite `test:db`.

### Out of scope (cambios posteriores)

- `User` y `Session` → `cambio-003` (Better Auth).
- PostGIS real / geo-queries → cambio de `/services/nearby`.
- Seed de datos → cambio de auth o dedicado.
- Docker compose prod, Caddyfile, CI/CD → cambio de infra.
- Endpoints REST que consuman el modelo → cambios de features.

## Approach

1. **Enums primero en `shared`** (types + Zod), tests unit TDD (red → green).
2. **Schema Prisma** con enums + 7 modelos (sin User/Session; FKs a User como `String` con comentario).
3. **docker-compose dev** con Postgres; `docker compose up -d postgres`.
4. **`prisma migrate dev --name init`** (genera migración + aplica).
5. **Smoke tests DB** (TDD): creación encadenada + cascade; suite `test:db` separada (requiere PG up).
6. **`prisma generate`** para que `@prisma/client` exponga los modelos tipados.

## Risks & mitigations

- **`User`/`Session` ausentes**: los perfiles referencian userId como String sin FK. Mitigación: comentario `// FK a User (cambio-003)`; el cambio-003 añade User + las FKs reales + migración.
- **Tests DB requieren Postgres up**: suite `test:db` separada; documentar `docker compose up -d postgres` antes. Unit tests (shared schemas) no requieren DB.
- **PostGIS preview**: usar `Float` para lat/lng ahora (como spec); defer PostGIS a /nearby.
- **DATABASE_URL en CI**: los tests DB no corren en CI sin Postgres; marcar para skip si `DATABASE_URL` no alcanza. Se refinó en `verify`.

## Dependencies / prerequisites

- `cambio-001-foundation` mergeado (✅ en develop).
- Docker disponible para levantar Postgres de dev.
- `DATABASE_URL` configurado a `postgresql://destrabe:destrabe@localhost:5432/destrabe_db`.

## Next

Etapa `spec`: requisitos (funcionales + no funcionales) + escenarios Gherkin por modelo. Luego `design`.
