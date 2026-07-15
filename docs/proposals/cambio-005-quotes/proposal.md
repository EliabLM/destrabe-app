# Proposal: Cambio-005 — Cotizaciones (quotes/offers)

**Change ID:** `cambio-005-quotes` · **Etapa:** Propose · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-005-quotes/exploration.md`

## Intent

`cambio-004` dejó `QUOTED → ACTIVE` definida en la FSM pero inalcanzable en runtime. Este cambio cierra el núcleo Demo: operador cotiza, cliente acepta → `ACTIVE`. Pago como **stub** para `cambio-006` (Mercado Pago).

## Scope

### In Scope

- 3 endpoints: `POST /services/:id/quotes`, `GET /services/:id/quotes`, `POST /quotes/:id/accept`.
- Schemas `createQuoteSchema`/`acceptQuoteSchema` + tipos `z.infer`.
- Invocar transiciones FSM existentes (`PENDING→QUOTED`, `QUOTED→ACTIVE` CLIENT).
- Payment stub (`amount=quote.amount`, `commission=0`, `operatorAmount=amount`, `status=PENDING`).
- `notifyClient(service, 'quote_received')` (interfaz sin cambios).
- Tests unit (mock prisma) + db smoke (supertest).

### Out of Scope

- Edit/delete/reject de quotes (MVP).
- Pago real (→ `cambio-006`); push reales (FCM).
- Incluir quotes en `GET /services/:id`.

## Capabilities

> Contrato con `sdd-spec`.

### New Capabilities

- `quote-lifecycle`: crear (OPERATOR), listar (visibilidad por rol), aceptar (CLIENT). Cubre `OperatorProfile` preexistente, transiciones FSM, Payment stub y notificación.

### Modified Capabilities

- None. `service-lifecycle` (cambio-004) no cambia a nivel spec: la FSM ya define las transiciones y `GET /services/:id` no se modifica; solo se invocan desde los handlers de quotes.

## Approach

Opción B: 3 endpoints RESTful. `OperatorProfile` **requerido** (422 `OPERATOR_PROFILE_REQUIRED`; sin lazy upsert). Al aceptar: validar `status !== ACTIVE` (409 `ALREADY_ACCEPTED`) y `status in ['PENDING','QUOTED']` para crear quotes. `acceptedQuoteId` `@unique` protege doble-aceptación.

## Affected Areas

| Area                                                                            | Impact                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `backend/src/routes/quotes.routes.ts`                                           | New — 3 endpoints                                            |
| `backend/src/routes/index.ts`                                                   | Modified — montar `quotesRouter`                             |
| `shared/src/schemas/service.schema.ts` + `index.ts`                             | Modified — schemas quotes                                    |
| `shared/src/types/service.ts`                                                   | Modified — tipos `z.infer`                                   |
| `backend/__tests__/`                                                            | New — `quotes.routes.test.ts`, `db/quotes.lifecycle.test.ts` |
| `serviceMachine`, `serviceExpiry.job`, `notifications`, `env`, `docker-compose` | No change                                                    |

## Risks

| Riesgo                         | Prob | Mitigación                            |
| ------------------------------ | ---- | ------------------------------------- |
| Cotiza sin `OperatorProfile`   | Med  | 422 `OPERATOR_PROFILE_REQUIRED`       |
| `commission=0` placeholder     | Bajo | Documentado; `cambio-006` recalcula   |
| Doble-accept race              | Bajo | 409 `ALREADY_ACCEPTED` + `@unique` DB |
| Quote en servicio no cotizable | Bajo | Validar `status` antes de crear       |

## Rollback Plan

Revertir merge. Eliminar `quotes.routes.ts`, sus tests y schemas en `shared/`. Sin migraciones que deshacer.

## Dependencies

- `cambio-004`: FSM `serviceMachine.ts`, middlewares, patrón tests.
- `cambio-002`: modelos `Quote`/`Payment` en Prisma.

## Success Criteria

- [ ] Operador crea quote → servicio `QUOTED` (si `PENDING`) + notificación.
- [ ] `GET /quotes`: dueño/admin todas; operador las suyas; ajeno → 404.
- [ ] Cliente acepta → `ACTIVE`, `acceptedQuoteId`, Payment stub creado.
- [ ] 409 ilegales; 422 sin `OperatorProfile`; tests verdes.

## Proposal question round

No bloqueante:

1. ¿`GET /services/:id` incluye `quotes`? (exploración: separación)
2. ¿`acceptQuoteSchema` body `{}` o sin `validate`?
3. ¿`'quote_received'` por cada quote o solo la primera?
