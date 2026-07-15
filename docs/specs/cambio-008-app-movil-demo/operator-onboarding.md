# Spec — Operator Onboarding (NUEVA)

**Change ID:** `cambio-008-app-movil-demo` · **Capability:** `operator-onboarding` (NUEVA)
**Basado en:** `docs/proposals/cambio-008-app-movil-demo/proposal.md`

> Capacidad nueva. El operador no podía registrar perfil ni ubicación desde la app; estos endpoints cierran el gap bloqueante para el flujo Demo operador.

---

## Requirements

### REQ-OP-001: `POST /api/operator/profile`

`requireAuth` + `requireRole(OPERATOR)`. Body validado por `createOperatorProfileSchema` (Zod): `truckType` string requerido, `licensePlate` string requerido (sin validación de formato en Demo), `photoUrl` string opcional, `available` boolean opcional (default `false`), `lastLatitude` number opcional, `lastLongitude` number opcional. Si ya existe `OperatorProfile` para `req.user.id` → 409 `{ code: 'PROFILE_ALREADY_EXISTS' }`. Crea perfil y responde 201 con el perfil completo.

**Trazabilidad REST:** `POST /api/operator/profile` → `operator.routes.ts` → `operatorController.createProfile`.

```gherkin
Escenario: operador crea perfil por primera vez
  Dado un usuario con role=OPERATOR sin OperatorProfile
  Cuando POST /api/operator/profile con { truckType: "grua", licensePlate: "ABC123" }
  Entonces responde 201 con el perfil creado
  Y el perfil tiene available=false por defecto

Escenario: perfil ya existe → 409
  Dado un OPERATOR con OperatorProfile existente
  Cuando POST /api/operator/profile
  Entonces responde 409 { code: 'PROFILE_ALREADY_EXISTS' }

Escenario: body inválido → 400
  Cuando POST /api/operator/profile sin truckType
  Entonces responde 400 { code: 'VALIDATION_ERROR', issues: [...] }

Escenario: sin auth → 401; rol CLIENT → 403
  Cuando POST /api/operator/profile sin Bearer token
  Entonces responde 401
  Cuando POST /api/operator/profile con role=CLIENT
  Entonces responde 403
```

### REQ-OP-002: `PATCH /api/operator/location`

`requireAuth` + `requireRole(OPERATOR)`. Solo actualiza el perfil propio (`OperatorProfile.userId === req.user.id`); si no existe perfil → 404. Body: `lastLatitude` number requerido, `lastLongitude` number requerido, `available` boolean opcional. Actualiza `lastSeenAt = new Date()`. Responde 200 con `{ lastLatitude, lastLongitude, lastSeenAt, available }`.

**Trazabilidad REST:** `PATCH /api/operator/location` → `operator.routes.ts` → `operatorController.updateLocation`.

```gherkin
Escenario: operador actualiza ubicación propia
  Dado un OPERATOR con OperatorProfile existente
  Cuando PATCH /api/operator/location con { lastLatitude: 4.6, lastLongitude: -74.0 }
  Entonces responde 200 con lastSeenAt actualizado a ahora

Escenario: toggle available en el mismo PATCH
  Dado un OPERATOR con available=false
  Cuando PATCH /api/operator/location con { lastLatitude: 4.6, lastLongitude: -74.0, available: true }
  Entonces responde 200 con available=true

Escenario: sin perfil propio → 404
  Dado un OPERATOR sin OperatorProfile
  Cuando PATCH /api/operator/location
  Entonces responde 404

Escenario: body sin coordenadas → 400
  Cuando PATCH /api/operator/location con {}
  Entonces responde 400 { code: 'VALIDATION_ERROR' }
```

### REQ-OP-003: Schemas de validación

`createOperatorProfileSchema` y `updateOperatorLocationSchema` definidos en Zod, reutilizables desde `@destrabe/shared`. Errores de validación → 400 `VALIDATION_ERROR` vía middleware `validate(schema, 'body')`.

```gherkin
Escenario: createOperatorProfileSchema rechaza truckType vacío
  Cuando se valida { truckType: "", licensePlate: "ABC123" }
  Entonces falla con issue de string min

Escenario: updateOperatorLocationSchema requiere ambos coords
  Cuando se valida { lastLatitude: 4.6 }
  Entonces falla con issue de required en lastLongitude
```

---

**Cobertura:** REQ-OP-003 unit; REQ-OP-001/002 unit + db smoke (supertest con Bearer). **Next:** etapa `design`.
