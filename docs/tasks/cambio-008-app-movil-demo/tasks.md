# Tasks — Cambio-008: App Móvil Demo

**Change ID:** `cambio-008-app-movil-demo` · **Branch:** `feature/cambio-008-app-movil-demo`

Track A: 4 gaps backend con TDD. Track B: app Expo Dev Build. Mobile verificado manual por Gherkin; sin tests unitarios en Demo.

---

## Track A — Backend gaps

### T1 — CORS deps + env + test TDD
Extender `backend/__tests__/env.test.ts` con `CORS_ORIGIN`. Añadir `cors` + `@types/cors` a `backend/package.json` y `CORS_ORIGIN` en `backend/src/lib/env.ts`.

**Commit:** `feat(backend): add cors middleware + CORS_ORIGIN env (T1)`

### T2 — Wire `cors()` en app.ts
Montar `cors()` en `backend/src/app.ts` entre `express.json()` y el router usando `env.CORS_ORIGIN`.

**Commit:** `feat(backend): wire cors middleware in app (T2)`

### T3 — Shared operator schemas
Crear `shared/src/schemas/operator.schema.ts` con schemas de operador; exportar desde `shared/src/index.ts`; build OK.

**Commit:** `feat(shared): add operator schemas (T3)`

### T4 — Operator routes + tests TDD
Crear `backend/__tests__/operator.routes.test.ts` (POST 201/409/401/403; PATCH 200). Implementar `backend/src/routes/operator.routes.ts` y montar en `backend/src/routes/index.ts`.

**Commit:** `feat(backend): add operator routes + tests (T4)`

### T5 — `/api/me` route + tests TDD
Crear `backend/__tests__/me.routes.test.ts` (GET 200 con/sin perfiles, 401). Implementar `backend/src/routes/me.routes.ts` y montar en `backend/src/routes/index.ts`.

**Commit:** `feat(backend): add /me route + tests (T5)`

---

## Track B — Mobile app Expo Dev Build

### T6 — Scaffold Expo Dev Build
Crear `app/package.json`, `app.json`, `tsconfig.json`, `metro.config.js`, `babel.config.js`, `.gitignore`. Añadir `"app"` a `workspaces` raíz. No prebuild aún.

**Commit:** `feat(app): scaffold Expo Dev Build config (T6)`

### T7 — Stores + Axios + SecureStorage
Crear `app/src/stores/{authStore,servicesStore,uiStore}.ts`; `app/src/lib/secureStorage.ts`; `app/src/lib/api.ts` con baseURL `EXPO_PUBLIC_API_URL`, Bearer y logout en 401.

**Commit:** `feat(app): add stores + axios client + secureStorage (T7)`

### T8 — Navigation tree + App bootstrap
Crear `app/src/navigation/{RootStack,AuthStack,OnboardingStack,ClientStack,OperatorStack}.tsx`; `app/src/App.tsx` valida env, inicializa Mapbox e hidrata authStore.

**Commit:** `feat(app): add navigation tree + App bootstrap (T8)`

### T9 — Auth OTP screens
Crear `app/src/screens/auth/{PhoneScreen,CodeScreen}.tsx` y `app/src/lib/apiAuth.ts`; persistir token y userId en SecureStore.

**Commit:** `feat(app): add auth OTP screens (T9)`

### T10 — Onboarding screens
Crear `app/src/screens/onboarding/{RolePickerScreen,ClientProfileScreen,OperatorProfileScreen}.tsx`; `apiOnboarding.ts`; OPERATOR POST `/api/operator/profile`; CLIENT a home directo.

**Commit:** `feat(app): add onboarding screens (T10)`

### T11 — Client screens
Crear `app/src/screens/client/{ServicesListScreen,NewServiceScreen,ServiceDetailScreen,PaymentScreen}.tsx`; `apiServices.ts`; picker Mapbox; polling quotes; pago WebBrowser.

**Commit:** `feat(app): add client screens (T11)`

### T12 — Operator screens
Crear `app/src/screens/operator/{AvailableToggleScreen,NearbyServicesScreen,ActiveServiceScreen}.tsx`; toggle envía `PATCH /api/operator/location`; polling `/services/nearby`; cotizar; completar con 409 `PAYMENT_PENDING`.

**Commit:** `feat(app): add operator screens (T12)`

### T13 — Mapbox init + picker + usePolling
Inicializar Mapbox en `App.tsx`; crear `app/src/components/MapboxPicker.tsx`; crear `app/src/lib/usePolling.ts` con concurrencia y pausa por focus.

**Commit:** `feat(app): add Mapbox init + reusable picker + usePolling (T13)`

### T14 — App setup runbook
Crear `app/README.md` con install, prebuild, `MAPBOX_DOWNLOADS_TOKEN`, variables `EXPO_PUBLIC_*` y troubleshooting.

**Commit:** `docs: add app setup runbook (T14)`

### T15 — Regression + tasks complete
Typecheck backend, lint, format; backend tests green; smoke build; marcar T1-T15 `[x]`.

**Commit:** `style: regression + mark tasks complete (T15)`

---

## Orden de ejecución

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T13 → T11 → T12 → T14 → T15
```

T11 depende de T13; T12 paralelo tras T8.

---

## Spec compliance traceability

| REQ | Tasks |
|-----|-------|
| operator-onboarding (perfil/ubicación operador) | T3, T4 |
| auth-lifecycle delta (`GET /api/me`) | T5, T8, T9 |
| REQ-MOB-AUTH (OTP, SecureStore, Bearer, 401) | T7, T8, T9 |
| REQ-MOB-ONBOARDING (routing post-auth) | T8, T10 |
| REQ-MOB-SERVICES-CLIENT (crear servicio) | T11, T13 |
| REQ-MOB-QUOTES-LIST (polling + aceptar) | T11, T13 |
| REQ-MOB-PAYMENT (MP sandbox) | T11 |
| REQ-MOB-OPERATOR-HOME (toggle, cercanos, cotizar) | T12, T13 |
| REQ-MOB-OPERATOR-ACTIVE (completar servicio) | T12 |
| REQ-MOB-CONFIG (env al startup) | T6, T8 |

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1200-1800 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Feature branch única con size:exception |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

El cambio es grande por el scaffold Expo (~20 archivos nuevos) más backend. Se acepta PR único `size:exception` por Demo unblocking end-to-end; gran parte del diff es configuración/scaffold.

### Riesgos
- **R1 Critical — `MAPBOX_DOWNLOADS_TOKEN`:** sin él falla prebuild; mitigado en T14.
- **R2 High — Metro monorepo:** configurado en T6/T7.
- **R3 High — Pago sin deep link:** polling 3s + timeout 5min.
- **R4 Medium — Prebuild nativo:** excluido en `.gitignore`.
- **R5 Medium — Sin refresh token:** re-login tras 7d.

---

## Next

Listo para `apply`: ejecutar T1→T15. Backend TDD estricto; mobile verificación manual por Gherkin.

---

## Progreso apply

- [ ] T1 — CORS deps + env + test TDD
- [ ] T2 — Wire `cors()` en app.ts
- [ ] T3 — Shared operator schemas
- [ ] T4 — Operator routes + tests TDD
- [ ] T5 — `/api/me` route + tests TDD
- [ ] T6 — Scaffold Expo Dev Build
- [ ] T7 — Stores + Axios + SecureStorage
- [ ] T8 — Navigation tree + App bootstrap
- [ ] T9 — Auth OTP screens
- [ ] T10 — Onboarding screens
- [ ] T11 — Client screens
- [ ] T12 — Operator screens
- [ ] T13 — Mapbox init + picker + usePolling
- [ ] T14 — App setup runbook
- [ ] T15 — Regression + tasks complete
