# Proposal: Cambio-007 — Integración MercadoPago real

**Change ID:** `cambio-007-mercadopago` · **Etapa:** Propose · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-007-mercadopago/exploration.md`

## Intent

`cambio-006` entregó el flujo de pago con `StubPaymentGateway` y un seam (`PaymentGateway` + factory por env) para cambiar de proveedor sin tocar endpoints. El branch `PAYMENT_GATEWAY=mercadopago` lanza `Unknown payment gateway`. Este cambio implementa `MercadoPagoGateway` real (SDK oficial + HMAC del webhook) seleccionable vía `env`, respetando contrato REST y specs de `cambio-006`.

## Capabilities

### New Capabilities

- _Ninguna._ `payment-lifecycle` ya existe desde `cambio-006`.

### Modified Capabilities

- `payment-lifecycle` (delta): la verificación del webhook pasa a ser gateway-specific — `StubPaymentGateway` conserva `X-Webhook-Token` (shared-secret) y `MercadoPagoGateway` usa `WebhookSignatureValidator` (HMAC) con reverse-lookup `mpPaymentId → payment.id`. Los REQs existentes (init, path `/webhook`, idempotencia, 200, guard 409) **no regresan**.

## In Scope

- Instalar paquete `mercadopago` (SDK oficial, versión fijada `~2.x`).
- `MercadoPagoGateway implements PaymentGateway`: `initPayment` → `Preference.create` (items, `external_reference=payment.id`, `notification_url`); `processWebhook` → HMAC (`WebhookSignatureValidator`) + `ipn.manage` + reverse-lookup `mpPaymentId` + mapeo estados MP→dominio (`approved→CONFIRMED`, `rejected|cancelled|refunded→FAILED`, no terminales ignorados).
- `paymentFactory.ts`: branch `'mercadopago'` → `new MercadoPagoGateway(...)`.
- `env.ts`: agregar `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_SANDBOX` (requeridas en prod/dev con `PAYMENT_GATEWAY=mercadopago`; default seguro en `test`).
- Refactor interno de `POST /webhook`: delegar verificación+parseo a `gateway.processWebhook(req)`; el contrato REST (path, body, códigos 200/400/401/404/409, idempotencia) no cambia.
- `MercadoPagoGateway` recibe `PrismaClient` por constructor (única dependencia stateful).
- Tests unitarios con SDK mockeado; tests existentes de stub y DB smoke siguen en verde.

## Out of Scope

- Refunds / cancelación de pago.
- Marketplace / split payment (`application-fee`).
- Configuración del dashboard de MP (alta de webhook, credenciales prod).
- Suscripciones / pagos recurrentes.
- Retry/backoff, circuit breaker, idempotency keys a MP (→ `cambio-008`).
- Tests de integración sandbox MP (opcional, gateados por credenciales).

## Risks / Tradeoffs

| Riesgo                                            | Prob | Mitigación                                                                                       |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| Reverse-lookup `mpPaymentId → payment.id` frágil  | Med  | Test ida y vuelta `init → mpPaymentId → webhook → lookup`.                    |
| Breaking change del SDK entre versiones mayores   | Med  | Fijar `~2.x` en `package.json`; lockfile versionado.                                      |
| Sandbox ≠ prod (`init_point` vs `sandbox_init_point`) | Med  | Flag `MP_SANDBOX` explícito; integration tests MP solo sandbox.            |
| Refactor webhook rompe tests stub existentes      | Med  | `paymentGateway.test.ts` + `payments.lifecycle.test.ts` verdes antes de merge. |
| Dependencia externa adicional de vendor           | Bajo | Aceptada: SDK oficial reduce bugs de seguridad y mantiene tipos TS.            |

## Open Questions

- ¿`notification_url` hardcodeada o derivada de `env` (`PUBLIC_BASE_URL`)? Recommend: `env` (dev con tunnel).
- ¿Estados no terminales MP → 200 sin mutar como REQ nueva del delta? Recommend: sí.
- ¿`MP_SANDBOX` default por `NODE_ENV` (`dev→true`, `prod→false`) o siempre explícito? Recommend: derivado, sobreescribible.

## Ready for Spec

**Sí.** La interfaz `PaymentGateway` se respeta sin expandirse; el contrato REST y el guard 409 no se tocan; el Enfoque A (SDK oficial) minimiza superficie de seguridad y mantenimiento; las variables de entorno y la estrategia de testing están definidas con defaults seguros.

**Próximo paso:** `sdd-spec` para el delta de `payment-lifecycle`.