# Spec — 16: pago simulado en el backend

**Basado en:** `docs/proposals/16-pago-simulado/proposal.md` · **Capability:** `payment-lifecycle` (modificada) y `service-lifecycle` (detalle)

## REQ-PS-001: el detalle del servicio incluye el pago

`GET /services/:id` añade `payment: { id, status, amount, commission } | null` para el cliente dueño (y ADMIN, que ya ve el detalle completo) y para el operador asignado. La vista previa de un operador no asignado no lo incluye. Un tercero sigue recibiendo 404.

```gherkin
Escenario: el dueño ve el pago
  Dado un servicio ACTIVE con su Payment PENDING
  Cuando el cliente dueño pide GET /services/:id
  Entonces la respuesta incluye payment con id, status, amount y commission

Escenario: el operador asignado ve el pago
  Cuando el operador asignado pide GET /services/:id
  Entonces la respuesta incluye payment

Escenario: un operador no asignado no ve el pago
  Dado un servicio abierto a cotización
  Cuando otro operador pide GET /services/:id
  Entonces recibe la vista previa sin payment

Escenario: otro cliente no ve nada
  Cuando otro cliente pide GET /services/:id
  Entonces responde 404
```

## REQ-PS-002: simular el resultado de un pago

`POST /payments/:id/simulate`, cuerpo `{ result: "approved" | "rejected" }`. Responde 200 `{ id, status }`.

- Requiere sesión (401 sin ella).
- 404 si `PAYMENT_GATEWAY` no es `stub`, si el flag `pagoSimulado` no está activo para el usuario, si el pago no existe o si el usuario no es el cliente dueño del servicio. El 404 no revela si el pago o la ruta existen.
- 400 `VALIDATION_ERROR` si `result` no es `approved` ni `rejected`.
- 409 `ALREADY_PROCESSED` si el pago no está `PENDING`.
- `approved` → `CONFIRMED`; `rejected` → `FAILED`. La transición es la misma del webhook: solo cambia el pago si sigue `PENDING`.

```gherkin
Escenario: el dueño aprueba y el operador completa
  Dado un servicio ACTIVE con Payment PENDING y el flag activo para el dueño
  Cuando el dueño envía { result: "approved" }
  Entonces el pago queda CONFIRMED
  Y el operador asignado puede pasar el servicio a COMPLETED

Escenario: el dueño rechaza
  Cuando el dueño envía { result: "rejected" }
  Entonces el pago queda FAILED
  Y el servicio sigue ACTIVE
  Y el operador recibe 409 PAYMENT_PENDING si intenta completarlo

Escenario: otro cliente → 404
Escenario: flag apagado → 404
Escenario: PAYMENT_GATEWAY=mercadopago → 404
Escenario: pago ya CONFIRMED o FAILED → 409 ALREADY_PROCESSED
```

**Estado tras un rechazo:** el pago `FAILED` es terminal (igual que con el webhook) y el servicio se queda `ACTIVE`, sin poder completarse. Reintentar el pago o cancelar el servicio activo queda para otro issue.

## REQ-PS-003: `init` con el stub indica pago simulado

Con `PAYMENT_GATEWAY=stub`, `POST /payments/:id/init` responde `{ gatewayPaymentId, simulated: true }` sin `redirectUrl`. Con MercadoPago no cambia.

## REQ-PS-004: token del webhook stub en tiempo constante

El stub compara `X-Webhook-Token` con `PAYMENT_WEBHOOK_TOKEN` con `timingSafeEqual` (sobre resúmenes SHA-256, para no fallar ni filtrar la longitud). Token ausente o distinto → 401, como hoy.
