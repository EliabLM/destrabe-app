# Delta Spec — Auth Lifecycle (MODIFICADA)

**Change ID:** `cambio-008-app-movil-demo` · **Capability:** `auth-lifecycle` (MODIFICADA)
**Basado en:** `docs/specs/cambio-003-auth/spec.md` + `docs/proposals/cambio-008-app-movil-demo/proposal.md`

> Delta sobre `auth-lifecycle` (cambio-003). Añade `GET /api/me` para hidratación de sesión en la app móvil. Pertenece a `auth-lifecycle` porque es el endpoint de session hydration: la app lo llama tras verificar OTP o al reabrir la app para restaurar el estado del usuario (rol + perfiles). No es un perfil standalone, es la extensión auth-side del contexto de sesión.

---

## ADDED Requirements

### REQ-AUTH-011: `GET /api/me` — Hidratación de sesión compuesta

`requireAuth` (Bearer token). Devuelve respuesta compuesta: `{ user: { id, phone, role }, clientProfile?: ClientProfile, operatorProfile?: OperatorProfile }`. Busca `ClientProfile` y `OperatorProfile` por `userId === req.user.id`. Si no existe ninguno de los dos perfiles, los campos opcionales se omiten (no null explícito). Sin sesión válida → 401.

**Justificación de ubicación en auth-lifecycle:** Este endpoint es la contraparte server-side de la hidratación de sesión del cliente móvil. La app lo invoca inmediatamente después del verify OTP o al reabrir la app para reconstruir el estado local (stores Zustand). No es un CRUD de perfil — es la extensión del `GET /api/auth/get-session` de Better Auth con los perfiles asociados.

**Trazabilidad REST:** `GET /api/me` → `me.routes.ts` → `meController.getMe`.

```gherkin
Escenario: usuario CLIENT con ClientProfile
  Dado un usuario role=CLIENT con ClientProfile existente
  Cuando GET /api/me con Bearer válido
  Entonces responde 200 { user: { id, phone, role: 'CLIENT' }, clientProfile: { ... } }
  Y operatorProfile está ausente en la respuesta

Escenario: usuario OPERATOR con OperatorProfile
  Dado un usuario role=OPERATOR con OperatorProfile existente
  Cuando GET /api/me con Bearer válido
  Entonces responde 200 { user: { id, phone, role: 'OPERATOR' }, operatorProfile: { ... } }
  Y clientProfile está ausente en la respuesta

Escenario: usuario sin perfil (recién registrado)
  Dado un usuario sin ClientProfile ni OperatorProfile
  Cuando GET /api/me con Bearer válido
  Entonces responde 200 { user: { id, phone, role } }
  Y ni clientProfile ni operatorProfile están presentes

Escenario: sin Bearer token → 401
  Cuando GET /api/me sin header Authorization
  Entonces responde 401 { code: 'UNAUTHORIZED' }

Escenario: Bearer expirado → 401
  Dado un token de sesión expirado
  Cuando GET /api/me con Bearer expirado
  Entonces responde 401
```

---

**Cobertura:** REQ-AUTH-011 unit + db smoke (supertest con Bearer). **Next:** etapa `design`.
