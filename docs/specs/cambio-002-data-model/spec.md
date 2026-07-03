# Spec — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Spec
**Basado en:** `docs/proposals/cambio-002-data-model/proposal.md`
**Branch:** `feature/cambio-002-data-model`

> Requisitos testeables. Los unit tests (schemas Zod) no requieren DB. Los `db` tests requieren Postgres up vía `docker compose up -d postgres`.

---

## REQ-001: Enums compartidos en @destrabe/shared

`shared` exporta los 4 enums del dominio (types TS + schemas Zod): `UserRole`, `ServiceType`, `ServiceStatus` (ya existe), `PaymentStatus`.

```gherkin
Scenario: cada enum parsea sus valores válidos
  Given los schemas userRoleSchema, serviceTypeSchema, serviceStatusSchema, paymentStatusSchema
  When se parsea un valor válido de cada uno
  Then el resultado es ese valor

Scenario: cada enum rechaza valores inválidos con ZodError
  When se parsea 'NOT_A_ROLE' con userRoleSchema
  Then se lanza ZodError
  # análogo para los demás enums
```

## REQ-002: Schema Prisma con enums y modelos de dominio

`backend/prisma/schema.prisma` define 4 enums y 7 modelos (`ClientProfile`, `OperatorProfile`, `Service`, `Quote`, `Payment`, `Message`, `Review`) con relaciones fieles a la spec §6. `User` y `Session` NO se definen (defer a cambio-003).

```gherkin
Scenario: el schema parsea sin errores
  When se ejecuta `npx prisma validate --schema=backend/prisma/schema.prisma`
  Then el comando termina exit code 0

Scenario: los perfiles referencian userId sin FK (User defer)
  Given ClientProfile.userId y OperatorProfile.userId son String @unique
  Then NO existe relation a User
  And existe el comentario '// FK a User (cambio-003)'
```

## REQ-003: Relaciones del dominio correctas

```gherkin
Scenario: Service tiene un ClientProfile y muchas Quotes
  Given el modelo Service
  Then tiene clientProfileId → ClientProfile (relación)
  And quotes Quote[] (relación "ServiceQuotes")
  And acceptedQuote Quote? (relación "AcceptedQuote", @unique)

Scenario: Quote pertenece a Service y OperatorProfile
  Given el modelo Quote
  Then tiene serviceId → Service y operatorProfileId → OperatorProfile

Scenario: Payment es 1:1 con Service
  Given Payment
  Then serviceId es @unique → Service

Scenario: Message y Review pertenecen a Service
  Given Message y Review
  Then ambos tienen serviceId → Service
  And Review tiene operatorProfileId → OperatorProfile y rating Int 1..5
```

## REQ-004: Migración init versionada

```gherkin
Scenario: existe la migración init
  Given `backend/prisma/migrations/<timestamp>_init/`
  When se aplica `prisma migrate deploy`
  Then todas las tablas y enums se crean en la DB
  And el comando termina exit code 0
```

## REQ-005: docker-compose dev con Postgres

`infra/docker-compose.dev.yml` define un servicio `postgres:16-alpine` (con extensión postgis) para dev/test.

```gherkin
Scenario: levanta Postgres de dev
  When se ejecuta `docker compose -f infra/docker-compose.dev.yml up -d postgres`
  Then el contenedor escucha en localhost:5432
  And la DB `destrabe_db` existe
```

## REQ-006 (db smoke): creación encadenada de registros

Con Postgres up y la migración aplicada, prisma puede crear registros en todas las tablas con sus relaciones.

```gherkin
Scenario: crear clientProfile → service → quote → payment → message → review
  Given la DB migrada
  When se crea un ClientProfile, un Service asociado, una Quote, un Payment, un Message y un Review
  Then todos se persisten con sus relaciones correctas
  And los IDs son cuid strings

Scenario: cascade delete al borrar un Service
  Given un Service con Quotes, Messages, Payment y Review
  When se borra el Service
  Then sus Quotes, Messages, Payment y Review se borran en cascade
```

## REQ-007: enums invalidados por la DB

```gherkin
Scenario: insertar un ServiceStatus inválido falla
  Given la DB migrada
  When se intenta crear un Service con status 'INVALID'
  Then la DB rechaza la inserción (violación de enum)
```

## REQ-008 (non-functional): shared agnóstico de prisma

```gherkin
Scenario: shared no importa @prisma/client
  Given el paquete @destrabe/shared
  Then ninguna de sus fuentes importa '@prisma/client' o 'prisma'
  And los enums se definen manualmente (no derivados de prisma)
```

---

## Cobertura de tests (mapeo requisito → test)

| Requisito | Test                                                      |
| --------- | --------------------------------------------------------- |
| REQ-001   | `shared/__tests__/enums.schema.test.ts` (unit, sin DB)    |
| REQ-002   | `npx prisma validate` (manual/CI)                         |
| REQ-003   | `backend/__tests__/db/relations.test.ts` (db smoke)       |
| REQ-004   | `prisma migrate deploy` (manual/CI)                       |
| REQ-005   | `docker compose up -d postgres` + ping (manual)           |
| REQ-006   | `backend/__tests__/db/cascade.test.ts` (db smoke)         |
| REQ-007   | `backend/__tests__/db/enum-constraint.test.ts` (db smoke) |
| REQ-008   | `shared/__tests__/no-prisma-import.test.ts` (unit)        |

## Next

Etapa `design`: schema Prisma concreto, docker-compose.dev.yml, scripts npm (test:db), y configuración de suites separadas.
