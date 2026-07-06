# Exploration — Cambio-005: Cotizaciones (quotes/offers)

**Change ID:** `cambio-005-quotes`
**Etapa SDD:** Explore
**Branch:** `develop`
**Basado en:** spec-técnica §5 (módulo Cotizaciones), §7.2 (ciclo de vida QUOTED/ACTIVE), `backend/prisma/schema.prisma` modelo `Quote` (cambio-002), `backend/src/services/serviceMachine.ts` (cambio-004).

## Current State

`cambio-001` (foundation), `cambio-002` (data model), `cambio-003` (Better Auth) y `cambio-004` (servicios: FSM + CRUD + timer) están mergeados en `develop`. El backend ya tiene:

- **Modelo `Quote` completo** (cambio-002): `id, serviceId, operatorProfileId, amount, estimatedMinutes?, note?, createdAt, acceptedForService?`. Relaciones `ServiceQuotes` (1:N) y `AcceptedQuote` (1:1) definidas en Prisma. El campo `Service.acceptedQuoteId` es `@unique` — restricción DB-level contra race conditions en aceptación. **No requiere cambios de schema.**
- **FSM `serviceMachine.ts`** (cambio-004): tabla de transiciones estática con todas las transiciones legales definidas y unit-testeadas. `PENDING → QUOTED` (actor `system`), `QUOTED → ACTIVE` (actor `CLIENT`), `QUOTED → CANCELLED` (actor `CLIENT`). Puras, sin IO. `ConflictError` con `code: 'INVALID_TRANSITION'`.
- **`services.routes.ts`** (cambio-004): 4 endpoints bajo `requireAuth` + `requireRole` + `validate`. El `PATCH /:id/status` tiene un comentario explícito (L262-266) de que `QUOTED → ACTIVE` es inalcanzable en runtime sin quotes. El `GET /:id` hace `include: { client: true }` — no incluye `quotes`.
- **`serviceExpiry.job.ts`** (cambio-004): worker BullMQ que solo maneja `PENDING → CANCELLED`. Si el servicio NO está en `PENDING`, es no-op. Coherente con spec-técnica §7.2: "Si expira sin cotizaciones → CANCELLED" (solo PENDING expira).
- **`notifications.ts`** (cambio-004): stub log-only con interfaz `notifyClient(service, event)`. Listo para reutilizar en cambio-005 (evento `'quote_received'`).
- **Auth middleware**: `requireAuth` (puebla `req.user = { id, phone, role }`) y `requireRole(role)` factory (403). `UserRole.OPERATOR` y `UserRole.CLIENT` listos.
- **`validate` middleware** (cambio-004): factory Zod genérico `validate(schema, source)`. Reutilizable para schemas de quotes.
- **Modelo `Payment`** (cambio-002): `id, serviceId (@unique), mpPaymentId?, amount, commission, operatorAmount, status`. Listo para crear registro stub en la aceptación.
- **`OperatorProfile`**: requiere `truckType` y `licensePlate` (strings requeridos, no nullables). La FK `Quote.operatorProfileId` es non-nullable → el operador **debe** tener perfil para cotizar. No existe lazy upsert como en `ClientProfile`.
- **Shared**: `shared/src/schemas/service.schema.ts` tiene schemas de servicios pero **nada de quotes**. `shared/src/types/service.ts` exporta enums `ServiceStatus`, `ServiceType` y tipos inferidos.
- **Tests**: patrón dual — unitarios en `backend/__tests__/*.test.ts` (sin DB) y db smoke en `backend/__tests__/db/*.test.ts`. El flujo OTP usa `supertest` con cookie jar y `vi.hoisted`. `resetDb` ya incluye `Quote` en la lista de tablas TRUNCATE. `seedUser` + helpers de autenticación reutilizables.

## Affected Areas

- `backend/src/routes/quotes.routes.ts` _(nuevo)_ — `POST /services/:id/quotes`, `GET /services/:id/quotes`, `POST /quotes/:id/accept`.
- `backend/src/routes/index.ts` — montar `quotesRouter` (en raíz o bajo `/services` + `/quotes`).
- `backend/src/routes/services.routes.ts` — **posible modificación** en `GET /:id`: incluir `quotes` en el `include` para el dueño (o dejar que `GET /services/:id/quotes` maneje la lista). Evaluar en design.
- `backend/src/services/serviceMachine.ts` — **sin cambios**: las transiciones `PENDING → QUOTED` y `QUOTED → ACTIVE` ya están definidas. Cambio-005 solo las invoca desde los handlers de ruta.
- `shared/src/schemas/service.schema.ts` — ampliar con `createQuoteSchema` (`amount`, `estimatedMinutes?`, `note?`) y `acceptQuoteSchema` (body vacío o `{}`).
- `shared/src/schemas/index.ts` — re-export de los nuevos schemas.
- `shared/src/types/service.ts` — añadir tipos inferidos `z.infer` para los nuevos schemas.
- `backend/src/lib/notifications.ts` — **sin cambios**: la interfaz `notifyClient(service, event)` es estable. Se invocará con evento `'quote_received'`.
- `backend/src/jobs/serviceExpiry.job.ts` — **sin cambios**: QUOTED no expira (spec §7.2 solo expira PENDING).
- `backend/.env` / `.env.example` — **sin cambios**: no se requieren nuevas vars de entorno para quotes (pago es stub).
- `backend/__tests__/` — unit: `quotes.routes.test.ts` (mock prisma + auth). `__tests__/db/`: `quotes.lifecycle.test.ts` (supertest, flujo completo PENDING → QUOTED → ACTIVE).
- `backend/package.json` — **sin cambios**: no se requieren nuevas dependencias.

## Approaches

### 1. Cantidad de endpoints (scope Demo)

| Opción           | Endpoints                                                                                | Descripción                                                                                            | Pros                                                                                                           | Contras                                                                                                             | Effort     |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| **A. Mínimo**    | `POST /services/:id/quotes` + `POST /quotes/:id/accept` (2)                              | El cliente ve las cotizaciones vía `GET /services/:id` (se añade `include: { quotes }` para el dueño). | Menos archivos/rutas. API más compacta. Suficiente para Demo.                                                  | Mezcla responsabilidades: GET /services/:id devuelve quotes + datos del servicio. Menos explícito para el frontend. | Bajo       |
| **B. Explícito** | `POST /services/:id/quotes` + `GET /services/:id/quotes` + `POST /quotes/:id/accept` (3) | Listado de quotes como endpoint dedicado. Separación clara de concerns.                                | API RESTful canónica. Frontend puede consultar solo quotes sin recargar todo el servicio. Testing más aislado. | Un endpoint extra. Mínima complejidad adicional.                                                                    | Bajo-Medio |
| C. Completo      | Añade `PATCH /quotes/:id`, `DELETE /quotes/:id`, `POST /quotes/:id/reject`               | Flujo completo de gestión de cotizaciones (editar, eliminar, rechazar explícitamente).                 | Flexibilidad total para el operador y cliente.                                                                 | Over-scope para Demo. El flujo Demo solo necesita crear y aceptar. Complejidad innecesaria en esta etapa.           | Alto       |

**Recomendación: Opción B.** Tres endpoints dan una API limpia y RESTful sin sobrecargar el scope Demo. `GET /services/:id/quotes` devuelve la "lista de ofertas" que el cliente ve en la pantalla de espera. Separar el listado de quotes del detalle del servicio facilita el testing aislado y el desarrollo del frontend.

### 2. OperatorProfile: requerido vs. lazy upsert

| Opción                              | Descripción                                                                                                                         | Pros                                                                                                                                                                 | Contras                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A. Requerir perfil preexistente** | Si el operador no tiene `OperatorProfile`, `POST /services/:id/quotes` devuelve 422 `{ error, code: 'OPERATOR_PROFILE_REQUIRED' }`. | Datos íntegros: `truckType` y `licensePlate` son requeridos y no tienen defaults razonables. El flujo natural del operador ya incluye crear perfil antes de cotizar. | Fricción en el onboarding si el operador intenta cotizar sin perfil.                                                             |
| B. Lazy upsert con defaults         | Crear `OperatorProfile` on-demand con `truckType: 'default'`, `licensePlate: 'PENDING'`.                                            | Sin fricción: el operador puede cotizar inmediatamente.                                                                                                              | Datos basura en la DB. `licensePlate` y `truckType` son datos sensibles del negocio; valores placeholder distorsionan el modelo. |

**Recomendación: Opción A.** `OperatorProfile` tiene campos requeridos sin defaults razonables. El operador debe completar su perfil antes de cotizar. Devolver 422 con código claro guía al frontend a mostrar el flujo de creación de perfil. Para tests, `seedUser` + creación directa de `OperatorProfile` en DB es trivial.

### 3. Pago stub en aceptación

| Opción                       | Descripción                                                                                                                                                                                | Pros                                                                                                                                                                              | Contras                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Crear Payment stub**    | Al aceptar (`POST /quotes/:id/accept`), crear registro `Payment` con `amount = quote.amount`, `commission = 0`, `operatorAmount = quote.amount`, `status = PENDING`, `mpPaymentId = null`. | Prepara el terreno para cambio-006 (Mercado Pago). El modelo de datos queda poblado. La transición a MP real solo requiere cambiar el handler de pago, no el flujo de aceptación. | Una escritura más en la DB. El campo `commission = 0` es un placeholder.                                                                    |
| B. Deferir pago a cambio-006 | Sin registro `Payment`. Solo `acceptedQuoteId` + transición `QUOTED → ACTIVE`.                                                                                                             | Menos complejidad en cambio-005.                                                                                                                                                  | La relación `Service → Payment` queda rota hasta cambio-006. Cambio-006 tendría que crear el Payment retroactivamente o rediseñar el flujo. |

**Recomendación: Opción A.** Crear el Payment stub cierra el ciclo de datos y simplifica cambio-006. `commission = 0` es explícitamente un placeholder documentado. La spec-técnica dice "aceptar → dispara pago"; el stub es la implementación Demo de ese contrato.

### 4. Visibilidad de quotes

| Actor             | ¿Qué ve?                                                                                                                         | Implementación                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Cliente dueño** | Todas las quotes del servicio (con datos del operador: `truckType`, `licensePlate`, `rating`).                                   | `GET /services/:id/quotes` con `include: { operator: true }` tras validar ownership. |
| **Operador**      | En `GET /services/:id/quotes`: solo sus propias quotes. En `GET /services/:id`: datos públicos del servicio (sin quotes ajenas). | Filtrar por `operatorProfile.userId === req.user.id`.                                |
| **Admin**         | Todas las quotes.                                                                                                                | Mismo path que dueño (rol ADMIN).                                                    |
| **Ajeno**         | 404 (no revela existencia).                                                                                                      | Mismo patrón que `GET /services/:id`.                                                |

### 5. Concurrencia en aceptación

- `Service.acceptedQuoteId` es `@unique` — la DB garantiza que solo una quote puede ser aceptada por servicio.
- El dueño del servicio es **único** (un `ClientProfile` por `User`, un `User` dueño del `Service`), así que no hay riesgo de que dos clientes acepten simultáneamente.
- Escenario de carrera: el servicio podría expirar entre que el cliente ve las quotes y acepta. Pero el expiry worker solo maneja `PENDING → CANCELLED`, así que un servicio en `QUOTED` no expira → **sin race condition en cambio-005**.
- Idempotencia en `POST /quotes/:id/accept`: si el servicio ya está `ACTIVE`, devolver 409 `{ error, code: 'ALREADY_ACCEPTED' }`.

### 6. Interacción con el timer de expiración

- `serviceExpiry.job.ts` solo transiciona `PENDING → CANCELLED`. Una vez que el servicio pasa a `QUOTED` (primera quote), el timer **no lo cancela**. Esto es correcto per spec-técnica §7.2: "Si expira sin cotizaciones → CANCELLED". Un servicio con cotizaciones no debería expirar automáticamente — el cliente debe poder aceptar.
- **No se requiere modificar el worker de expiración.**

## Recommendation

**Scope del cambio-005:**

1. **`quotes.routes.ts`** (nuevo) con 3 endpoints bajo `requireAuth`:
   - `POST /services/:id/quotes` — `requireRole(OPERATOR)`. Valida que el operador tenga `OperatorProfile`. Si el servicio está `PENDING`, crea la Quote y transiciona a `QUOTED` (vía `assertTransition(PENDING, QUOTED, 'system')`). Notifica al cliente (`notifyClient(service, 'quote_received')`).
   - `GET /services/:id/quotes` — `requireAuth`. Cliente dueño ve todas las quotes (con datos del operador). Operador ve solo las suyas. Admin ve todas. Ajeno → 404.
   - `POST /quotes/:id/accept` — `requireRole(CLIENT)`. Valida ownership del servicio. Transiciona `QUOTED → ACTIVE` (vía `assertTransition(QUOTED, ACTIVE, 'CLIENT')`). Crea Payment stub. Setea `acceptedQuoteId`. Devuelve el servicio actualizado.

2. **Ampliar `shared/src/schemas/service.schema.ts`** con:
   - `createQuoteSchema`: `{ amount: z.number().positive(), estimatedMinutes: z.number().int().positive().optional(), note: z.string().max(500).optional() }`
   - Endpoint `accept` no requiere body (o `acceptQuoteSchema` vacío).

3. **Ampliar `shared/src/types/service.ts`** con tipos `z.infer` (`CreateQuoteInput`).

4. **`services.routes.ts`**: evaluar si `GET /services/:id` debe incluir quotes para el dueño (además del endpoint dedicado). Recomendación: no modificar — mantener concerns separados. El frontend consulta quotes vía `GET /services/:id/quotes`.

5. **Sin cambios en:**
   - `serviceMachine.ts` — transiciones ya definidas.
   - `serviceExpiry.job.ts` — solo PENDING expira.
   - `notifications.ts` — interfaz estable.
   - `env.ts` — sin nuevas vars.
   - `package.json` — sin nuevas deps.
   - `docker-compose` — sin nuevos servicios.

6. **TDD**: unit tests para `quotes.routes` (mock prisma + auth). Db smoke: flujo completo `POST /services` → `POST /services/:id/quotes` (×2 operadores) → `GET /services/:id/quotes` (visibilidad) → `POST /quotes/:id/accept` → verificar `ACTIVE` + Payment stub + `acceptedQuoteId`.

### Diagrama de flujo

```
Cliente ─POST /services──▶ PENDING (timer 15 min)
                               │
Operador A ─POST /services/:id/quotes──▶ Quote creada + notifyClient('quote_received')
                               │           └▶ assertTransition(PENDING, QUOTED, 'system')
Operador B ─POST /services/:id/quotes──▶ Quote creada (servicio ya QUOTED, sin transición)
                               │
Cliente ─GET /services/:id/quotes──▶ [quoteA, quoteB] con datos de operadores
                               │
Cliente ─POST /quotes/:id/accept──▶ assertTransition(QUOTED, ACTIVE, 'CLIENT')
                               │     └▶ Payment stub (PENDING, commission=0)
                               │     └▶ Service.acceptedQuoteId = quote.id
                               │     └▶ 200 ACTIVE
```

## Risks

- **OperatorProfile requerido**: el operador debe tener perfil antes de cotizar. Si el frontend no muestra el flujo de creación de perfil primero, el endpoint devolverá 422. Mitigación: código de error claro (`OPERATOR_PROFILE_REQUIRED`) para que el frontend redirija al flujo de perfil.
- **Payment stub con commission=0**: placeholder explícito. Cambio-006 debe recalcular la comisión real (desde tabla `Config` o env var). Mitigación: documentar en el código y en design de cambio-006 que `commission` y `operatorAmount` se recalculan al integrar MP.
- **GET /services/:id/quotes sin `include` de operador**: si no se incluye `operator: true` en el Prisma query, el frontend no tendrá `truckType`/`licensePlate`/`rating` para mostrar la oferta. Mitigación: el spec de quotes debe definir explícitamente la forma del response.
- **Idempotencia en aceptación**: si el cliente hace doble POST, el segundo debe devolver 409 (no 500). Mitigación: validar `service.status !== ACTIVE` antes de intentar la transición.
- **Quote de operador sin servicio PENDING/QUOTED**: si el servicio ya está ACTIVE/COMPLETED/CANCELLED, crear una quote no debería ser posible. Mitigación: validar `service.status in ['PENDING', 'QUOTED']` antes de crear la quote.
- **Over-scope accidental**: tentación de añadir edit/delete/reject de quotes "porque el modelo ya lo soporta". Mitigación: ceñirse a los 3 endpoints definidos. El resto se posterga a MVP.

## Ready for Proposal

**Yes.** El modelo de datos, la FSM, los middlewares y los patrones de cambio-004 están listos. Cambio-005 solo añade los endpoints que cierran el ciclo Demo: el operador puede cotizar y el cliente puede aceptar. El pago queda como stub (placeholder explícito para cambio-006). Próximo: etapa `propose`.
