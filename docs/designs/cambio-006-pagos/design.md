# Design — Cambio-006: Flujo de Pago end-to-end

**Change ID:** `cambio-006-pagos`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-006-pagos/spec.md`, `docs/specs/cambio-006-pagos/service-lifecycle.md`
**Branch:** `develop`

> Convierte el `Payment` stub `PENDING` (cambio-005) en un flujo `init → webhook → CONFIRMED` tras una abstracción `PaymentGateway` + `StubPaymentGateway`, y bloquea `ACTIVE → COMPLETED` con 409 `PAYMENT_PENDING` si no hay pago confirmado. Swap a MercadoPago en cambio-007+ vía env, sin tocar rutas.

## 1. Technical Approach

Dos endpoints en `payments.routes.ts` siguiendo el patrón de `quotes.routes.ts`. Interfaz `PaymentGateway` + `StubPaymentGateway` en `services/paymentGateway.ts`, seleccionada por `paymentFactory.ts` vía `env.PAYMENT_GATEWAY`. Comisión pura `calculateCommission(amount, rate)` persistida en `init`. Webhook público sin `requireAuth`, validando `X-Webhook-Token` contra env. Guard 409 `PAYMENT_PENDING` en el handler `PATCH /services/:id/status` existente — clase local `PaymentPendingError` (patrón `AlreadyAcceptedError`). **Sin migración Prisma**: `Payment` ya expone `commission`, `operatorAmount`, `mpPaymentId @unique`.

## 2. Architecture Decisions

### D1 — Interfaz `PaymentGateway` + `StubPaymentGateway`

| Opción                               | Tradeoff                                       | Decisión   |
| ------------------------------------ | ---------------------------------------------- | ---------- |
| Interfaz TS + Stub + factory por env | Contrato estable para MP; swap sin tocar rutas | ✅ Elegida |
| Función `processPayment` inline      | Acopla lógica al route; bloquea swap           | ✗          |
| SDK MP directo en routes             | Acopla vendor; rompe tests                     | ✗          |

### D2 — Webhook público con `X-Webhook-Token`

| Opción                            | Tradeoff                                                 | Decisión   |
| --------------------------------- | -------------------------------------------------------- | ---------- |
| Sin `requireAuth` + header vs env | Stub seguro en dev; MP reemplaza por firma en cambio-007 | ✅ Elegida |
| `requireAuth` en webhook          | MP no puede autenticar                                   | ✗          |
| Sin validación                    | Webhook expuesto en dev                                  | ✗          |

### D3 — Guard 409 `PAYMENT_PENDING` como clase local

| Opción                                               | Tradeoff                                                                       | Decisión   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| `PaymentPendingError` local (409, `PAYMENT_PENDING`) | Replica patrón `AlreadyAcceptedError`; no toca `serviceMachine.ts` (no-change) | ✅ Elegida |
| Extender `ConflictError` con `code` param            | Modifica `serviceMachine.ts` (no-change)                                       | ✗          |
| `res.status(409).json` inline                        | Rompe patrón throw → `errorHandler`                                            | ✗          |

### D4 — Idempotencia webhook por estado terminal

| Opción                               | Tradeoff                               | Decisión   |
| ------------------------------------ | -------------------------------------- | ---------- |
| `CONFIRMED`/`FAILED` → 200 sin mutar | Eventos duplicados de MP no recalculan | ✅ Elegida |
| Recalcular siempre                   | Drift; `mpPaymentId` único se violaría | ✗          |
| 409 sobre duplicado                  | MP reintentaría indefinidamente        | ✗          |

### D5 — Comisión persistida en `init`, recalculada en webhook confirm

`calculateCommission(amount, rate)` pura. En `init`: `commission = round(amount * rate / 100)`, `operatorAmount = amount - commission`. En webhook `CONFIRMED`: recalcula (defensa si `amount` mutó). `rate` desde `env.PAYMENT_COMMISSION_RATE` (default `0` Demo).

## 3. Data Flow

```
Client ─POST /payments/:id/init──▶ find Payment(404) ─▶ owner via service.client(403) ─▶ PENDING? (409 si terminal)
   │   └▶ calculateCommission + persist ─▶ gateway.initPayment ─▶ update mpPaymentId ─▶ 200 {gatewayData}
MP/Stub ─POST /payments/webhook (X-Webhook-Token)──▶ token 401 ─▶ schema 400 ─▶ find Payment(404)
   │   └▶ PENDING? transiciona+recalcula ─▶ terminal? 200 idempotente
Operator ─PATCH /services/:id/status COMPLETED──▶ handler ─▶ Payment by serviceId ─▶ !==CONFIRMED → 409 PAYMENT_PENDING
```

## 4. File Changes

| File                                                    | Action | Descripción                                                           |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `backend/src/services/paymentGateway.ts`                | Create | Interfaz `PaymentGateway`, `StubPaymentGateway`, errores              |
| `backend/src/services/paymentFactory.ts`                | Create | `getPaymentGateway()` por env                                         |
| `backend/src/services/commission.ts`                    | Create | `calculateCommission(amount, rate)` pura                              |
| `backend/src/routes/payments.routes.ts`                 | Create | 2 endpoints                                                           |
| `backend/src/routes/index.ts`                           | Modify | Montar `paymentsRouter` en `/payments`                                |
| `backend/src/routes/services.routes.ts`                 | Modify | Guard 409 `PAYMENT_PENDING` en `PATCH /:id/status` COMPLETED          |
| `backend/src/lib/env.ts`                                | Modify | `PAYMENT_GATEWAY`, `PAYMENT_COMMISSION_RATE`, `PAYMENT_WEBHOOK_TOKEN` |
| `shared/src/schemas/payment.schema.ts`                  | Modify | `initPaymentResponseSchema`, `webhookEventSchema`                     |
| `shared/src/types/payment.ts`                           | Modify | re-export `z.infer`                                                   |
| `backend/__tests__/{paymentGateway,commission}.test.ts` | Create | Unit REQ-005/003                                                      |
| `backend/__tests__/db/payments.lifecycle.test.ts`       | Create | supertest init→webhook→CONFIRMED→COMPLETED                            |

## 5. Interfaces / Contracts

```ts
export interface PaymentGateway {
  initPayment(p: {
    id: string;
    amount: number;
    commission: number;
    operatorAmount: number;
  }): Promise<{ gatewayPaymentId: string; redirectUrl?: string }>;
  processWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<{
    paymentId: string;
    status: 'CONFIRMED' | 'FAILED';
    gatewayReference?: string;
  }>;
}
export class StubPaymentGateway implements PaymentGateway {} // gatewayPaymentId determinístico `stub-${id}`; aprueba todo webhook
export function getPaymentGateway(): PaymentGateway; // env.PAYMENT_GATEWAY==='stub' → StubPaymentGateway
export class PaymentPendingError extends Error {
  status = 409;
  code = 'PAYMENT_PENDING' as const;
}
export class AlreadyProcessedError extends Error {
  status = 409;
  code = 'ALREADY_PROCESSED' as const;
}
export const webhookEventSchema = z.object({
  paymentId: z.string(),
  status: z.enum(['CONFIRMED', 'FAILED']),
  gatewayReference: z.string().optional(),
});
export const initPaymentResponseSchema = z.object({
  gatewayPaymentId: z.string(),
  redirectUrl: z.string().optional(),
});
```

## 6. Testing Strategy

| Layer    | Qué                                                                                                                                                                           | Cómo                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Unit     | `calculateCommission` (10% sobre 5000 → 500/4500; default `0`); `StubPaymentGateway.initPayment` (`stub-${id}`); `getPaymentGateway` default; `webhookEventSchema` ok/invalid | tabla-driven, Zod `safeParse`                        |
| DB smoke | init CLIENT dueño 200 + persiste comisión; no-dueño 403; ya CONFIRMED 409 `ALREADY_PROCESSED`                                                                                 | supertest + `authenticateAs`                         |
| DB smoke | webhook CONFIRMED recalcula; duplicado idempotente; 404; 400; `X-Webhook-Token` 401                                                                                           | supertest                                            |
| DB smoke | `PATCH /services/:id/status` COMPLETED con CONFIRMED → 200; con PENDING → 409 `PAYMENT_PENDING`                                                                               | supertest, flujo quotes→accept→init→webhook→complete |

## 7. Migration / Rollout

No migration required. `Payment.commission`/`operatorAmount`/`mpPaymentId @unique` ya existen (cambio-002). Sin tocar `schema.prisma` ni `serviceMachine.ts`.
**Rollback:** revert commits → eliminar `payments.routes.ts`, `paymentGateway.ts`, `paymentFactory.ts`, `commission.ts`, tests, schemas en `shared/`; quitar env vars y guard.

## 8. Open Questions

- [ ] Conflicto spec vs locked: REQ-003 decía `round(amount * rate)` default `0.10` (fracción); locked decree `round(amount * rate / 100)` default `0` (porcentaje). **Resuelto:** seguir locked. Confirmar con spec owner.
- [ ] ¿`X-Webhook-Token` requerido en prod? MP reemplaza por firma HMAC en cambio-007.

## Next

`tasks`: shared schemas → env → `commission.ts` → `paymentGateway.ts`+factory → `payments.routes.ts` → mount → guard 409 → unit → db smoke.
