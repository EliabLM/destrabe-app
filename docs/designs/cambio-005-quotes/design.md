# Design — Cambio-005: Cotizaciones (quotes/offers)

**Change ID:** `cambio-005-quotes`
**Etapa SDD:** Design
**Basado en:** `docs/specs/cambio-005-quotes/spec.md`
**Branch:** `develop`

> Tres endpoints que cierran el ciclo Demo (cotizar → aceptar → ACTIVE). Reutiliza FSM, middlewares y patrón de tests de cambio-004 sin tocar `serviceMachine.ts`. Payment como stub.

## 1. Technical Approach

Tres handlers en un nuevo `quotes.routes.ts` siguiendo el patrón exacto de `services.routes.ts` (`requireAuth`/`requireRole`/`validate`/cast `ServiceRequest`/try-catch-`next`/`assertTransition`). Dos routers: `serviceQuotesRouter` (montado `/services`, paths `/:id/quotes` POST+GET) y `quotesAcceptRouter` (montado `/quotes`, path `/:id/accept` POST) — mapeo 1:1 a los paths del spec. Quote-create y accept envueltos en `prisma.$transaction` (atomicidad). `acceptedQuoteId @unique` es el race guard DB-level. Nuevo error local `AlreadyAcceptedError` (409, `ALREADY_ACCEPTED`) — no toca `serviceMachine.ts` (su `code` es `as const`).

## 2. Architecture Decisions

### D1 — Montaje dual de routers

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Un `quotesRouter` en `/services` + `/quotes` | Duplica paths en ambos mounts | ✗ |
| Dos routers en `quotes.routes.ts` (`serviceQuotesRouter`→`/services`, `quotesAcceptRouter`→`/quotes`) | Dos exports; paths RESTful canónicos | ✅ Elegida |
| Todo en `services.routes.ts` | Acopla concerns; rompe separación | ✗ |

**Rationale:** `POST/GET /services/:id/quotes` son sub-recursos de Service; `POST /quotes/:id/accept` opera sobre Quote raíz. Dos mounts sin ambigüedad.

### D2 — `prisma.$transaction` en create y accept

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `$transaction` quote.create + service.update condicional | Overhead mínimo; atomicidad | ✅ Elegida |
| Secuencial sin tx | Orfana quote si update falla | ✗ |

**Rationale:** En la primera quote (`PENDING→QUOTED`), quote+status son atómicos. En `accept`, `service.update` + `payment.create` son inseparables; `@unique` refuerzan DB-level.

### D3 — Error `ALREADY_ACCEPTED`

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `AlreadyAcceptedError` local (409, `ALREADY_ACCEPTED`) compatible con `errorHandler` | Nueva clase minúscula en `quotes.routes.ts` | ✅ Elegida |
| Extender `ConflictError` con param `code` | Modifica `serviceMachine.ts` (lista no-change) | ✗ |
| Inline `res.status(409).json(...)` | Rompe patrón throw→`errorHandler` | ✗ |

**Rationale:** `errorHandler` lee `err.status`/`err.code`; nueva clase encaja sin tocar infraestructura. Se lanza al verificar `status === ACTIVE` y al capturar P2002 en `accept`.

### D4 — `commission = 0` placeholder documentado

Payment stub con `operatorAmount = amount`, `commission = 0`, `status = PENDING`, `mpPaymentId = null`. Comentario en el handler: "Placeholder — cambio-006 recalcula `commission` desde `Config`/env al integrar Mercado Pago".

## 3. Data Flow

```
Operador ─POST /services/:id/quotes──▶ find service(404) ─▶ status ∈ {PENDING,QUOTED}? (409 INVALID_TRANSITION)
   │                                  └▶ find OperatorProfile by userId (422 OPERATOR_PROFILE_REQUIRED)
   │                                  └▶ $transaction: quote.create + (if PENDING) assertTransition + service.update(QUOTED)
   │                                  └▶ notifyClient(service, 'quote_received') ─▶ 201
   │
Cliente/Op/Admin ─GET /services/:id/quotes──▶ find service(404) ─▶ owner/admin→all; op→own; ajeno→404
   │
Cliente ─POST /quotes/:id/accept──▶ find quote(404) ─▶ find service via quote.serviceId(404)
   │                             └▶ ownership? service.client.userId !== req.user.id → 403
   │                             └▶ status === ACTIVE → throw AlreadyAcceptedError (409)
   │                             └▶ assertTransition(QUOTED, ACTIVE, 'CLIENT')
   │                             └▶ $transaction: service.update{ACTIVE, acceptedQuoteId} + payment.create(stub)
   │                             └▶ catch P2002(@unique) → AlreadyAcceptedError ─▶ 200
```

## 4. File Changes

| File | Action | Descripción |
|------|--------|-------------|
| `backend/src/routes/quotes.routes.ts` | Create | 3 handlers, 2 routers, error class |
| `backend/src/routes/index.ts` | Modify | `router.use('/services', serviceQuotesRouter)` + `router.use('/quotes', quotesAcceptRouter)` |
| `shared/src/schemas/service.schema.ts` | Modify | `createQuoteSchema`, `acceptQuoteSchema` |
| `shared/src/types/service.ts` | Modify | re-export `CreateQuoteInput` |
| `shared/src/schemas/index.ts` | Verify | barrel ya hace `export *` |
| `backend/__tests__/quotes.routes.test.ts` | Create | unit Zod (REQ-004) |
| `backend/__tests__/db/quotes.lifecycle.test.ts` | Create | supertest PENDING→QUOTED→ACTIVE (REQ-001/002/003/005/006/007) |

## 5. Interfaces / Contracts

```ts
class AlreadyAcceptedError extends Error { status = 409; code = 'ALREADY_ACCEPTED' as const; }

// createQuoteSchema: { amount: z.number().positive(), estimatedMinutes?: z.number().int().positive(), note?: z.string().max(500) }
// acceptQuoteSchema: z.object({}).strict()
// type CreateQuoteInput = z.infer<typeof createQuoteSchema>
```

**Sin cambios:** `serviceMachine.ts`, `serviceExpiry.job.ts`, `notifications.ts`, `env.ts`, `validate.ts`, `auth.ts`, `errorHandler.ts`, `package.json`, Prisma schema, `docker-compose`.

## 6. Testing Strategy

| Layer | Qué | Cómo |
|-------|-----|------|
| Unit | `createQuoteSchema`/`acceptQuoteSchema` válido/inválido → `VALIDATION_ERROR` | Zod `safeParse` directo |
| DB smoke | `POST /services/:id/quotes` (PENDING→QUOTED+notify; QUOTED→201; 422 sin perfil; 409 ACTIVE) | supertest + `authenticateAs(OP)` + `seedService` extendido |
| DB smoke | `GET /services/:id/quotes` (dueño/admin todas; operador solo las suyas; ajeno 404) | supertest + 2 operadores con perfil |
| DB smoke | `POST /quotes/:id/accept` (ACTIVE+`acceptedQuoteId`+Payment stub; doble-accept 409; no-dueño 403) | supertest + `prisma.payment.findUnique` |
| DB smoke | 401 sin token, 403 rol incorrecto, 404 inexistente | helpers de cambio-004 |

**Notas:** Mock `queue` idéntico a cambio-004. Reutilizar `authenticateAs`; nuevo helper `seedOperatorProfile`. `truncateAll` ya incluye `Quote`/`Payment`.

## 7. Migration / Rollout

No migration required. Sin cambios a Prisma schema ni env vars.
**Rollback:** revert commits → eliminar `quotes.routes.ts` + 2 tests + schemas en `shared/`.

## 8. Open Questions

- [ ] ¿`notifyClient` recibe `service` original o post-update? (Definir en apply: original.)
- [ ] P2002 (`@unique` violation) → `AlreadyAcceptedError` (recomendado) o `INVALID_TRANSITION`?

## Next

Etapa `tasks`: shared schemas → `quotes.routes.ts` (3 handlers + error) → mount → unit Zod → db smoke.