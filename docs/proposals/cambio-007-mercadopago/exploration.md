# Exploration — Cambio-007: Integración MercadoPago real

**Change ID:** `cambio-007-mercadopago`
**Etapa SDD:** Explore
**Branch:** `develop`
**Basado en:** `docs/designs/cambio-006-pagos/design.md` (D1-D5), `backend/src/services/paymentGateway.ts`, `backend/src/services/paymentFactory.ts`, `backend/src/routes/payments.routes.ts`, `backend/src/lib/env.ts`, `shared/src/schemas/payment.schema.ts`, `backend/__tests__/paymentGateway.test.ts`, `backend/__tests__/db/payments.lifecycle.test.ts`, docs Context7 del SDK `mercadopago/sdk-nodejs`.

## Current State

cambio-006 entregó un flujo de pago end-to-end con una abstracción `PaymentGateway` + `StubPaymentGateway` + factory por env. La interfaz fue diseñada explícitamente como seam para cambiar de proveedor sin tocar endpoints ni specs (decisiones D1, D2). El stub simula:

- **`initPayment`**: retorna `gatewayPaymentId: "stub-{id}"` + `redirectUrl` ficticia
- **`processWebhook`**: parsea el payload recibido y retorna `paymentId`/`status`

El factory (`paymentFactory.ts`) ya tiene el enum de `env.ts` preparado:

```ts
// env.ts L35 — ya definido
PAYMENT_GATEWAY: z.enum(['stub', 'mercadopago']).default('stub');
```

Sin embargo, el branch `'mercadopago'` lanza `throw new Error('Unknown payment gateway')` — nunca se implementó. El paquete `mercadopago` **no está instalado** en `backend/package.json`.

### Hallazgo crítico: el webhook NO delega al gateway

Lectura detallada de `payments.routes.ts` (L93-147) revela que `POST /webhook` **nunca llama a `gateway.processWebhook()`**. El handler hace todo inline:

1. Valida `X-Webhook-Token` contra `env.PAYMENT_WEBHOOK_TOKEN` (L99-104)
2. Lee `paymentId`, `status`, `gatewayReference` directamente del body validado por Zod (L107-111)
3. Hace lookup en Prisma por `paymentId` (L113-116)
4. Aplica idempotencia y transición (L121-142)

El método `processWebhook()` de la interfaz existe pero **no se usa en runtime**. Para el stub esto funciona porque el payload de prueba ya contiene `paymentId` (nuestro ID interno) y `status`. Para MercadoPago real esto **no es viable**: MP envía notificaciones con su propio esquema (topic + id de MP), la verificación de firma HMAC es obligatoria, y el ID en la notificación es el `mpPaymentId` de MP, no nuestro `payment.id` interno.

### Alineación de la interfaz con MP

| Método de la interfaz                                                                             | ¿Soporta MP?          | Detalle                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initPayment(payment) → { gatewayPaymentId, redirectUrl? }`                                       | ✅ Sí                 | `Preference.create()` → `preference.id` = gatewayPaymentId, `preference.init_point` (o `sandbox_init_point`) = redirectUrl                                                                                                   |
| `processWebhook(payload: unknown, signature?: string) → { paymentId, status, gatewayReference? }` | ✅ Sí, con adaptación | El stub parsea `payload` como body directo. MP necesita recibir el request completo (headers + body + query params) para verificar HMAC y parsear la notificación IPN. El parámetro `signature?` ya está previsto para HMAC. |

## Affected Areas

| Archivo                                           | Por qué se afecta                                                                                                                                                        | Tipo de cambio                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `backend/src/services/paymentGateway.ts`          | Agregar clase `MercadoPagoGateway` que implemente `PaymentGateway`                                                                                                       | Create (nueva clase en archivo existente)            |
| `backend/src/services/paymentFactory.ts`          | Agregar branch `'mercadopago'` → `new MercadoPagoGateway(...)`                                                                                                           | Modify (2-3 líneas)                                  |
| `backend/src/routes/payments.routes.ts`           | `POST /webhook` debe delegar verificación+parseo al gateway vía `processWebhook(req)`; mover lógica de token check al `StubPaymentGateway.processWebhook`                | Modify (refactor interno, sin cambiar contrato REST) |
| `backend/src/lib/env.ts`                          | Agregar `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_SANDBOX`; mantener compatibilidad con `PAYMENT_WEBHOOK_TOKEN` para stub                                              | Modify                                               |
| `backend/package.json`                            | Agregar dependencia `mercadopago`                                                                                                                                        | Modify                                               |
| `backend/__tests__/paymentGateway.test.ts`        | Nuevos tests unitarios para `MercadoPagoGateway` (con SDK mockeado) + test de factory para `'mercadopago'`                                                               | Modify                                               |
| `backend/__tests__/db/payments.lifecycle.test.ts` | Sin cambios: el entorno de test usa `NODE_ENV=test` → `PAYMENT_GATEWAY=stub` por default. Los tests de integración MP requieren sandbox credentials y se gatean por env. | No change (o test MP opcional gateado)               |

### Áreas NO afectadas (el seam funciona)

| Archivo                                  | Por qué NO se toca                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /:id/init` en `payments.routes.ts` | Ya llama `gateway.initPayment()` — solo cambia la implementación detrás de la interfaz              |
| `POST /webhook` contrato REST            | 200/400/401/404/409 no cambian — solo cambia la implementación interna                              |
| `backend/src/services/commission.ts`     | Cálculo puro interno a destrabe, no depende del gateway                                             |
| `backend/src/routes/services.routes.ts`  | Guard 409 `PAYMENT_PENDING` verifica `Payment.status === 'CONFIRMED'` en BD, no depende del gateway |
| `shared/src/schemas/payment.schema.ts`   | Schemas de respuesta (`initPaymentResponseSchema`, `webhookEventSchema`) no cambian                 |
| `backend/prisma/schema.prisma`           | Modelo `Payment` ya tiene `mpPaymentId @unique` desde cambio-002                                    |

## Preguntas de la exploración respondidas

### 1. API del SDK MercadoPago Node.js

El SDK oficial (`mercadopago` npm, Context7 ID `/mercadopago/sdk-nodejs`) expone:

**Crear Preference (Checkout Pro):**

```ts
import { MercadoPagoConfig, Preference } from 'mercadopago';
const client = new MercadoPagoConfig({ accessToken: '<token>' });
const pref = new Preference(client);
const result = await pref.create({
  body: {
    items: [
      {
        id: payment.id,
        title: 'Servicio Destrabe',
        quantity: 1,
        unit_price: payment.amount,
      },
    ],
    back_urls: { success: '...', failure: '...', pending: '...' },
    notification_url: 'https://api.destrabe.app/payments/webhook',
    external_reference: payment.id,
  },
});
// result.id → gatewayPaymentId
// result.init_point → redirectUrl (producción) o result.sandbox_init_point → (sandbox)
```

**Verificar webhook (HMAC):**

```ts
import { WebhookSignatureValidator } from 'mercadopago';
WebhookSignatureValidator.validate({
  xSignature: req.headers['x-signature'],
  xRequestId: req.headers['x-request-id'],
  dataId: req.query['data.id'],
  secret: env.MP_WEBHOOK_SECRET,
  toleranceSeconds: 300,
});
```

**Procesar notificación IPN:**

```ts
mercadopago.ipn.manage(request) → { body: { id, status, external_reference, ... }, topic }
// Alternativa: GET /v1/payments/{id}?access_token=... para obtener detalles
```

**Mapeo de estados MP → nuestro dominio:**

- `approved` → `CONFIRMED`
- `rejected`, `cancelled`, `refunded` → `FAILED`
- `pending`, `in_process`, `in_mediation` → ignorar (no terminal)

### 2. ¿La interfaz `PaymentGateway` soporta MP limpiamente?

**`initPayment`: sí, sin cambios.** Los campos `gatewayPaymentId` y `redirectUrl` mapean 1:1 con `preference.id` y `preference.init_point`.

**`processWebhook`: sí, pero requiere que el webhook route delegue al gateway.** Actualmente el route no llama a `processWebhook`. El refactor necesario es:

- **Stub**: `processWebhook(req, webhookToken)` — valida `X-Webhook-Token` contra `webhookToken`, parsea body, retorna `{paymentId, status}`.
- **MP**: `processWebhook(req)` — verifica HMAC con `WebhookSignatureValidator`, obtiene `data.id` de query params, busca el payment de MP vía SDK/API, hace reverse-lookup por `mpPaymentId` en BD, retorna `{paymentId (nuestro cuid), status, gatewayReference}`.

La interfaz NO necesita expandirse. El parámetro `signature?` ya existe. El `payload: unknown` se usa como el request completo de Express. La firma es:

```ts
processWebhook(payload: unknown, signature?: string): Promise<{
  paymentId: string;      // nuestro ID interno
  status: 'CONFIRMED' | 'FAILED';
  gatewayReference?: string;  // MP payment id
}>
```

### 3. ¿Dónde ocurre el cálculo de comisión?

El cálculo es **interno a destrabe** y no depende del gateway. `calculateCommission(amount, rate)` se invoca en:

- `POST /:id/init` L57-60 → antes de llamar a `gateway.initPayment()`
- `POST /webhook` L126-129 → antes de persistir la transición

MP no interviene en la comisión. La comisión se persiste en `Payment.commission` / `Payment.operatorAmount`. El `amount` que se envía a MP es el monto total (incluye comisión) porque el cliente paga el total a MP, y destrabe deduce la comisión internamente.

### 4. Variables de entorno necesarias

| Variable                | Requerida en                                    | Default test           | Descripción                                   |
| ----------------------- | ----------------------------------------------- | ---------------------- | --------------------------------------------- |
| `PAYMENT_GATEWAY`       | Todas                                           | `'stub'`               | Ya existe, valor `'mercadopago'` para MP      |
| `MP_ACCESS_TOKEN`       | dev + prod cuando `PAYMENT_GATEWAY=mercadopago` | —                      | Access token de MP (producción o sandbox)     |
| `MP_WEBHOOK_SECRET`     | prod cuando `PAYMENT_GATEWAY=mercadopago`       | `''` (test)            | Secreto HMAC para verificar firma de webhooks |
| `MP_SANDBOX`            | dev (opcional)                                  | `true`                 | Habilita modo sandbox (`true`/`false`)        |
| `PAYMENT_WEBHOOK_TOKEN` | dev + prod cuando `PAYMENT_GATEWAY=stub`        | `'test-webhook-token'` | Ya existe; no se usa con MP                   |

**Estrategia fail-fast**: si `PAYMENT_GATEWAY=mercadopago` y `NODE_ENV !== 'test'`:

- `MP_ACCESS_TOKEN` requerido → error claro si falta
- `MP_WEBHOOK_SECRET` requerido → error claro si falta

En `NODE_ENV=test`, el gateway por defecto es `'stub'`, así que las variables de MP nunca se evalúan en tests a menos que se configure explícitamente.

### 5. Estrategia de testing

| Capa                                       | Qué                                                                                 | Cómo                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Unit — `MercadoPagoGateway.initPayment`    | Crea Preference con items, external_reference, notification_url correctos           | `vi.mock('mercadopago')` — mockea `Preference.create`                                                                                 |
| Unit — `MercadoPagoGateway.processWebhook` | Verifica HMAC, parsea IPN, mapea estados MP→dominio, reverse-lookup por mpPaymentId | `vi.mock('mercadopago')` — mockea `WebhookSignatureValidator` e `ipn.manage`                                                          |
| Unit — Factory                             | `getPaymentGateway('mercadopago')` retorna `MercadoPagoGateway`                     | Test simple sin mocks                                                                                                                 |
| DB smoke                                   | Flujo end-to-end `init→webhook→COMPLETED` con stub                                  | **Sin cambios** — `payments.lifecycle.test.ts` existente; `NODE_ENV=test` → stub                                                      |
| Integration MP (opcional)                  | Flujo real contra sandbox de MP                                                     | Nuevo archivo `payments.mercadopago.test.ts`, gateado por `MP_ACCESS_TOKEN` en env; solo se ejecuta en CI con credenciales de sandbox |

## Approaches

### Enfoque A: SDK oficial `mercadopago` (recomendado)

Usar el paquete npm `mercadopago` para Preference + webhook.

- **initPayment**: `new Preference(client).create({ body: { items, external_reference, notification_url, back_urls } })`
- **processWebhook**: `WebhookSignatureValidator.validate(...)` → `mercadopago.ipn.manage(req)` → fetch payment por `mpPaymentId` → reverse-lookup → retornar nuestro `paymentId`
- **Pros**:
  - `WebhookSignatureValidator` incluido — no hay que implementar HMAC manualmente
  - IPN Manager (`ipn.manage`) abstrae el parseo de notificaciones
  - Tipos TypeScript incluidos en el paquete
  - Mantenido por MercadoPago, documentación oficial extensa (236 snippets en Context7)
  - Paquete ligero (~200KB), sin dependencias pesadas
- **Cons**:
  - Dependencia externa adicional (aunque es la oficial)
  - El reverse-lookup (`mpPaymentId → payment.id`) requiere acceso a Prisma desde el gateway o una función de lookup inyectada
  - La API del SDK puede cambiar entre versiones mayores
- **Complejidad**: Baja

### Enfoque B: HTTP client directo sin SDK

Llamar a la REST API de MP con `fetch`/`axios`, sin dependencia `mercadopago`.

- **initPayment**: `POST https://api.mercadopago.com/checkout/preferences` con header `Authorization: Bearer {token}`
- **processWebhook**: implementar verificación HMAC-SHA256 manual (`crypto.createHmac`), parsear notificación IPN manualmente, `GET /v1/payments/{id}` para detalles
- **Pros**:
  - Sin dependencia externa de vendor (solo `fetch` nativo de Node ≥18)
  - Control total sobre retries, timeouts, y serialización
  - Sin riesgo de breaking changes del SDK
- **Cons**:
  - HMAC verification hay que implementarla y testearla manualmente (superficie de bugs de seguridad)
  - Parseo de notificaciones IPN frágil ante cambios de MP
  - Más código boilerplate (construcción de URLs, headers, manejo de errores HTTP)
  - Sin tipos TypeScript para respuestas de MP — hay que definirlos manualmente
- **Complejidad**: Media

### Enfoque C: Wrapper con retry/idempotencia sobre SDK

Extender el Enfoque A con una capa de resiliencia: retry automático con backoff exponencial, idempotency keys en llamadas a MP, y circuit breaker para fallos del gateway.

- **initPayment**: SDK + retry (3 intentos, backoff 1s/2s/4s) + idempotency key basada en `payment.id`
- **processWebhook**: SDK + verificación HMAC + cola de procesamiento para evitar condiciones de carrera en webhooks duplicados
- **Pros**:
  - Máxima resiliencia ante fallos de red o rate-limiting de MP
  - Idempotencia garantizada incluso si MP envía webhooks duplicados
  - Preparado para producción desde el día 1
- **Cons**:
  - Complejidad adicional significativa (wrapper, circuit breaker, cola de deduplicación)
  - Mayor superficie de test (combinatoria de fallos + reintentos)
  - Overkill para el MVP actual: el flujo de pago tiene bajo volumen
  - La idempotencia del webhook ya está cubierta en la capa de ruta (D4)
- **Complejidad**: Alta

## Recommendation

**Enfoque A: SDK oficial `mercadopago`.**

Razones:

1. **Menor superficie de bugs de seguridad**: `WebhookSignatureValidator` está mantenido por MP y cubre edge cases de HMAC (timing-safe comparison, tolerance, replay protection). Implementar HMAC manualmente (Enfoque B) introduce riesgo innecesario.
2. **Menos código = menos mantenimiento**: el SDK abstrae ~200 líneas de boilerplate HTTP + parseo que habría que escribir y mantener en el Enfoque B.
3. **Tipos incluidos**: el paquete `mercadopago` incluye tipos TypeScript para respuestas, reduciendo errores de integración.
4. **El Enfoque C es premature optimization**: la capa de ruta ya maneja idempotencia de webhooks (D4). Retry + circuit breaker pueden agregarse en un cambio futuro (cambio-008) si el volumen lo justifica, sin tocar la interfaz `PaymentGateway`.
5. **El seam de cambio-006 se respeta completamente**: endpoints, specs, y el guard 409 no se tocan. Solo cambia la implementación concreta detrás de la interfaz.

### Diseño de alto nivel propuesto

```
MercadoPagoGateway implements PaymentGateway
├── constructor(prisma: PrismaClient, config: { accessToken, webhookSecret, sandbox })
├── initPayment(payment) → Preference.create → { id, init_point }
└── processWebhook(req) → HMAC verify → ipn.manage → findBy mpPaymentId → { paymentId, status, gatewayReference }
```

El `MercadoPagoGateway` recibe `PrismaClient` en su constructor para el reverse-lookup `mpPaymentId → payment.id`. Esto es aceptable porque:

- La interfaz no expone Prisma (el tipo es `PaymentGateway`)
- Solo la implementación concreta de MP necesita la BD
- Patrón común en gateways de pago reales (Stripe SDK también requiere acceso a BD para webhooks)

## Risks

- **Reverse-lookup frágil**: si `mpPaymentId` no se persiste correctamente en `initPayment`, el webhook no podrá encontrar el Payment interno → 404. Mitigación: test unitario que verifica la ida y vuelta `init → mpPaymentId → webhook lookup`.
- **Cambio de API del SDK**: el paquete `mercadopago` podría tener breaking changes entre versiones mayores. Mitigación: fijar versión exacta en `package.json` (`"mercadopago": "2.x.x"` con `~` o `^` restrictivo).
- **Webhook en sandbox vs producción**: MP sandbox tiene comportamiento distinto (init_point vs sandbox_init_point, webhooks pueden no llegar). Mitigación: flag `MP_SANDBOX` explícito; los tests de integración MP usan sandbox.
- **Condiciones de carrera webhook**: MP puede enviar múltiples notificaciones para el mismo pago en rápida sucesión. Mitigación: la idempotencia existente en la ruta (D4 — `status !== 'PENDING'` → 200 sin mutar) ya cubre este caso.
- **Compatibilidad con tests existentes**: el `payments.lifecycle.test.ts` inyecta el webhook token directamente vía `X-Webhook-Token`. Si el refactor del webhook mueve el token check al `StubPaymentGateway.processWebhook`, el flujo debe seguir funcionando igual. Mitigación: ejecutar tests existentes ANTES de merge para confirmar cero regresiones.

## Ready for Proposal

**Sí.** La exploración confirma que:

1. La interfaz `PaymentGateway` soporta MP sin expandirse — solo requiere que el webhook route delegue al gateway (refactor interno ya previsto en D2).
2. Los endpoints NO cambian su contrato REST ni sus rutas.
3. El guard 409 `PAYMENT_PENDING` no se toca.
4. El SDK oficial es la opción correcta (Enfoque A).
5. Las variables de entorno necesarias están identificadas con defaults seguros.
6. La estrategia de testing está definida y no rompe los tests existentes.

**Próximo paso:** `sdd-propose` para formalizar el alcance en `docs/proposals/cambio-007-mercadopago/proposal.md`.
