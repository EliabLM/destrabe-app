# Tasks — Cambio-007: Integración MercadoPago (payment-lifecycle)

**Change ID:** `cambio-007-mercadopago` · **Basado en:** `docs/designs/cambio-007-mercadopago/design.md` · **Branch:** `develop`

> TDD donde aplique. T1-T6 son unitarios; T7-T8 requieren PG+Redis up.

---

## Review Workload Forecast

| Field                   | Value                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Estimated changed lines | 600-900                                                                                         |
| 400-line budget risk    | High                                                                                            |
| Chained PRs recommended | No                                                                                              |
| Suggested split         | Feature branch única `feature/cambio-007-mercadopago`; `size:exception` aceptado si >400 líneas |
| Delivery strategy       | single-pr                                                                                       |
| Chain strategy          | feature-branch-unique                                                                           |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-unique
400-line budget risk: High

---

## Suggested Work Units

Unidad única (T1-T8, PR 1).

---

## T1 — Agregar dependencia `mercadopago`

**Acción:** Añadir `"mercadopago": "~3.2.0"` a `dependencies` en `backend/package.json`. **No instalar todavía.**

**Acepta:** `package.json` modificado.

---

## T2 — Variables de entorno MP + tests TDD

**Test primero:** extender `backend/__tests__/env.test.ts`: env válido prod con MP; falta `MP_ACCESS_TOKEN` → error; `MP_SANDBOX` default `true` en dev; MP vars opcionales con stub.

**Luego impl:** añadir `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_WEBHOOK_URL`, `MP_SANDBOX` en `backend/src/lib/env.ts` según REQ-MP-ENV.

**Acepta (REQ-MP-ENV):** tests green.

---

## T3 — Refactor `StubPaymentGateway.processWebhook`

**Acción:** Mover la verificación de `X-Webhook-Token` desde `payments.routes.ts` hacia `StubPaymentGateway.processWebhook(payload, signature)`. Comparar contra `env.PAYMENT_WEBHOOK_TOKEN` y lanzar error 401 si falla. Actualizar `backend/__tests__/paymentGateway.test.ts` si cambia la firma.

**Acepta (REQ-002):** stub tests green.

---

## T4 — Agregar `MercadoPagoError`

**Acción:** Añadir la clase `MercadoPagoError` en `backend/src/services/paymentGateway.ts` para errores SDK inesperados. Agregar unit test.

**Acepta (REQ-005):** tests green.

---

## T5 — Implementar `MercadoPagoGateway` con SDK mockeado

**Acción:** Crear `backend/src/services/mercadopagoGateway.ts`: `MercadoPagoGateway implements PaymentGateway` con constructor `(prisma, config)`. `initPayment` crea Preference con `external_reference=payment.id`, `notification_url` y redirect según `MP_SANDBOX`. `processWebhook` valida HMAC, resuelve `mpPaymentId → payment.id` y mapea estados.

Crear `backend/__tests__/mercadopagoGateway.test.ts` con `vi.mock('mercadopago')`: init, HMAC inválido, lookup miss, no terminales ignored, approved/rejected, retry.

**Acepta (REQ-001 MODIFIED, REQ-002, REQ-MP-REVERSELOOKUP, REQ-MP-NOTIFICATION):** tests green.

---

## T6 — Cablear `MercadoPagoGateway` en la factoría

**Acción:** Actualizar `backend/src/services/paymentFactory.ts`: cuando `PAYMENT_GATEWAY=mercadopago`, retornar `new MercadoPagoGateway(prisma, mpConfig)`. Añadir test de selección.

**Acepta (REQ-005):** factory tests green.

---

## T7 — Delegar webhook al gateway en `payments.routes.ts`

**Acción:** Refactorizar `POST /payments/webhook` para llamar `gateway.processWebhook(req.body, req.headers)` y eliminar la validación inline de `X-Webhook-Token`. Mapear errores de dominio a HTTP y conservar 200 en éxito terminal y en `{status:'ignored'}`.

**Acepta (REQ-002, REQ-MP-NOTIFICATION):** db smoke `payments.lifecycle.test.ts` green.

---

## T8 — Regresión y formato

**Acción:** Ejecutar `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`. Corregir issues. Marcar `[x]`.

**Acepta:** todos los checks green.

---

## Orden de ejecución

`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8`

## Next

Etapa `apply`: ejecutar T1→T8 con TDD. Proceder con feature branch única; `size:exception` si >400 líneas.

---

## Progreso apply

- [x] T1 — Agregar dependencia `mercadopago`
- [x] T2 — Variables de entorno MP + tests TDD
- [x] T3 — Refactor `StubPaymentGateway.processWebhook`
- [x] T4 — Agregar `MercadoPagoError`
- [x] T5 — Implementar `MercadoPagoGateway` con SDK mockeado
- [x] T6 — Cablear `MercadoPagoGateway` en la factoría
- [x] T7 — Delegar webhook al gateway en `payments.routes.ts`
- [x] T8 — Regresión y formato

---

## Forecast y trazabilidad de specs

- **Estimated changed lines:** 600-900
- **400-line budget risk:** High
- **PR strategy:** Feature branch única `feature/cambio-007-mercadopago`; `size:exception` aceptado si >400 líneas.

| REQ                  | Tarea(s)           |
| -------------------- | ------------------ |
| REQ-001 (MODIFIED)   | T5, T7             |
| REQ-002 (MODIFIED)   | T3, T5, T7         |
| REQ-005 (MODIFIED)   | T3, T4, T5, T6, T7 |
| REQ-MP-ENV           | T2                 |
| REQ-MP-REVERSELOOKUP | T5                 |
| REQ-MP-NOTIFICATION  | T5, T7             |
