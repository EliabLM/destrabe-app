# Exploration — Cambio-006: Flujo de Pago

**Change ID:** `cambio-006-pagos`
**Etapa SDD:** Explore
**Branch:** `develop`
**Basado en:** `backend/src/routes/quotes.routes.ts` (Payment stub L228-248), `backend/prisma/schema.prisma` (modelo `Payment`), propuesta cambio-005 ("Pago como stub para cambio-006 (Mercado Pago)"), exploration cambio-005 §3 ("Payment stub cierra ciclo de datos"), `backend/src/services/serviceMachine.ts` (FSM actual).

## Current State

El cambio-005 (quotes) cerró el núcleo Demo del ciclo de servicio: operador cotiza → cliente acepta → servicio `ACTIVE`. En ese momento se crea un **Payment stub** (`quotes.routes.ts` L238-248) con:

```
amount         = quote.amount
commission     = 0           ← placeholder explícito
operatorAmount = quote.amount ← sin descontar comisión
status         = PENDING
mpPaymentId    = null
```

Fuera de ese stub, **no existe flujo de pago alguno**:

- **No hay endpoints de pago**: ni rutas `payments.routes.ts`, ni webhooks, ni handlers de confirmación. `routes/index.ts` solo monta `servicesRouter`, `serviceQuotesRouter` y `quotesAcceptRouter`.
- **No hay integración con MercadoPago** (`mercadopago` o similar): `backend/package.json` no tiene dependencia de MP. Las props del cambio-005 dicen explícitamente "Pago como stub para cambio-006 (Mercado Pago)".
- **No hay cálculo de comisión**: `commission` es `0` hardcodeado en `quotes.routes.ts` L242. No existe tabla `Config` ni env var `PLATFORM_COMMISSION_PCT`.
- **No hay validación de pago antes de COMPLETED**: la FSM (`serviceMachine.ts`) permite `ACTIVE → COMPLETED` por `OPERATOR` sin verificar `Payment.status`. El operador puede completar el servicio sin que el cliente haya pagado.
- **`PaymentStatus` enum** (`shared/src/types/payment.ts`): `PENDING | CONFIRMED | FAILED | REFUNDED`. Definido desde cambio-002, solo `PENDING` se usa en runtime.
- **Modelo `Payment`** (Prisma): `id, serviceId (@unique), mpPaymentId? (@unique), amount, commission, operatorAmount, status, createdAt, updatedAt`. Campos lista para poblarse con datos reales.
- **Schema shared**: `payment.schema.ts` solo contiene `paymentStatusSchema = z.nativeEnum(PaymentStatus)`. Sin schemas de request/response para init, confirm, o webhook.

En resumen: el modelo de datos está completo, el Payment stub se crea al aceptar, y el contrato "cambio-006 implementa el pago" fue explícito en cambio-005. El cambio-006 debe convertir ese stub en un flujo de pago funcional.

## Affected Areas

| Archivo | Estado | Impacto |
|---|---|---|
| `backend/src/routes/payments.routes.ts` | **Nuevo** | Endpoints de pago: init, confirm, webhook (según approach). |
| `backend/src/routes/index.ts` | Modificado | Montar `paymentsRouter`. |
| `backend/src/services/paymentGateway.ts` | **Nuevo** | Interfaz `PaymentGateway` + implementación(es) según approach. |
| `backend/src/services/commission.ts` | **Nuevo** | Cálculo de comisión (desde env var o futura tabla Config). |
| `shared/src/schemas/payment.schema.ts` | Modificado | Ampliar con schemas de request/response para endpoints de pago. |
| `shared/src/types/payment.ts` | Modificado | Tipos inferidos `z.infer` para nuevos schemas. |
| `backend/src/lib/env.ts` | Modificado | Añadir `PLATFORM_COMMISSION_PCT` (u otras vars según approach). |
| `backend/src/services/serviceMachine.ts` | **Sin cambios** | La FSM no tiene transición `PAID`; el pago es un proceso paralelo al ciclo de vida del servicio (a discutir en propuesta). |
| `backend/src/routes/quotes.routes.ts` | **Sin cambios** | El Payment stub se crea igual; el flujo de pago lo toma desde `PENDING`. |
| `backend/src/routes/services.routes.ts` | **Evaluar** | ¿El `PATCH /:id/status` (ACTIVE→COMPLETED) debe validar `Payment.status === CONFIRMED`? (pregunta abierta para propuesta). |
| `backend/__tests__/` | **Nuevo** | Unit: `paymentGateway.test.ts`, `commission.test.ts`. DB smoke: `payments.lifecycle.test.ts` (flujo init→webhook→CONFIRMED). |
| `backend/prisma/schema.prisma` | **Sin cambios** | El modelo `Payment` ya está completo. `PaymentStatus` enum cubre el flujo. |
| `backend/package.json` | **Sin cambios** (stub) / **Modificado** (MP real) | Solo si se integra SDK de MercadoPago. |

## Approaches

### Approach A: Confirmación manual por operador/admin (sin gateway externo)

| | |
|---|---|
| **Descripción** | Endpoint `POST /payments/:id/confirm` accesible por `OPERATOR` o `ADMIN`. Marca el pago como `CONFIRMED` y recalcula `commission` + `operatorAmount` desde una env var `PLATFORM_COMMISSION_PCT` (default 10%). Sin integración externa ni webhooks. |
| **Pros** | - Mínimo código nuevo: 1 endpoint + cálculo de comisión.<br>- Sin dependencias externas ni webhook debugging.<br>- Funcional para Demo: el operador "cobra" y confirma el pago.<br>- Ideal si el próximo cambio (cambio-007) será MercadoPago real con rediseño. |
| **Cons** | - Sin abstracción: el endpoint acopla confirmación y cálculo de comisión.<br>- No emula un flujo real de pago (init point, webhook de vuelta).<br>- El modelo `mpPaymentId` queda sin usar.<br>- Migrar a MP real requeriría reescribir el endpoint, no solo cambiar un gateway. |
| **Effort** | **Bajo** |

### Approach B: MercadoPago real (Checkout Pro + Webhook IPN)

| | |
|---|---|
| **Descripción** | Integrar SDK `mercadopago` (npm). Endpoint `POST /payments/:id/preference` → crea `Preference` en MP, devuelve `init_point` (URL de checkout). Webhook `POST /payments/webhook` → recibe notificación IPN de MP, verifica firma, actualiza `Payment.status` a `CONFIRMED` o `FAILED`. Comisión desde env var. `mpPaymentId` se popula desde la response de MP. |
| **Pros** | - Pago productivo desde el inicio. El flujo es completo y real.<br>- El modelo `Payment` se usa en su totalidad (incl. `mpPaymentId`).<br>- No requiere migración posterior: ya está integrado. |
| **Cons** | - Complejidad alta: SDK, Preference API, webhook IPN, verificación de firma, idempotencia, reintentos.<br>- Dependencia externa: credenciales de sandbox MP, ngrok o URL pública para webhook en dev local.<br>- Over-scope para Demo: el resto del sistema (notificaciones, perfil, admin) aún es stub.<br>- Webhook debugging en local es frágil. |
| **Effort** | **Alto** |

### Approach C: Gateway de pago con implementación stub (→ MercadoPago futuro)

| | |
|---|---|
| **Descripción** | Definir interfaz `PaymentGateway` con métodos `createPaymentIntent(amount, serviceId) → { paymentId, initPoint }` y `verifyPayment(notification) → { status, mpPaymentId? }`. Implementación `StubPaymentGateway` que devuelve un `init_point` falso (`https://pago.stub/...`) y siempre confirma (`CONFIRMED`) en el webhook simulado. Endpoints `POST /payments/:id/init` (CLIENT) y `POST /payments/webhook` (público/sistema). El webhook recibe una notificación genérica que el gateway stub siempre aprueba; para MP real, el gateway verificaría la firma IPN. Cambio-006 entrega con gateway stub; cuando se quiera MP real (cambio-007+), solo se implementa `MercadoPagoGateway` y se cambia vía env var `PAYMENT_GATEWAY=mercadopago`. |
| **Pros** | - Arquitectura limpia (patrón Strategy/Gateway). El stub es funcional para Demo sin dependencias externas.<br>- Alineado con el patrón del proyecto: cambio-004/005 usan stubs para notificaciones y comisión; este gateway es la versión estructurada de ese mismo patrón.<br>- Fácil de testear unitariamente (mock del gateway).<br>- El switch a MP real no requiere cambiar endpoints ni rutas, solo la implementación del gateway.<br>- El flujo end-to-end (init → webhook → CONFIRMED) se puede validar con tests db smoke. |
| **Cons** | - Más archivos: interfaz (1), implementación stub (1), tests (2+). Abstracción adicional vs. approach A.<br>- Si MP real requiere parámetros muy distintos, la interfaz podría necesitar evolución (mitigable: la interfaz es mínima).<br>- El endpoint webhook es genérico; requiere un diseño cuidadoso del payload de notificación para que tanto stub como MP encajen. |
| **Effort** | **Medio** |

## Recommendation

**Approach C — Gateway de pago con implementación stub.**

El approach C es la opción más alineada con el estado Demo del proyecto y el patrón de stubs ya establecido (notificaciones log-only, commission=0). Provee un flujo de pago funcional end-to-end sin dependencia externa, mientras establece una abstracción limpia (`PaymentGateway`) que MercadoPago real podrá implementar en un cambio futuro sin tocar endpoints ni rutas.

**Flujo propuesto para cambio-006 (gateway stub):**

```
CLIENT ─POST /payments/:id/init──▶ gateway.createPaymentIntent(amount, serviceId)
                                      └▶ StubPaymentGateway: devuelve { paymentId, initPoint: 'https://pago.stub/...' }
                                      └▶ Actualiza Payment.mpPaymentId (stub id)
                                      └▶ Responde { initPoint } al frontend

(El cliente "paga" en el init_point falso — el frontend simula redirección)

Sistema ─POST /payments/webhook──▶ gateway.verifyPayment({ paymentId: 'stub-...' })
                                      └▶ StubPaymentGateway: siempre CONFIRMED
                                      └▶ Actualiza Payment.status = CONFIRMED
                                      └▶ Recalcula commission + operatorAmount
```

**Lo que NO incluye cambio-006:**
- SDK de MercadoPago ni credenciales reales.
- Webhook con verificación de firma criptográfica.
- `MercadoPagoGateway` (queda para cambio-007+).
- Cambios en la FSM (`serviceMachine.ts`): el pago es un proceso paralelo al ciclo de vida del servicio. `ACTIVE → COMPLETED` no se bloquea por pago pendiente en este cambio (ver riesgo abajo).

## Risks

| Riesgo | Prob | Mitigación |
|---|---|---|
| **Pago no validado antes de COMPLETED** | Alta | El flujo actual permite `ACTIVE → COMPLETED` sin verificar `Payment.status === CONFIRMED`. Para Demo esto es aceptable (el operador confirma el pago antes de completar). La propuesta debe decidir si se añade un guard en `PATCH /services/:id/status` o se deja para cambio-007. |
| **Scope creep hacia MP real** | Media | Tentación de implementar `MercadoPagoGateway` en el mismo cambio. Mitigación: el spec debe declarar explícitamente que `MercadoPagoGateway` es out-of-scope. La interfaz `PaymentGateway` se diseña para que quepa MP, pero solo se implementa el stub. |
| **Interfaz PaymentGateway sub-especificada** | Media | Si MP requiere parámetros extra (e.g., `notification_url`, `external_reference`, `payer`), la interfaz podría no ser suficiente. Mitigación: revisar la API de MP Preference antes de diseñar la interfaz; incluir campos opcionales (`metadata?: Record<string, unknown>`) para extensibilidad. |
| **Comisión solo desde env var** | Baja | `PLATFORM_COMMISSION_PCT` es un número fijo. En el futuro podría necesitar lógica por `truckType` o tabla `Config`. Mitigación: función `calculateCommission(amount, pct)` pura y testeable; si la lógica cambia, solo se modifica esa función. |
| **Webhook sin autenticación (stub)** | Baja | El webhook stub no verifica firma. Si se expone en producción sin MP, cualquiera podría marcar pagos como CONFIRMED. Mitigación: en entorno `production` con gateway stub, el webhook debe estar deshabilitado o protegido por `requireAuth`/API key interna. |

## Ready for Proposal

**Yes**, con una pregunta para el usuario antes de la fase `propose`:

> **¿El operador debe poder completar el servicio (`ACTIVE → COMPLETED`) sin que el pago esté `CONFIRMED`?**  
> - **Opción A (Demo-friendly):** Sin bloqueo. El pago es un proceso paralelo. El operador completa cuando el trabajo físico termina, independientemente del estado del pago. Esto es lo que permite el código actual.  
> - **Opción B (Estricto):** `PATCH /services/:id/status` rechaza `ACTIVE → COMPLETED` con 409 `PAYMENT_PENDING` si `Payment.status !== CONFIRMED`. Bloquea el flujo hasta que el cliente pague.

Esta decisión define si `services.routes.ts` necesita cambios en cambio-006 o no.
