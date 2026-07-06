# Proposal: Cambio-006 — Flujo de Pago end-to-end

**Change ID:** `cambio-006-pagos` · **Etapa:** Propose · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-006-pagos/exploration.md`

## Intent

`cambio-005` crea un `Payment` stub `PENDING` al aceptar la cotización, sin flujo real. Este cambio lo convierte en `init → webhook → CONFIRMED` tras una abstracción `PaymentGateway`, y exige pago confirmado antes de `COMPLETED`.

## Scope

### In Scope

- Interfaz `PaymentGateway` + `StubPaymentGateway` (`createPaymentIntent`, `verifyPayment`).
- Endpoints `POST /payments/:id/init` (CLIENT dueño), `POST /payments/webhook`.
- Factoría única por env `PAYMENT_GATEWAY=stub`.
- `calculateCommission(amount, pct)` desde `PLATFORM_COMMISSION_PCT` (default 10); recálculo en confirm.
- Guard en `PATCH /services/:id/status` (`ACTIVE→COMPLETED`): 409 `PAYMENT_PENDING` si `Payment.status !== CONFIRMED`.
- Schemas `initPaymentSchema`, `paymentWebhookSchema` + `z.infer`.
- Tests unit + db smoke (init→webhook→CONFIRMED→COMPLETED).

### Out of Scope

- `MercadoPagoGateway`, SDK, credenciales, firma IPN, `REFUNDED`, reintentos, expiración de `Payment` (→ `cambio-007+`).
- Comisión por `truckType` o `Config`; cambios en `quotes.routes.ts`, `serviceMachine.ts`, `schema.prisma`.

## Capabilities

> Contrato con `sdd-spec`.

### New Capabilities

- `payment-lifecycle`: init (CLIENT), webhook de confirmación, cálculo de comisión, recálculo de `operatorAmount`. Cubre `PaymentGateway` + `StubPaymentGateway`.

### Modified Capabilities

- `service-lifecycle`: `ACTIVE → COMPLETED` requiere `Payment.status === CONFIRMED`; 409 `PAYMENT_PENDING` en caso contrario. Delta spec.

## Approach

Approach C (gateway + stub). `StubPaymentGateway` devuelve `initPoint: 'https://pago.stub/...'` y aprueba toda notificación. Swap a MP real en `cambio-007+` vía nueva implementación + env, sin tocar endpoints/rutas. Webhook público solo en stub/dev.

## Affected Areas

| Área | Impacto |
|------|---------|
| `routes/payments.routes.ts`, `services/{paymentGateway,commission}.ts` | New |
| `routes/index.ts`, `routes/services.routes.ts`, `lib/env.ts`, `shared/.../payment.*` | Modified |
| `__tests__/` (unit + db smoke) | New |
| `schema.prisma`, `serviceMachine.ts`, `quotes.routes.ts`, `package.json` | No change |

## Risks

| Riesgo | Prob | Mitigación |
|--------|------|------------|
| Interfaz `PaymentGateway` insuficiente para MP | Med | Revisar API Preference MP en design; `metadata?` extensible |
| Webhook stub expuesto en prod | Med | `requireAuth` salvo `PAYMENT_GATEWAY=stub` en dev |
| Doble webhook recalcula | Bajo | Idempotencia: si `CONFIRMED`, 200 sin recalcular |

## Rollback Plan

Revertir merge. Eliminar `payments.routes.ts`, `paymentGateway.ts`, `commission.ts`, tests y schemas en `shared/`; quitar env vars y el guard. Sin migraciones Prisma.

## Dependencies

- `cambio-005`: stub `Payment PENDING` al aceptar. `cambio-004`: patrón routes, `serviceMachine`. `cambio-002`: modelo `Payment`.

## Success Criteria

- [ ] `POST /payments/:id/init` devuelve `initPoint` (CLIENT dueño; 403 ajeno).
- [ ] `POST /payments/webhook` → `CONFIRMED` + recalcula `commission`/`operatorAmount`.
- [ ] `PATCH /services/:id/status` `ACTIVE→COMPLETED` → 409 `PAYMENT_PENDING` si no `CONFIRMED`.
- [ ] Tras webhook, `COMPLETED` pasa; `commission = amount * pct`.
- [ ] Switch por `PAYMENT_GATEWAY`; tests unit + db smoke verdes.

## Proposal question round

Omitida: las decisiones del usuario (Approach C + bloqueo estricto 409) cubren el panorama productivo. Restan detalles de harness para `spec`/`design`.