# Design — 16: pago simulado en el backend

**Spec:** `docs/specs/16-pago-simulado/spec.md`. Sin migración Prisma.

## D1 — Transición compartida

Nuevo `backend/src/services/paymentSettlement.ts` con `settlePendingPayment(id, status, gatewayReference?)`:
`prisma.payment.updateMany({ where: { id, status: 'PENDING' }, data })` y devuelve `true` si cambió una fila. El webhook y la simulación la usan; ninguno vuelve a escribir el `update` por su cuenta.

- Webhook: si no cambió nada (otro proceso lo cerró antes), relee el pago y responde su estado (idempotente, como hoy).
- Simulación: si no cambió nada, 409 `ALREADY_PROCESSED`.

## D2 — Ruta de simulación

En `payments.routes.ts`:

```
POST /payments/:id/simulate
  requireAuth → requireStubGateway (404) → requireFeature('pagoSimulado') (404)
  → validate(simulatePaymentSchema, 'body') (400) → handler
```

`requireStubGateway` lee `env.PAYMENT_GATEWAY` en cada petición. El handler busca el pago con `service.client`; inexistente o de otro cliente → 404. Estado distinto de `PENDING` → 409. Luego `settlePendingPayment`.

`simulatePaymentSchema` va en `shared/src/schemas/payment.schema.ts` para que la app lo reutilice.

## D3 — Detalle con pago

`GET /services/:id` añade `payment: { select: { id, status, amount, commission } }` al `include`. Dueño/ADMIN y operador asignado lo reciben tal cual; `toOperatorPreview` ya filtra por lista blanca, así que la vista previa no lo expone.

## D4 — `init` del stub

`PaymentGateway.initPayment` devuelve `{ gatewayPaymentId, redirectUrl?, simulated? }`. El stub devuelve `simulated: true` sin URL; la ruta lo pasa a la respuesta solo si viene. `initPaymentResponseSchema` añade `simulated` opcional.

## D5 — Token en tiempo constante

`createHash('sha256')` de los dos valores y `timingSafeEqual` (de `node:crypto`). Los resúmenes miden lo mismo, así que no hay excepción por longitudes distintas.

## Pruebas

- Unitarias con Prisma simulado (`payments.simulate.routes.test.ts`, `services.operatorAccess.routes.test.ts`, `paymentGateway.test.ts`): corren en local y en "Checks rápidos".
- BD (`db/payments.lifecycle.test.ts`): flujo completo aprobar → completar y rechazo; corren en "Contratos DB" (el VPS no tiene Postgres de pruebas).
