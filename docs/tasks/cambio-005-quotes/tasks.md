# Tasks — Cambio-005: Cotizaciones (quotes/offers)

**Change ID:** `cambio-005-quotes` · **Basado en:** `docs/designs/cambio-005-quotes/design.md` · **Branch:** `develop`

> TDD donde aplique. T1/T6 no Docker; T2-T5 PG up; T7 PG+Redis up.

---

## Review Workload Forecast

| Field                   | Value                    |
| ----------------------- | ------------------------ |
| Estimated changed lines | 400-600                  |
| 400-line budget risk    | Medium                   |
| Chained PRs recommended | No                       |
| Suggested split         | Feature branch única     |
| Delivery strategy       | ask-on-risk              |
| Chain strategy          | feature-branch-unique    |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: feature-branch-unique
400-line budget risk: Medium

> **Decisión:** Feature branch única (`feature/cambio-005-quotes`) con commits por grupo, merge `--no-ff` a `develop` al archive.

---

## T1 — Shared schemas + tipos (Zod) _(no Docker)_

**Acción:** Ampliar `shared/src/schemas/service.schema.ts` con `createQuoteSchema` y `acceptQuoteSchema = z.object({}).strict()`; tipos `z.infer` en `shared/src/types/service.ts`; confirmar barrel; `npm run build -w @destrabe/shared`.

**Acepta (REQ-004):** build OK.

---

## T2 — AlreadyAcceptedError + quotes.routes (POST quote) _(requiere PG up)_

**Acción:** Crear `backend/src/routes/quotes.routes.ts` con `class AlreadyAcceptedError` (409, `ALREADY_ACCEPTED`); `POST /services/:id/quotes` (OPERATOR, 422 sin OperatorProfile, 409 status inválido, tx quote.create + PENDING→QUOTED, `notifyClient(service, 'quote_received')`).

**Acepta (REQ-001/007):** 201/422/409.

---

## T3 — GET /services/:id/quotes _(requiere PG up)_

**Acción:** Añadir `GET /services/:id/quotes`: dueño/admin todas con datos públicos del operador; operador solo suyas; ajeno 404.

**Acepta (REQ-002):** lista filtrada.

---

## T4 — POST /quotes/:id/accept + Payment stub _(requiere PG up)_

**Acción:** Añadir `POST /quotes/:id/accept`: CLIENT dueño (403 ajeno), ACTIVE→409, QUOTED→ACTIVE vía assertTransition, tx service.update + Payment stub `commission=0`; `P2002`→`AlreadyAcceptedError`.

**Acepta (REQ-003/006):** accept + Payment OK.

---

## T5 — Mount routers + routes/index.ts _(requiere PG up)_

**Acción:** Exportar `serviceQuotesRouter` y `quotesAcceptRouter` desde `quotes.routes.ts`; montar en `backend/src/routes/index.ts` bajo `/services` y `/quotes`.

**Acepta (wiring):** rutas OK.

---

## T6 — Unit tests Zod schemas (TDD) _(unit, no Docker)_

**Test primero:** Crear `backend/__tests__/quotes.schema.test.ts`: `createQuoteSchema` válido/inválido, `acceptQuoteSchema` con `{}`.

**Luego impl:** ajustar schemas.

**Acepta (REQ-004):** tests green.

---

## T7 — Db smoke quotes lifecycle (TDD) _(requiere PG+Redis up)_

**Test primero:** Crear `backend/__tests__/db/quotes.lifecycle.test.ts` (supertest + helpers + mock queue): POST quote, GET visibilidad, accept ACTIVE+Payment, doble-accept 409, 403/401.

**Acepta (REQ-001/002/003/005/006/007):** db smoke green.

---

## T8 — README + testing docs _(sin test)_

**Acción:** Añadir sección Cotizaciones en `README.md`; actualizar `docs/testing/estrategia.md` con suite `quotes.lifecycle`.

**Acepta:** docs coherentes.

---

## Orden de ejecución (apply)

`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8`

(No-Docker primero; Docker al final.)

## Commit strategy

`feat(shared): add quote schemas`; `feat(backend): add quotes routes, accept and payment stub`; `chore(backend): mount quotes routers`; `test(backend): add quote schema and lifecycle tests`; `docs: add quotes readme and testing strategy`.

## Next

Etapa `apply`: ejecutar T1→T8 con TDD. **Orchestrator:** pedir confirmación del flujo antes de apply.

---

## Progreso apply

- [ ] T1 — Shared schemas + tipos (Zod)
- [ ] T2 — AlreadyAcceptedError + quotes.routes (POST quote)
- [ ] T3 — GET /services/:id/quotes
- [ ] T4 — POST /quotes/:id/accept + Payment stub
- [ ] T5 — Mount routers + routes/index.ts
- [ ] T6 — Unit tests Zod schemas (TDD)
- [ ] T7 — Db smoke quotes lifecycle (TDD)
- [ ] T8 — README + testing docs
