# Delta para service-lifecycle — Cambio-006

## MODIFIED Requirements

### REQ-005: `PATCH /services/:id/status`

`requireAuth`. Body `updateServiceStatusSchema` (`status` enum). Carga `Service` con Payment asociado, llama `assertTransition(current, target, role)`. Ownership: `PENDING→CANCELLED` solo `CLIENT` dueño o `system`; `ACTIVE→COMPLETED` solo `OPERATOR` asignado al `acceptedQuoteId`. **Guard de pago**: `ACTIVE→COMPLETED` requiere `Payment.status === CONFIRMED`; si no → 409 `PAYMENT_PENDING`. 200 actualizado; 409 `INVALID_TRANSITION`/`PAYMENT_PENDING`, 404, 400, 403 ownership.

(Previously: sin guard de pago — `ACTIVE→COMPLETED` solo validaba FSM + ownership del OPERATOR asignado)

```gherkin
Scenario: ACTIVE→COMPLETED con pago confirmado
  Given service ACTIVE, Payment CONFIRMED, OPERATOR asignado
  When PATCH /services/:id/status { status: 'COMPLETED' }
  Then 200 status 'COMPLETED'
Scenario: ACTIVE→COMPLETED sin pago confirmado → 409 PAYMENT_PENDING
  Given service ACTIVE, Payment PENDING, OPERATOR asignado
  When PATCH /services/:id/status { status: 'COMPLETED' }
  Then 409 { code: 'PAYMENT_PENDING' }
Scenario: dueño cancela PENDING (sin cambio)
  Given service PENDING, CLIENT dueño
  When PATCH /services/:id/status { status: 'CANCELLED' }
  Then 200 status 'CANCELLED'
Scenario: transición ilegal → 409 INVALID_TRANSITION
  Given service PENDING
  When PATCH /services/:id/status { status: 'COMPLETED' } (CLIENT)
  Then 409 { code: 'INVALID_TRANSITION' }
```
