# Spec — Cambio-004: Servicios (ciclo de vida + timer)

**Change ID:** `cambio-004-servicios` · **Etapa SDD:** Spec · **Branch:** `develop`
**Basado en:** `docs/proposals/cambio-004-servicios/proposal.md`

> Capacidad NUEVA `service-lifecycle` (sin spec previa): FULL spec con `## ADDED Requirements`. Unit tests sin DB; db smoke requieren Postgres+PostGIS y Redis up.

---

## ADDED Requirements

### REQ-001: FSM pura `serviceMachine`

`services/serviceMachine.ts` expone `canTransition(from, to, role): boolean` y `assertTransition(...)` que lanza `ConflictError` (`code: 'INVALID_TRANSITION'`). Transiciones legales: `PENDING→QUOTED` (`system`), `PENDING→CANCELLED` (`CLIENT` dueño o `system`), `QUOTED→ACTIVE` (`CLIENT`+`acceptedQuoteId`), `QUOTED→CANCELLED` (`CLIENT`), `ACTIVE→COMPLETED` (`OPERATOR` asignado). `ACTIVE→CANCELLED` no permitido. Puro sin IO.

```gherkin
Scenario: legal true / rol ilegal false / ilegal lanza ConflictError INVALID_TRANSITION
  When canTransition('PENDING','CANCELLED','CLIENT')
  Then true
  When assertTransition('COMPLETED','PENDING','CLIENT')
  Then lanza error code 'INVALID_TRANSITION'
```

### REQ-002: `POST /services`

`requireAuth`+`requireRole(CLIENT)`. Body `createServiceSchema` (`type` enum, `originLat/originLng` number, `destLat/destLng`?, `description`?, `photoUrl`?). Crea `ClientProfile` lazily (upsert `userId`). Crea `Service` `PENDING` con `expiresAt = now + SERVICE_TIMEOUT_MINUTES`. Encola BullMQ `serviceExpiry` (delay `SERVICE_TIMEOUT_MINUTES*60_000`, `data.serviceId`). 201 `{id, status, expiresAt, type, originLat, originLng}`. 401/403/400 `VALIDATION_ERROR`.

```gherkin
Scenario: crea PENDING con perfil lazy y job encolado
  Given user role=CLIENT sin ClientProfile
  When POST /services con body válido
  Then 201 status 'PENDING', expiresAt futura, ClientProfile creado
  And queue.add spy llamado con name 'serviceExpiry'
Scenario: body inválido → 400 VALIDATION_ERROR
  When POST /services sin originLat
  Then 400 { issues }
```

### REQ-003: `GET /services/nearby`

`requireAuth`+`requireRole(OPERATOR)`. Query `lat`/`lng` number req, `radiusKm`? default `NEARBY_RADIUS_KM`. Raw SQL `ST_DWithin(geography(...), :meters)` sobre `Service` `status='PENDING'` y `expiresAt > now`. Array público sin datos sensibles del cliente. No `previewFeatures postgis`. 401/403/400.

```gherkin
Scenario: solo PENDING dentro del radio; sin lat/lng → 400
  Given PENDING a 1 km, PENDING a 10 km, COMPLETED a 1 km
  When GET /nearby?lat=..&lng=..&radiusKm=5
  Then 200 con array que contiene solo el PENDING cercano
```

### REQ-004: `GET /services/:id`

`requireAuth`. Dueño (`clientProfile.userId === req.user.id`) ve completo. Operador (`role=OPERATOR`) ve público. Ajeno e inexistente → 404 (no revela existencia).

```gherkin
Scenario: dueño ve completo; operador ve público; ajeno/inexistente → 404
  Given service clientProfile.userId === req.user.id
  When GET /services/:id
  Then 200 con todas las columnas
  Given service PENDING y req.user.role=OPERATOR
  Then 200 sin campos sensibles del cliente
```

### REQ-005: `PATCH /services/:id/status`

`requireAuth`. Body `updateServiceStatusSchema` (`status` enum). Carga `Service`, llama `assertTransition(current, target, role)`. Ownership: `PENDING→CANCELLED` solo `CLIENT` dueño o `system`; `ACTIVE→COMPLETED` solo `OPERATOR` asignado al `acceptedQuoteId`. `QUOTED→ACTIVE` inalcanzable runtime en cambio-004 (sin quotes) → comentario explícito. 200 actualizado; 409 `INVALID_TRANSITION`, 404, 400, 403 ownership.

```gherkin
Scenario: dueño cancela PENDING; operador completa ACTIVE asignado
  Given service PENDING clientProfile.userId === req.user.id
  When PATCH /status { status: 'CANCELLED' }
  Then 200 status 'CANCELLED'
  Given service ACTIVE acceptedQuoteId del operator
  When PATCH /status { status: 'COMPLETED' } (OPERATOR)
  Then 200 status 'COMPLETED'
Scenario: transición ilegal → 409
  Given service PENDING
  When PATCH /status { status: 'COMPLETED' } (CLIENT)
  Then 409 { code: 'INVALID_TRANSITION' }
```

### REQ-006: Worker `serviceExpiry` + `expirePendingService`

`POST /services` encola `serviceExpiry` (delay `SERVICE_TIMEOUT_MINUTES*60_000`, `data.serviceId`). Worker invoca `expirePendingService(serviceId)` (pura): si `PENDING` → `assertTransition(PENDING, CANCELLED, 'system')` + persist + `notifyClient(service, 'expired')`. Idempotente (no `PENDING` → no-op). Sin auth.

```gherkin
Scenario: PENDING → CANCELLED
  Given service PENDING vigente (mock prisma)
  When expirePendingService(serviceId)
  Then persiste 'CANCELLED' y llama notifyClient
Scenario: idempotente sobre CANCELLED → no-op
  Given service status 'CANCELLED'
  When expirePendingService(serviceId)
  Then sin persist
```

### REQ-007: `notifyClient` stub

`lib/notifications.ts` expone `notifyClient(service, event)` que loggea `{event, serviceId, userId}`. No llama FCM. Interfaz estable para MVP.

```gherkin
Scenario: loggea evento
  When notifyClient(service, 'expired')
  Then loggea { event: 'expired', serviceId, userId }
```

### REQ-008: Env vars

`env.ts` valida `REDIS_URL` (req dev/prod, opt test), `SERVICE_TIMEOUT_MINUTES` (int default 15), `NEARBY_RADIUS_KM` (number default 5). Error claro si falta `REDIS_URL` fuera de test.

```gherkin
Scenario: defaults aplican
  Given solo REDIS_URL definido
  When se parsea env
  Then SERVICE_TIMEOUT_MINUTES === 15 y NEARBY_RADIUS_KM === 5
Scenario: REDIS_URL ausente en prod lanza error claro
  Given NODE_ENV='production' sin REDIS_URL
  Then lanza error que menciona REDIS_URL
```

### REQ-009: `validate(schema, source)`

Factory Zod sobre `req[source]`. Error → 400 `{error, code: 'VALIDATION_ERROR', issues}`. Éxito → `req.validated[source] = parsed` + `next()`.

```gherkin
Scenario: body válido
  When request con body válido y validate(schema, 'body')
  Then req.validated.body === parsed y next() llamado
Scenario: body inválido → 400 issues, next no se llama
```

### REQ-010: `_init_postgis` + raw SQL

Migración idempotente `CREATE EXTENSION IF NOT EXISTS postgis;`. `/nearby` usa `$queryRaw` con binds. No `previewFeatures postgis`.

```gherkin
Scenario: extensión habilitada e idempotente
  When se aplica y re-aplica _init_postgis
  Then pg_extension contiene 'postgis' sin fallo
```

---

**Cobertura:** REQ-001/006/007/009 unit; REQ-002/004/005 unit+db smoke (supertest cookie jar); REQ-003/010 db smoke PostGIS. **Next:** etapa `design`.