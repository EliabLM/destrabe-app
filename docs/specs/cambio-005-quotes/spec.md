# Spec — Cambio-005: Cotizaciones (quotes/offers)

**Change ID:** `cambio-005-quotes` · **Etapa SDD:** Spec · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-005-quotes/proposal.md`

> Capacidad NUEVA `quote-lifecycle` (sin spec previa): FULL spec con `## ADDED Requirements`. `service-lifecycle` (cambio-004) no se modifica — `GET /services/:id` no incluye quotes.

---

## ADDED Requirements

### REQ-001: `POST /services/:id/quotes`

`requireAuth`+`requireRole(OPERATOR)`. Valida `OperatorProfile` preexistente (422 `OPERATOR_PROFILE_REQUIRED` si ausente). Service MUST estar `PENDING` o `QUOTED`; otro status → 409 `INVALID_TRANSITION`. Crea `Quote`. Si service estaba `PENDING` → `assertTransition(PENDING, QUOTED, 'system')`. `notifyClient(service, 'quote_received')` en CADA quote exitosa. 201.

```gherkin
Scenario: operador con perfil crea quote sobre service PENDING
  Given OPERATOR con OperatorProfile y service PENDING
  When POST /services/:id/quotes con body válido
  Then 201, service QUOTED, notifyClient llamado con 'quote_received'
Scenario: service QUOTED acepta quote adicional sin transición FSM
  Given service QUOTED
  When POST /services/:id/quotes
  Then 201, service permanece QUOTED, notifyClient llamado
Scenario: sin OperatorProfile → 422
  Given OPERATOR sin OperatorProfile
  When POST /services/:id/quotes
  Then 422 { code: 'OPERATOR_PROFILE_REQUIRED' }
Scenario: service ACTIVE rechaza quote → 409
  Given service ACTIVE
  When POST /services/:id/quotes
  Then 409 { code: 'INVALID_TRANSITION' }
```

### REQ-002: `GET /services/:id/quotes`

`requireAuth`. Service MUST existir (404 si no). Dueño (`clientProfile.userId === req.user.id`) ve todas con datos públicos del operador (`truckType`, `licensePlate`, `rating`). Operador ve solo sus quotes. Admin ve todas. Ajeno → 404.

```gherkin
Scenario: dueño ve todas con datos de operador
  Given service con 2 quotes, req.user es CLIENT dueño
  When GET /services/:id/quotes
  Then 200 array con 2 quotes: truckType, licensePlate, rating
Scenario: operador ve solo sus quotes
  Given service con quotes de 2 operadores, req.user es OPERATOR A
  When GET /services/:id/quotes
  Then 200 array solo con quotes del OPERATOR A
Scenario: ajeno → 404
  Given req.user no es dueño ni operador del service
  When GET /services/:id/quotes
  Then 404
```

### REQ-003: `POST /quotes/:id/accept`

`requireAuth`+`requireRole(CLIENT)`. Solo dueño del service SHALL aceptar; no-dueño → 403. Service MUST estar `QUOTED`; si `ACTIVE` → 409 `ALREADY_ACCEPTED`; otro status → 409 `INVALID_TRANSITION`. `assertTransition(QUOTED, ACTIVE, 'CLIENT')`. Setea `acceptedQuoteId` (`@unique` DB). Crea Payment stub (REQ-006). 200.

```gherkin
Scenario: dueño acepta quote → ACTIVE + Payment stub
  Given service QUOTED, req.user es CLIENT dueño
  When POST /quotes/:id/accept
  Then 200 service ACTIVE, acceptedQuoteId set, Payment PENDING creado
Scenario: doble accept → 409 ALREADY_ACCEPTED
  Given service ACTIVE con acceptedQuoteId
  When POST /quotes/:id/accept
  Then 409 { code: 'ALREADY_ACCEPTED' }
Scenario: no-dueño → 403
  Given service QUOTED, req.user no es dueño
  When POST /quotes/:id/accept
  Then 403
```

### REQ-004: Schemas de validación Zod

`createQuoteSchema`: `amount` number positivo (req), `estimatedMinutes` int positivo (opt), `note` string max 500 (opt). `acceptQuoteSchema`: object vacío `{}`. Ambos vía `validate(schema, 'body')`. Inválido → 400 `VALIDATION_ERROR`.

```gherkin
Scenario: createQuoteSchema válido e inválido
  When validate(createQuoteSchema) con { amount: -1 }
  Then 400 VALIDATION_ERROR
  When validate(createQuoteSchema) con { amount: 1500 }
  Then next() llamado
Scenario: acceptQuoteSchema acepta body vacío
  When validate(acceptQuoteSchema) con {}
  Then next() llamado
```

### REQ-005: Errores de autorización y transición

Endpoints bajo `requireAuth` → 401 sin token. `requireRole` → 403 rol incorrecto. Service inexistente → 404. No-dueño accept → 403. Transición FSM ilegal → 409 `INVALID_TRANSITION`.

```gherkin
Scenario: sin auth → 401; rol incorrecto → 403
  When POST /services/:id/quotes sin token
  Then 401
  When POST /services/:id/quotes con role=CLIENT
  Then 403
Scenario: service inexistente → 404
  When GET /services/nonexistent/quotes
  Then 404
```

### REQ-006: Payment stub

Al aceptar, crear `Payment`: `amount = quote.amount`, `commission = 0`, `operatorAmount = quote.amount`, `status = 'PENDING'`, `mpPaymentId = null`. Placeholder para `cambio-006`. `serviceId` `@unique` previene duplicados.

```gherkin
Scenario: Payment creado con campos stub
  Given quote amount=5000
  When POST /quotes/:id/accept exitoso
  Then Payment existe con amount=5000, commission=0, operatorAmount=5000, status='PENDING'
```

### REQ-007: Notificación `quote_received`

`notifyClient(service, 'quote_received')` MUST invocarse en CADA `POST /services/:id/quotes` exitoso (no solo la primera). Interfaz sin cambios (stub log-only).

```gherkin
Scenario: notificación en cada quote
  Given service QUOTED con 1 quote previa
  When POST /services/:id/quotes (segunda quote)
  Then notifyClient llamado con 'quote_received'
```

---

**Cobertura:** REQ-004/007 unit; REQ-001/002/003/005/006 unit+db smoke (supertest). **Next:** etapa `design`.
