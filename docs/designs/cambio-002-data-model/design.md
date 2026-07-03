# Design — Cambio-002: Prisma Data Model

**Change ID:** `cambio-002-data-model`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-002-data-model/spec.md`
**Branch:** `feature/cambio-002-data-model`

> Diseño técnico concreto. La implementación (con código) ocurre en `apply` con TDD. Aquí se define el schema Prisma, el compose de dev, la separación de suites de test y los helpers.

## 1. `backend/prisma/schema.prisma` (concreto)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  CLIENT
  OPERATOR
  ADMIN
}

enum ServiceType {
  BREAKDOWN
  TRANSFER
}

enum ServiceStatus {
  PENDING
  QUOTED
  ACTIVE
  COMPLETED
  CANCELLED
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  REFUNDED
}

model ClientProfile {
  id        String    @id @default(cuid())
  userId    String    @unique // FK a User (cambio-003)
  services  Service[]

  @@index([userId])
}

model OperatorProfile {
  id            String    @id @default(cuid())
  userId        String    @unique // FK a User (cambio-003)
  truckType     String
  licensePlate  String
  photoUrl      String?
  available     Boolean   @default(false)
  rating        Float     @default(0)
  ratingCount   Int       @default(0)
  lastLatitude  Float?
  lastLongitude Float?
  lastSeenAt    DateTime?
  mpAccountId   String?

  quotes  Quote[]
  reviews Review[]

  @@index([userId])
}

model Service {
  id              String        @id @default(cuid())
  clientProfileId String
  client          ClientProfile @relation(fields: [clientProfileId], references: [id], onDelete: Cascade)

  type            ServiceType
  status          ServiceStatus @default(PENDING)
  description     String?
  photoUrl        String?

  originLat       Float
  originLng       Float
  originAddress   String?
  destLat         Float?
  destLng         Float?
  destAddress     String?

  acceptedQuoteId String?       @unique
  acceptedQuote   Quote?        @relation("AcceptedQuote")

  expiresAt       DateTime
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  quotes   Quote[]
  messages Message[]
  payment  Payment?
  review   Review?

  @@index([clientProfileId])
  @@index([status])
}

model Quote {
  id                String          @id @default(cuid())
  serviceId         String
  service           Service         @relation("ServiceQuotes", fields: [serviceId], references: [id], onDelete: Cascade)
  operatorProfileId String
  operator          OperatorProfile @relation(fields: [operatorProfileId], references: [id], onDelete: Cascade)

  amount            Float
  estimatedMinutes  Int?
  note              String?
  createdAt         DateTime        @default(now())

  acceptedForService Service?       @relation("AcceptedQuote")

  @@index([serviceId])
  @@index([operatorProfileId])
}

model Payment {
  id              String        @id @default(cuid())
  serviceId       String        @unique
  service         Service       @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  mpPaymentId     String?       @unique
  amount          Float
  commission      Float
  operatorAmount  Float
  status          PaymentStatus @default(PENDING)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model Message {
  id        String   @id @default(cuid())
  serviceId String
  service   Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  senderId  String // FK a User (cambio-003)
  content   String
  createdAt DateTime @default(now())

  @@index([serviceId])
}

model Review {
  id                String          @id @default(cuid())
  serviceId         String          @unique
  service           Service         @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  operatorProfileId String
  operator          OperatorProfile @relation(fields: [operatorProfileId], references: [id], onDelete: Cascade)

  rating            Int
  comment           String?
  createdAt         DateTime        @default(now())

  @@index([operatorProfileId])
}

// User y Session se definen en el cambio-003 (Better Auth).
```

**Notas de diseño:**

- `onDelete: Cascade` en todas las FKs hacia `Service` y `OperatorProfile`: borrar un Service borra sus Quotes/Messages/Payment/Review (REQ-006).
- `userId` (ClientProfile, OperatorProfile, Message.senderId) es `String` sin FK — `User` se añade en cambio-003. Comentario `// FK a User (cambio-003)`.
- Índices en FKs y en `Service.status` (futuro /nearby filtra por status).
- `rating Int` (1..5): la restricción de rango se valida en la app (Zod), no en DB. Se deja como `Int` simple.

## 2. `@destrabe/shared` — enums

- `src/types/user.ts`: `enum UserRole { CLIENT, OPERATOR, ADMIN }`.
- `src/types/service.ts`: ampliar con `enum ServiceType { BREAKDOWN, TRANSFER }` (junto al `ServiceStatus` existente).
- `src/types/payment.ts`: `enum PaymentStatus { PENDING, CONFIRMED, FAILED, REFUNDED }`.
- `src/schemas/user.schema.ts`: `userRoleSchema = z.nativeEnum(UserRole)`.
- `src/schemas/service.schema.ts`: ampliar con `serviceTypeSchema = z.nativeEnum(ServiceType)`.
- `src/schemas/payment.schema.ts`: `paymentStatusSchema = z.nativeEnum(PaymentStatus)`.
- Barrels (`types/index.ts`, `schemas/index.ts`) actualizados.

## 3. `infra/docker-compose.dev.yml`

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-destrabe_db}
      POSTGRES_USER: ${POSTGRES_USER:-destrabe}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-destrabe}
    ports:
      - '5432:5432'
    volumes:
      - destrabe_pg_dev:/var/lib/postgresql/data

volumes:
  destrabe_pg_dev:
```

Imagen `postgis/postgis` (Postgres 16 + PostGIS) para cuando se use en /nearby. DB de dev.

## 4. Separación de suites de test

- **`vitest.config.ts`** (default = unit): `include` shared + backend `__tests__`, **excluir** `backend/__tests__/db/**`. Coverage thresholds 80% sobre `src`. Sin DB.
- **`vitest.db.config.ts`** (db): `include` solo `backend/__tests__/db/**/*.test.ts`. Sin coverage threshold (tests de prisma, librería externa).
- **Scripts** (root `package.json`):
  - `test` → `vitest run` (unit, sin DB)
  - `test:db` → `vitest run --config vitest.db.config.ts` (requiere Postgres up)
  - `test:all` → `npm test && npm run test:db`
  - `db:up` → `docker compose -f infra/docker-compose.dev.yml up -d postgres`
  - `db:down` → `docker compose -f infra/docker-compose.dev.yml down`
  - `db:migrate` → `prisma migrate dev` (con `--schema=backend/prisma/schema.prisma` si hace falta)

## 5. Helper de tests DB

`backend/__tests__/db/helpers.ts`:

- `export const prisma = new PrismaClient()` (o reutilizar `src/lib/prisma.ts`).
- `beforeEach`: `TRUNCATE` de todas las tablas en orden (reseta estado entre tests). Implementación:
  ```ts
  const TABLES = [
    'Review',
    'Payment',
    'Message',
    'Quote',
    'Service',
    'OperatorProfile',
    'ClientProfile',
  ];
  export async function resetDb() {
    for (const t of TABLES)
      await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE;`);
  }
  ```
- Tests DB usan `import { prisma, resetDb } from './helpers'` y `beforeEach(resetDb)`.

## 6. `.env.example` (backend)

Añadir:

```
POSTGRES_DB=destrabe_db
POSTGRES_USER=destrabe
POSTGRES_PASSWORD=destrabe
DATABASE_URL="postgresql://destrabe:destrabe@localhost:5432/destrabe_db"
```

Para tests DB, apuntar a la misma DB de dev (o una `_test` separada si se prefiere; por ahora misma DB con truncate).

## 7. Test strategy (TDD)

- **Unit (TDD red-green)**: escribir `enums.schema.test.ts` primero (RED: schemas no existen) → impl enums en shared → GREEN. `no-prisma-import.test.ts` verifica que shared no importa prisma.
- **DB smoke (TDD adaptado)**: los tests DB se escriben después del schema+migración (no se puede testear relaciones sin schema). Flujo: schema → migrate init → escribir db tests → green. Se acepta este orden porque prisma requiere el schema materializado para testear relaciones.
- Orden de apply: shared enums (TDD) → schema prisma → docker-compose + migrate init → db tests → verify.

## 8. Tradeoffs

- **`userId` sin FK**: integridad referencial diferida a cambio-003. Aceptado: el dominio funciona; User llega en auth.
- **Truncate vs transacción por test**: truncate es simple y suficiente para el volumen de tests. Transacción-rollback sería más rápido pero acopla los tests al `$transaction` API. → truncate ahora.
- **PostGIS image desde el inicio**: pesa más que plain postgres, pero evita cambiar imagen en /nearby. Aceptado.
- **`rating` sin CHECK 1..5 en DB**: la validación de rango va en Zod (app layer). Aceptado (consistente con la filosofía de validar en edges).

## Next

Etapa `tasks`: descomponer en tareas ordenadas para `apply` (shared enums → schema → compose+migrate → db tests → docs).
