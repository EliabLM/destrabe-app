# Design — Cambio-003: Better Auth (OTP + Identity)

**Change ID:** `cambio-003-auth`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-003-auth/spec.md`
**Branch:** `feature/cambio-003-auth`

> Diseño técnico concreto: estructura de archivos, configs, flujo Better Auth, helpers de test.

## 1. Dependencias nuevas

`backend/package.json`:

- `better-auth` (fijar versión exacta explorando en apply — ej. `^1.2.9`)
- `plivo` (`^4.x` aprox)

## 2. File tree (añadidos/cambios)

```
backend/
├── src/
│   ├── lib/
│   │   ├── auth.ts              # NUEVO: betterAuth config
│   │   ├── plivo.ts             # NUEVO: Plivo client + sendOtp (dev mode)
│   │   └── env.ts               # AMPLIADO: BETTER_AUTH_*, PLIVO_*
│   ├── middleware/
│   │   ├── auth.ts              # NUEVO: requireAuth + requireRole
│   │   ├── errorHandler.ts      # ya existe
│   │   └── notFound.ts          # ya existe
│   ├── routes/
│   │   ├── index.ts             # AMPLIADO: monta /api/auth/*
│   │   └── health.routes.ts     # ya existe
│   └── app.ts                   # MANTIENE createApp (auth va en router)
├── prisma/schema.prisma         # AMPLIADO: User/Session/Account/Verification + FKs
└── __tests__/
    ├── auth.config.test.ts      # NUEVO (unit)
    ├── plivo.test.ts            # NUEVO (unit)
    ├── middleware.auth.test.ts  # NUEVO (unit)
    ├── auth.otp.flow.test.ts    # NUEVO (db + supertest agent + mock Plivo)
    └── env.test.ts              # AMPLIADO
docs/
└── adr/
    └── ADR-003-better-auth.md   # NUEVO
shared/
└── src/
    ├── types/auth.ts            # NUEVO: tipos de contrato auth
    └── schemas/auth.schema.ts   # NUEVO: schemas Zod auth
```

## 3. `backend/src/lib/auth.ts`

```ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { phoneNumber } from 'better-auth/plugins';
import { zurNodeHandler } from 'better-auth/node'; // alias: toNodeHandler
import { prisma } from './prisma';
import { env } from './env';
import { sendOtp } from './plivo';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        await sendOtp(phoneNumber, code);
      },
      verifyOTP: async ({ phoneNumber, code }) => {
        // Mejor manejar por library: pasar a otra callback vía auth.api
        // Por ahora retornamos false (mejor delega a Better Auth vía signin/signUp)
        return false;
      },
      otpLength: 6,
      expiresIn: 5 * 60, // 5 min
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'CLIENT',
        // input: false  // no editable por cliente
      },
    },
  },
});

// Handler montable en Express
export const authHandler = toNodeHandler(auth.handler);
```

**Nota:** `verifyOTP` custom requiere investigación en apply. Better Auth plugin phoneNumber expone endpoints `/phone/send-otp` y `/phone/verify-otp` que usan `verifyOTP` callback. Si `verifyOTP` retorna `true`, se firma sesión y se crea/actualiza user. Delegamos a la lib — pasamos el callback que simplemente revalida con un helper interno (o con la API de Plivo Verify si estamos en modo real). Para ser simple: `verifyOTP` retorna `true` si existe OTP en `sendOTP` para ese teléfono (capturado en mock tests). En producción real, se usa `verifyOTP` con Plivo Verify service. En dev, `sendOtp` loggea el OTP, y `verifyOTP` puede usarse para testear siempre-true o comparar código recentlu generado.

## 4. `backend/src/lib/plivo.ts`

```ts
import { env } from './env';

let plivoClient: any = null;

function getClient() {
  if (!env.PLIVO_AUTH_ID || !env.PLIVO_AUTH_TOKEN) return null;
  if (!plivoClient) {
    const plivo = require('plivo');
    plivoClient = new plivo.Client(env.PLIVO_AUTH_ID, env.PLIVO_AUTH_TOKEN);
  }
  return plivoClient;
}

export async function sendOtp(phone: string, code: string) {
  const client = getClient();
  if (!client) {
    console.log(`[dev] OTP for ${phone}: ${code}`);
    return;
  }
  await client.messages.create({
    src: env.PLIVO_PHONE_NUMBER!,
    dst: phone,
    text: `destrabe: tu código es ${code}. Vence en 5 min.`,
  });
}
```

Export `__setLastOtpForTesting` hook cuando sea necesario — pero en tests preferimos `vi.mock('./plivo', ...)` para capturar el código. Ver helpers.

## 5. `backend/src/lib/env.ts` (ampliado)

Añadir al schema:

```ts
BETTER_AUTH_SECRET: z.string().min(32),
BETTER_AUTH_URL: z.string().url(),
PLIVO_AUTH_ID: z.string().optional(),
PLIVO_AUTH_TOKEN: z.string().optional(),
PLIVO_PHONE_NUMBER: z.string().optional(),
```

Defaults: en test, `BETTER_AUTH_SECRET='test-secret-test-secret-test-secret-test-secret'` y `BETTER_AUTH_URL='http://localhost:3000'` pueden defaultearse solo en `NODE_ENV === 'test'`.

## 6. Schema Prisma — generado y ajustado

Tras `npx auth generate`, ajustar:

```prisma
model User {
  id            String    @id @default(cuid())
  phone         String    @unique
  name          String?
  email         String?   @unique
  emailVerified Boolean   @default(false)
  role          UserRole  @default(CLIENT)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions        Session[]
  accounts        Account[]
  clientProfile   ClientProfile?
  operatorProfile OperatorProfile?
  messages        Message[]
}

model Session {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

model Account {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  accountId         String
  providerId        String
  accessToken      String?
  refreshToken      String?
  accessTokenExpiresAt DateTime?
  refreshTokenExpiresAt DateTime?
  scope             String?
  idToken           String?
  password          String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([userId])
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  @@index([identifier])
}

model ClientProfile {
  // ...
  userId   String   @unique
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // quitar comentario '// FK a User (cambio-003)'
}
// análogo OperatorProfile.userId → User
// Message.senderId → User (no unique, onDelete: Cascade)
```

Migración: `npx prisma migrate dev --name add_auth_identity`.

## 7. `backend/src/middleware/auth.ts`

```ts
import type { RequestHandler } from 'express';
import { auth } from '../lib/auth';

export interface AuthedRequest extends Request {
  user?: { id: string; phone: string; role: string };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return res
        .status(401)
        .json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    (req as AuthedRequest).user = {
      id: session.user.id,
      phone: session.user.phone,
      role: session.user.role,
    };
    next();
  } catch (e) {
    return res
      .status(401)
      .json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
};

export function requireRole(role: string): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthedRequest).user;
    if (!user || user.role !== role) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}
```

## 8. Integración en `app.ts` / `routes/index.ts`

`routes/index.ts`:

```ts
import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authHandler } from '../lib/auth';

export const router = Router();

router.use('/health', healthRouter);
router.use('/api/auth', authHandler); // monta todos los endpoints de Better Auth
```

## 9. Helpers de test

`backend/__tests__/helpers/plivo-mock.ts`:

```ts
import { vi } from 'vitest';
export function mockPlivo() {
  const sentOtps: { phoneNumber: string; code: string }[] = [];
  vi.mock('../../src/lib/plivo', () => ({
    sendOtp: vi.fn(async (phoneNumber, code) => {
      sentOtps.push({ phoneNumber, code });
    }),
  }));
  return {
    getLastOtp: (phone: string) =>
      sentOtps.find((o) => o.phoneNumber === phone)?.code,
    resetOtps: () => {
      sentOtps.length = 0;
    },
  };
}
```

`auth.otp.flow.test.ts` usa `request.agent(app)` (cookie jar) + Plivo mocked para capturar OTP y reintegrar en verify.

## 10. Comandos nuevos/afectados

Ninguno nuevo. Scripts actuales (`dev`, `test`, `test:db`, `db:up`, `db:migrate`) cubren todo.

## 11. Tradeoffs

- **`verifyOTP` callback trivial**: en devfico/real delegar el variability por provider (Plivo Verify vs custom). Para la demo, Better Auth genera y persiste OTP en Verification; en verifyOTP solo comparamos contra lo capturado por sendOTP (mock) o en prod con Plivo. Dejamos `verifyOTP` retornado `false` de placeholders en cambio passar `verifyOtpAsCode`. Se ajusta en apply según la API exacta de phoneNumber plugin.
- **`role` como `string` no `UserRole` en additionalFields**: Better Auth no soporta enum directamente; se almacena como string, se castea al leer. Validación via ts.
- **Plivo requerire/conditional**: `require('plivo')` lazy para no romper si no esté instalado en path de tests (será dei deps, pero lazy loading es más robusto).
- **Cookies en supertest**: `request.agent` mantiene cookies entre requests. Confirmado en vitest.

## 12. Riesgos del apply

- **`npx auth generate` requiere scheme.prisma con datasource URL**: corre prisma, por eso DATABASE_URL debe estar en env al ejecutar.
- **`npx auth generate` puede añadir campos AI/added/extrafields añadir el role**: documentar y revisar diff antes de commitear.
- **API de Better Auth puede diverger entre snippets Context7**: validar versión instalada en apply leyendo `node_modules/better-auth/package.json`.

## Next

Etapa `tasks`: descomponer en tareas ordenadas para `apply`.
