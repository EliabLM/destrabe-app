# Spec Delta MODIFY — Cambio-007: Integración MercadoPago (`payment-lifecycle`)

**Change ID:** `cambio-007-mercadopago` · **Etapa SDD:** Spec · **Branch:** `develop`
**Spec padre:** [`docs/specs/cambio-006-pagos/spec.md`](../cambio-006-pagos/spec.md) (FULL spec `payment-lifecycle`)
**Propuesta:** [`docs/proposals/cambio-007-mercadopago/proposal.md`](../../proposals/cambio-007-mercadopago/proposal.md)
**Exploración:** [`docs/proposals/cambio-007-mercadopago/exploration.md`](../../proposals/cambio-007-mercadopago/exploration.md)

> Delta **MODIFY** sobre la capacidad `payment-lifecycle` (cambio-006). Los REQs no listados aquí (REQ-003 comisión, REQ-004 estados/transiciones) permanecen **sin cambios**. El contrato REST público (`POST /:id/init`, `POST /webhook`, códigos 200/400/401/404/409, guard 409 `PAYMENT_PENDING`) **no regresa**.

---

## MODIFIED Requirements

### REQ-001: `POST /payments/:id/init`

`requireAuth`+`requireRole(CLIENT)`. CLIENT MUST ser dueño del service (403 ajeno). Payment MUST existir `PENDING` (404 inexistente, 409 `ALREADY_PROCESSED` si `CONFIRMED`/`FAILED`). Calcula `commission = amount * PAYMENT_COMMISSION_RATE`, `operatorAmount = amount - commission`; persiste. Invoca `PaymentGateway.initPayment(payment)`. 200 `{gatewayData}`.

(Previously: igual contrato público; ahora `initPayment` delega creación de Preference al gateway concreto. En modo `mercadopago`, el gateway inyecta `notification_url = MP_WEBHOOK_URL + '/payments/webhook'` y `external_reference = payment.id` en la Preference.)

#### Scenario: CLIENT dueño inicializa pago PENDING

- Given Payment PENDING, CLIENT dueño del service
- When POST /payments/:id/init
- Then 200, commission y operatorAmount persistidos, gatewayData retornado

#### Scenario: no-dueño → 403

- Given Payment PENDING, CLIENT no dueño
- When POST /payments/:id/init
- Then 403

#### Scenario: Payment ya CONFIRMED → 409

- Given Payment CONFIRMED
- When POST /payments/:id/init
- Then 409 `{ code: 'ALREADY_PROCESSED' }`

#### Scenario: init en modo MercadoPago persiste mpPaymentId

- Given `PAYMENT_GATEWAY=mercadopago`, Payment PENDING
- When POST /payments/:id/init
- Then Preference creada con `notification_url`, `external_reference=payment.id`; `payment.mpPaymentId` persistido como `preference.id`

### REQ-002: `POST /payments/webhook`

Público sin `requireAuth`. La verificación de autenticidad del webhook es **gateway-specific**: `StubPaymentGateway` valida `X-Webhook-Token` contra `PAYMENT_WEBHOOK_TOKEN` (shared-secret, comportamiento de cambio-006 sin cambios); `MercadoPagoGateway` valida HMAC vía `WebhookSignatureValidator` usando `x-signature` + `x-request-id` headers + `data.id` query param. El route delega verificación y parseo a `gateway.processWebhook(req)`. Idempotente: si ya `CONFIRMED`/`FAILED` → 200 sin mutar. Si `PENDING` → transiciona, recalcula `commission`/`operatorAmount`, persiste. 401 firma inválida, 404 inexistente, 400 payload inválido.

(Previously: verificación inline con `X-Webhook-Token` hardcodeada en el route; ahora delegada al gateway.)

#### Scenario: webhook CONFIRMED sobre PENDING

- Given Payment PENDING
- When POST /payments/webhook con firma/token válido y `status: 'CONFIRMED'`
- Then 200, Payment CONFIRMED, commission recalculado

#### Scenario: webhook duplicado → idempotente sin mutación

- Given Payment CONFIRMED
- When POST /payments/webhook con firma/token válido y `status: 'CONFIRMED'`
- Then 200, Payment permanece CONFIRMED sin recalcular

#### Scenario: Payment inexistente → 404

- When POST /payments/webhook con paymentId inexistente
- Then 404

#### Scenario: payload inválido → 400

- When POST /payments/webhook con body inválido
- Then 400 `{ code: 'VALIDATION_ERROR' }`

### REQ-005: Interfaz `PaymentGateway` + factoría

`PaymentGateway` SHALL exponer `initPayment(payment) → {gatewayData}` y `processWebhook(req) → {paymentId, status, gatewayReference?}`. `StubPaymentGateway` devuelve `initPoint` ficticio y verifica `X-Webhook-Token`. `MercadoPagoGateway` crea Preference vía SDK oficial y verifica HMAC. Factoría `getPaymentGateway()` selecciona por `PAYMENT_GATEWAY`: `'stub'` (default) → `StubPaymentGateway`; `'mercadopago'` → `MercadoPagoGateway` (inyecta `PrismaClient`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_SANDBOX`).

(Previously: interfaz idéntica pero solo `StubPaymentGateway` implementado; factory lanzaba error para `'mercadopago'`.)

#### Scenario: stub createPaymentIntent retorna initPoint

- When stubGateway.initPayment(payment)
- Then `{ gatewayData: { initPoint: 'https://pago.stub/...' } }`

#### Scenario: factoría selecciona stub por default

- Given `PAYMENT_GATEWAY` no definido
- When getPaymentGateway()
- Then retorna StubPaymentGateway

#### Scenario: factoría selecciona MercadoPagoGateway

- Given `PAYMENT_GATEWAY=mercadopago`, credenciales MP presentes
- When getPaymentGateway()
- Then retorna MercadoPagoGateway con PrismaClient y config inyectados

---

## ADDED Requirements

### REQ-MP-ENV: Variables de entorno MercadoPago

Cuando `PAYMENT_GATEWAY=mercadopago` y `NODE_ENV=production`, el sistema MUST validar en startup: `MP_ACCESS_TOKEN` (requerido), `MP_WEBHOOK_SECRET` (requerido), `MP_WEBHOOK_URL` (requerido, URL pública HTTPS que MP usa como callback). `MP_SANDBOX` SHALL default a `true` cuando `NODE_ENV !== 'production'`; en producción es opcional (default `false`). Cuando `PAYMENT_GATEWAY=stub`, todas las variables `MP_*` son opcionales. La validación MUST seguir el patrón TDD de `env.test.ts` (cambio-006 T2).

#### Scenario: env válido en producción con MP

- Given `NODE_ENV=production`, `PAYMENT_GATEWAY=mercadopago`
- When se parsean `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_WEBHOOK_URL` presentes
- Then env parseado sin error

#### Scenario: falta MP_ACCESS_TOKEN en producción → error

- Given `NODE_ENV=production`, `PAYMENT_GATEWAY=mercadopago`, `MP_ACCESS_TOKEN` ausente
- When se parsea env
- Then error de validación con mensaje claro

#### Scenario: MP_SANDBOX default true en desarrollo

- Given `NODE_ENV=development`, `MP_SANDBOX` no definido
- When se parsea env
- Then `MP_SANDBOX === true`

#### Scenario: MP vars opcionales con stub

- Given `PAYMENT_GATEWAY=stub`, sin variables `MP_*`
- When se parsea env
- Then env parseado sin error

### REQ-MP-REVERSELOOKUP: Resolución mpPaymentId → payment.id

`MercadoPagoGateway.processWebhook` MUST resolver el `payment.id` interno vía reverse-lookup del `mpPaymentId` recibido de MP en la base de datos (Prisma `Payment.mpPaymentId @unique`). Si el lookup falla (MP envía un `mpPaymentId` no asociado a ningún Payment local), el gateway MUST loggear el evento y retornar 404 al route. El lookup MUST ser idempotente ante retries de MP (múltiples notificaciones para el mismo `mpPaymentId`).

#### Scenario: reverse-lookup exitoso

- Given Payment con `mpPaymentId='mp-123'` existe en BD
- When processWebhook recibe notificación con `data.id='mp-123'`
- Then resuelve `paymentId` interno correctamente

#### Scenario: reverse-lookup miss → 404 loggeado

- Given ningún Payment con `mpPaymentId='mp-unknown'`
- When processWebhook recibe notificación con `data.id='mp-unknown'`
- Then 404, evento loggeado con `mpPaymentId` y headers para diagnóstico

#### Scenario: retry de MP → idempotente

- Given Payment ya CONFIRMED con `mpPaymentId='mp-123'`
- When processWebhook recibe segunda notificación con `data.id='mp-123'`
- Then 200 sin mutación (idempotencia del REQ-002 aplica)

### REQ-MP-NOTIFICATION: Estados no terminales de MP

Cuando MP notifica un estado no terminal (`pending`, `in_process`, `in_mediation`), `MercadoPagoGateway.processWebhook` MUST NOT transicionar el Payment local. El gateway retorna `{ status: 'ignored' }` al route, que responde 200 OK sin mutar la BD. Solo estados terminales (`approved` → `CONFIRMED`; `rejected`, `cancelled`, `refunded` → `FAILED`) disparan transición local. Esto protege el invariante del ciclo de vida: `PENDING → (approved → CONFIRMED) | (rejected → FAILED)`, sin transiciones intermedias.

#### Scenario: notificación pending → 200 ignored

- Given Payment PENDING con `mpPaymentId='mp-123'`
- When MP notifica `status='pending'`
- Then 200 `{ status: 'ignored' }`, Payment permanece PENDING

#### Scenario: notificación in_process → 200 ignored

- Given Payment PENDING con `mpPaymentId='mp-123'`
- When MP notifica `status='in_process'`
- Then 200 `{ status: 'ignored' }`, Payment permanece PENDING

#### Scenario: notificación approved → CONFIRMED

- Given Payment PENDING con `mpPaymentId='mp-123'`
- When MP notifica `status='approved'`
- Then 200, Payment transiciona a CONFIRMED, commission recalculado

#### Scenario: notificación rejected → FAILED

- Given Payment PENDING con `mpPaymentId='mp-123'`
- When MP notifica `status='rejected'`
- Then 200, Payment transiciona a FAILED

---

## Requisitos sin cambios (informativo)

| REQ     | Descripción                                                               | Estado      |
| ------- | ------------------------------------------------------------------------- | ----------- |
| REQ-003 | Cálculo de comisión (`calculateCommission`)                               | Sin cambios |
| REQ-004 | Estados y transiciones de Payment (`PENDING→CONFIRMED`, `PENDING→FAILED`) | Sin cambios |

---

## Cobertura de escenarios

| Categoría                                                        | Estado         |
| ---------------------------------------------------------------- | -------------- |
| Happy paths (init MP, webhook approved, reverse-lookup)          | ✅ Cubiertos   |
| Edge cases (retry MP, no-terminal states, sandbox default)       | ✅ Cubiertos   |
| Error states (firma inválida 401, lookup miss 404, env faltante) | ✅ Cubiertos   |
| Idempotencia (webhook duplicado, retry MP)                       | ✅ Cubiertos   |
| Regresión REQ-003/004                                            | ✅ Sin cambios |

**Próximo paso:** `sdd-design` para arquitectura de `MercadoPagoGateway`, refactor del webhook route, y estrategia de testing.
