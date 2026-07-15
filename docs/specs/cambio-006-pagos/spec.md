# Spec — Cambio-006: Pagos (payment-lifecycle)

**Change ID:** `cambio-006-pagos` · **Etapa SDD:** Spec · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-006-pagos/proposal.md`

> Capacidad NUEVA `payment-lifecycle` (sin spec previa): FULL spec con `## ADDED Requirements`. `service-lifecycle` (cambio-004) se modifica en `service-lifecycle.md` (delta).

---

## ADDED Requirements

### REQ-001: `POST /payments/:id/init`

`requireAuth`+`requireRole(CLIENT)`. CLIENT MUST ser dueño del service (403 ajeno). Payment MUST existir `PENDING` (404 inexistente, 409 `ALREADY_PROCESSED` si `CONFIRMED`/`FAILED`). Calcula `commission = amount * PAYMENT_COMMISSION_RATE`, `operatorAmount = amount - commission`; persiste. Invoca `PaymentGateway.createPaymentIntent(payment)`. 200 `{gatewayData}`.

```gherkin
Scenario: CLIENT dueño inicializa pago PENDING
  Given Payment PENDING, CLIENT dueño del service
  When POST /payments/:id/init
  Then 200, commission y operatorAmount persistidos, gatewayData retornado
Scenario: no-dueño → 403
  Given Payment PENDING, CLIENT no dueño
  When POST /payments/:id/init
  Then 403
Scenario: Payment ya CONFIRMED → 409
  Given Payment CONFIRMED
  When POST /payments/:id/init
  Then 409 { code: 'ALREADY_PROCESSED' }
```

### REQ-002: `POST /payments/webhook`

Público sin `requireAuth` (firma/token en cambio-007+). Body `paymentWebhookSchema` (`paymentId` string req, `status` enum `CONFIRMED`|`FAILED` req, `gatewayReference`? string). Idempotente: si ya `CONFIRMED`/`FAILED` → 200 sin mutar. Si `PENDING` → transiciona, recalcula `commission`/`operatorAmount`, persiste. 404 inexistente, 400 payload inválido.

```gherkin
Scenario: webhook CONFIRMED sobre PENDING
  Given Payment PENDING
  When POST /payments/webhook { paymentId, status: 'CONFIRMED' }
  Then 200, Payment CONFIRMED, commission recalculado
Scenario: webhook duplicado → idempotente sin mutación
  Given Payment CONFIRMED
  When POST /payments/webhook { paymentId, status: 'CONFIRMED' }
  Then 200, Payment permanece CONFIRMED sin recalcular
Scenario: Payment inexistente → 404
  When POST /payments/webhook { paymentId: 'no-existe', status: 'CONFIRMED' }
  Then 404
Scenario: payload inválido → 400
  When POST /payments/webhook { status: 'CONFIRMED' }
  Then 400 { code: 'VALIDATION_ERROR' }
```

### REQ-003: Cálculo de comisión

`calculateCommission(amount, rate)` pura: `commission = round(amount * rate / 100)`, `operatorAmount = amount - commission`, donde `rate` es **porcentaje entero** (0..100). `rate` desde env `PAYMENT_COMMISSION_RATE` (default `0` para Demo). Aplica en init; recalcula en webhook confirm.

```gherkin
Scenario: comisión 10% sobre 5000
  When calculateCommission(5000, 10)
  Then commission=500, operatorAmount=4500
Scenario: default rate 0 cuando env ausente (Demo)
  Given PAYMENT_COMMISSION_RATE no definido
  When se parsea env
  Then rate === 0
Scenario: comisión 0 sobre 5000 (Demo)
  When calculateCommission(5000, 0)
  Then commission=0, operatorAmount=5000
```

### REQ-004: Estados y transiciones de Payment

Transiciones válidas: `PENDING → CONFIRMED`, `PENDING → FAILED`. `CONFIRMED` y `FAILED` terminales. Otras transiciones: idempotencia webhook (200 sin mutar).

```gherkin
Scenario: PENDING → FAILED vía webhook
  Given Payment PENDING
  When POST /payments/webhook { status: 'FAILED' }
  Then 200, Payment FAILED
Scenario: FAILED es terminal — webhook posterior idempotente
  Given Payment FAILED
  When POST /payments/webhook { status: 'CONFIRMED' }
  Then 200, Payment permanece FAILED
```

### REQ-005: Interfaz `PaymentGateway` + `StubPaymentGateway`

`PaymentGateway` SHALL exponer `createPaymentIntent(payment) → {gatewayData}` y `verifyPayment(payload) → {status, reference}`. `StubPaymentGateway` devuelve `initPoint` ficticio, aprueba todo webhook. Factoría `getPaymentGateway()` por env `PAYMENT_GATEWAY` (default `stub`).

```gherkin
Scenario: stub createPaymentIntent retorna initPoint
  When stubGateway.createPaymentIntent(payment)
  Then { gatewayData: { initPoint: 'https://pago.stub/...' } }
Scenario: factoría selecciona stub por default
  Given PAYMENT_GATEWAY no definido
  When getPaymentGateway()
  Then retorna StubPaymentGateway
```

---

**Cobertura:** REQ-003/005 unit; REQ-001/002/004 unit+db smoke (supertest). **Next:** etapa `design`.
