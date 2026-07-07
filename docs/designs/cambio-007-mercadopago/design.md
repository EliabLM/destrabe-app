# Design — Cambio-007: Integración MercadoPago real

**Change ID**: `cambio-007-mercadopago` · **Etapa SDD**: Design · **Branch**: `develop`
**Basado en**: spec delta, proposal, exploration, design cambio-006 (D1-D5)

> Convierte el seam de `cambio-006` (`PaymentGateway`+`StubPaymentGateway`+factory) en `MercadoPagoGateway` real (SDK oficial+HMAC) seleccionable vía `PAYMENT_GATEWAY=mercadopago`. **No toca contrato REST, specs públicas, ni guard 409.** Solo cambia la implementación detrás de la interfaz + refactor interno del webhook route.

## 1. Technical Approach

El factory ya declara `'mercadopago'` en el enum de `env.ts` (L35) — solo faltaba la implementación (hoy lanza `Unknown payment gateway`). Se agrega `MercadoPagoGateway implements PaymentGateway` que recibe `PrismaClient`+config MP en el constructor (env snapshot, sin lecturas directas de env → testeable). El webhook route delega verificación+parseo a `gateway.processWebhook(req)`: el stub conserva `X-Webhook-Token` (movido desde el route hacia `StubPaymentGateway.processWebhook`) y MP usa `WebhookSignatureValidator` (HMAC)+reverse-lookup `mpPaymentId → payment.id` (campo `Payment.mpPaymentId @unique` ya existe desde cambio-002, **sin migración**).

```
Client ─POST /:id/init─▶ gateway.initPayment → Stub:`stub-{id}` | MP:Preference.create→{id,init_point}─▶persist mpPaymentId
MP ─POST /webhook─▶ gateway.processWebhook(req) → Stub:X-Webhook-Token | MP:HMAC→ipn.manage→findBy mpPaymentId→mapea estado
Route(común) ─▶ PENDING? transiciona+recalcula : 200 idempotente
```

## 2. Architecture Decisions

### D1 — SDK oficial `mercadopago` con versión pin

| Opción | Tradeoff | Decisión |
|---|---|---|
| SDK oficial `~2.x` | `WebhookSignatureValidator`+IPN+tipos TS incluidos; vendor-mantenido | ✅ |
| HTTP directo (`fetch`) | Sin vendor lock; HMAC manual = bugs seguridad | ✗ |
| Wrapper retry/circuit | Overkill MVP; idempotencia ya en route (D5) | ✗→cambio-008 |

Pin `~2.x` (no `^`) para mitigar breaking changes entre majors. Lockfile versionado.

### D2 — Constructor DI: `MercadoPagoGateway(prisma, config)`

| Opción | Tradeoff | Decisión |
|---|---|---|
| `new MPGateway(prisma, {accessToken,webhookSecret,sandbox,webhookUrl})` | Env snapshot inyectado→testeable; Prisma solo en impl concreta | ✅ |
| `new MPGateway()` con `env` global / leer env en métodos | Acopla singleton; tests frágiles; side-effects ocultos | ✗ |

Factory lee `env` una vez y construye el snapshot. El gateway no importa `env` runtime (solo tipos `import type`). Tests inyectan config sin singleton.

### D3 — HMAC verificación dentro de `processWebhook`

| Opción | Tradeoff | Decisión |
|---|---|---|
| `WebhookSignatureValidator.validate({xSignature,xRequestId,dataId,secret,toleranceSeconds:300})` | 401 `INVALID_SIGNATURE`; timing-safe+tolerance+replay abstraídos | ✅ |
| HMAC manual / verificación en route | Bugs seguridad; acopla vendor al route; rompe seam | ✗ |

Stub conserva `X-Webhook-Token` **movido dentro de `StubPaymentGateway.processWebhook`** — el route ya no conoce el mecanismo. Stub: token vs `env.PAYMENT_WEBHOOK_TOKEN`→401. MP: HMAC `x-signature`+`x-request-id`+`data.id` vs `MP_WEBHOOK_SECRET`→401.

### D4 — Reverse-lookup `mpPaymentId → payment.id` (sin migración)

| Opción | Tradeoff | Decisión |
|---|---|---|
| `prisma.payment.findUnique({where:{mpPaymentId}})` — campo `@unique` ya existe desde cambio-002 | Sin migración; O(1); idempotente | ✅ |
| Agregar `providerPaymentId String? @unique` | Renombrar rompe specs/refs; innecesario | ✗ |
| Lookup por `external_reference` (no indexado) | Sin unique; frágil | ✗ |

**Sin migración**: `Payment.mpPaymentId @unique` ya existe (`backend/prisma/schema.prisma` L122). Miss→loggear+404 (REQ-MP-REVERSELOOKUP).

### D5 — Idempotencia: `status !== 'PENDING'` ya existe en route

El route `payments.routes.ts` L121-123 ya hace `if (payment.status !== 'PENDING') return res.json({status})`. MP retries del mismo `mpPaymentId`→reverse-lookup resuelve mismo `payment.id`→guard existente retorna 200 sin mutar. **Sin cambios en lógica de idempotencia.**

### D6 — Sandbox: `MP_SANDBOX` mapea a opción SDK

| `MP_SANDBOX` | SDK `sandbox` | `redirectUrl` |
|---|---|---|
| `true` (default `NODE_ENV≠'production'`) | `true` | `preference.sandbox_init_point` |
| `false` (prod explícito) | `false` | `preference.init_point` |

Default derivado de `NODE_ENV` (REQ-MP-ENV), sobreescritura explícita posible.

### D7 — Testing: `vi.mock('mercadopago')`, sin red

| Capa | Qué | Cómo |
|---|---|---|
| Unit | `initPayment` Preference con items+`external_reference`+`notification_url` | `vi.mock('mercadopago')` |
| Unit | `processWebhook` HMAC ok/401, lookup ok/404, estados (approved/rejected/pending→ignored) | mock `WebhookSignatureValidator`+`ipn.manage` |
| Unit | factory `'mercadopago'`→`MercadoPagoGateway` | sin mocks |
| Env | `MP_*` (REQ-MP-ENV): prod requiere; dev default sandbox; test opcional | extender `env.test.ts` (T2) |
| DB smoke | stub `init→webhook→CONFIRMED` | **sin cambios** — `NODE_ENV=test`→stub; `payments.lifecycle.test.ts` verde |

`NODE_ENV=test`→`PAYMENT_GATEWAY=stub`→tests existentes no tocan MP. Sin tests integración sandbox MP (gateados por credenciales→fuera de scope).

### D8 — Error mapping: MP SDK exceptions → dominio

| Caso MP SDK | Mapping | HTTP |
|---|---|---|
| `WebhookSignatureValidator` falla | `InvalidSignatureError` (nueva) | 401 |
| Reverse-lookup miss | reusar 404 del route (loggea) | 404 |
| Estado no terminal (`pending`,`in_process`,`in_mediation`) | `{status:'ignored'}`→200 sin mutar (REQ-MP-NOTIFICATION) | 200 |
| SDK error inesperado (red,5xx,parseo) | `MercadoPagoError` (nueva)→`errorHandler` | 502 |
| Payment ya terminal | `AlreadyProcessedError` existente→200 idempotente | 200 |

`MercadoPagoError`+`InvalidSignatureError` nuevas clases locales en `mercadopagoGateway.ts` (patrón `PaymentPendingError` de cambio-006): `{status,code,name}`.

## 3. File Changes

| File | Action | Descripción |
|---|---|---|
| `backend/src/services/mercadopagoGateway.ts` | **Create** | `MercadoPagoGateway implements PaymentGateway`+`MercadoPagoError`+`InvalidSignatureError` |
| `backend/__tests__/mercadopagoGateway.test.ts` | **Create** | Unit tests con `vi.mock('mercadopago')` (D7) |
| `backend/src/services/paymentFactory.ts` | Modify | Branch `'mercadopago'`→`new MercadoPagoGateway(prisma,mpConfig)` |
| `backend/src/services/paymentGateway.ts` | Modify | Mover `X-Webhook-Token` check al `StubPaymentGateway.processWebhook` |
| `backend/src/routes/payments.routes.ts` | Modify | Webhook delega a `gateway.processWebhook(req)` (refactor interno) |
| `backend/src/lib/env.ts` | Modify | `MP_ACCESS_TOKEN`,`MP_WEBHOOK_SECRET`,`MP_WEBHOOK_URL`,`MP_SANDBOX` (REQ-MP-ENV) |
| `backend/__tests__/env.test.ts` | Modify | Tests `MP_*` (T2) |
| `backend/package.json` | Modify | Dep `"mercadopago": "~2.x"` |

**Sin migración Prisma**: `Payment.mpPaymentId @unique` ya existe (cambio-002).

## 4. Risks & Mitigations

| Riesgo (proposal) | Mitigación design |
|---|---|
| Reverse-lookup frágil | D4 + test ida y vuelta `init→mpPaymentId→webhook→lookup` |
| Breaking change SDK entre majors | D1 pin `~2.x` (no `^`); lockfile versionado |
| Sandbox ≠ prod | D6 flag `MP_SANDBOX`+default por `NODE_ENV` |
| Refactor webhook rompe tests stub | D7: `payments.lifecycle.test.ts` verde antes de merge; token movido al stub preserva flujo |
| Dependencia externa vendor | Aceptada — SDK oficial reduce superficie seguridad (HMAC vendor-validado) |

Design-level extra: `vi.mock('mercadopago')`→unit-testable sin red; `import type` para config snapshot.

## 5. Out of Scope & Rollout

**Out of scope**: refunds/cancelación (`REFUNDED` existe sin flujo); marketplace/split (`OperatorProfile.mpAccountId` L58 sin usar); config dashboard MP; suscripciones; retry/backoff/circuit→cambio-008; tests integración sandbox MP.

**Sin migración.** `Payment.mpPaymentId @unique` ya existe (cambio-002). Sin tocar `schema.prisma`.
**Rollout**: setear `PAYMENT_GATEWAY=mercadopago`+`MP_*` en env prod→factory selecciona MP. Default `stub` preservado→rollback=revertir env. Rollback código: revert commits, eliminar `mercadopagoGateway.ts`+test, desinstalar `mercadopago`.

## 6. Open Questions

- [ ] ¿Versión exacta del pin `~2.x`? Confirmar en tasks con `npm view mercadopago versions --json`.

## Next

`tasks`: `package.json`+dep → `env.ts`+MP_*+tests → `mercadopagoGateway.ts` → `paymentFactory.ts` branch → `paymentGateway.ts` stub refactor → `payments.routes.ts` webhook delegate → unit tests → regresión stub/DB smoke verde.
