# Tasks — Cambio-006: Pagos (payment-lifecycle)

**Change ID:** `cambio-006-pagos` · **Basado en:** `docs/designs/cambio-006-pagos/design.md` · **Branch:** `develop`

> TDD donde aplique. T1-T4 no requieren Docker; T5-T8 requieren PG+Redis up.

---

## Review Workload Forecast

| Field                   | Value                 |
| ----------------------- | --------------------- |
| Estimated changed lines | 350-500               |
| 400-line budget risk    | Medium                |
| Chained PRs recommended | No                    |
| Suggested split         | Feature branch única  |
| Delivery strategy       | ask-on-risk           |
| Chain strategy          | feature-branch-unique |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: feature-branch-unique
400-line budget risk: Medium

---

## Suggested Work Units

| Unit | Goal                 | Likely PR | Notes              |
| ---- | -------------------- | --------- | ------------------ |
| 1    | Schemas + env + lib  | PR 1      | T1-T4              |
| 2    | Routes + guard + e2e | PR 1      | T5-T8; PG+Redis up |

---

## T1 — Shared schemas + tipos (Zod) _(no Docker)_

**Acción:** Ampliar `shared/src/schemas/payment.schema.ts` con `initPaymentResponseSchema` y `webhookEventSchema`; tipos `z.infer` en `shared/src/types/payment.ts`; confirmar barrel; build shared OK.

**Acepta (REQ-005):** build OK.

---

## T2 — Env vars + tests (TDD) _(unit, no Docker)_

**Test primero:** ampliar `backend/__tests__/env.test.ts`: `PAYMENT_GATEWAY` default `stub`; `PAYMENT_COMMISSION_RATE` default `0`; `PAYMENT_WEBHOOK_TOKEN` req dev/prod opt test.

**Luego impl:** añadir variables en `backend/src/lib/env.ts`.

**Acepta (REQ-003/005):** tests green.

---

## T3 — calculateCommission pura (TDD) _(unit, no Docker)_

**Test primero:** crear `backend/__tests__/commission.test.ts`: 10% sobre 5000 → 500/4500; 0% → 0/5000.

**Luego impl:** crear `backend/src/services/commission.ts` pura.

**Acepta (REQ-003):** tests green.

---

## T4 — PaymentGateway + Stub + factory (TDD) _(unit, no Docker)_

**Test primero:** crear `backend/__tests__/paymentGateway.test.ts`: stub retorna id; factory default `stub`.

**Luego impl:** crear `backend/src/services/paymentGateway.ts` (interfaz, stub) y `backend/src/services/paymentFactory.ts`.

**Acepta (REQ-005):** tests green.

---

## T5 — payments.routes init + webhook _(requiere PG up)_

**Acción:** Crear `backend/src/routes/payments.routes.ts`: `POST /payments/:id/init` (CLIENT dueño, 403/404/409, calcula comisión); `POST /payments/webhook` (sin auth, valida token, idempotencia).

**Acepta (REQ-001/002/004):** endpoints responden.

---

## T6 — Montar paymentsRouter en routes/index.ts _(requiere PG up)_

**Acción:** Exportar `paymentsRouter`; montar en `backend/src/routes/index.ts` bajo `/payments`.

**Acepta:** rutas OK.

---

## T7 — Guard 409 PAYMENT_PENDING en services.routes.ts _(requiere PG up)_

**Acción:** En `backend/src/routes/services.routes.ts`, en `PATCH /:id/status` (`ACTIVE→COMPLETED`), lanzar `PaymentPendingError` si Payment ≠ `CONFIRMED`.

**Acepta (service-lifecycle REQ-005):** 409 cuando aplica; 200 cuando confirmado.

---

## T8 — Db smoke payment lifecycle (TDD) _(requiere PG up)_

**Test primero:** crear `backend/__tests__/db/payments.lifecycle.test.ts`: quotes→accept→init (dueño 200, ajeno 403, ya CONFIRMED 409); webhook recalcula, duplicado idempotente, 404/400/401; COMPLETED 409 sin pago, 200 confirmado.

**Luego impl:** ajustar rutas.

**Acepta (REQ-001/002/003/004/005 + service-lifecycle REQ-005):** db smoke green.

---

## Orden de ejecución

`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8`

## Next

Etapa `apply`: ejecutar T1→T8 con TDD. **Orchestrator:** pedir confirmación antes de apply.

---

## Progreso apply

- [x] T1 — Shared schemas + tipos
- [x] T2 — Env vars + tests
- [x] T3 — calculateCommission pura
- [x] T4 — PaymentGateway + Stub + factory
- [x] T5 — payments.routes init + webhook
- [x] T6 — Montar paymentsRouter
- [x] T7 — Guard 409 PAYMENT_PENDING
- [x] T8 — Db smoke payment lifecycle
