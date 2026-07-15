# Design — cambio-008-app-movil-demo

**Capabilities afectadas:**

- `operator-onboarding` (NEW) — Track A backend gaps operator
- `auth-lifecycle` (MODIFIED, delta `GET /me`) — Track A backend gaps sesión
- `mobile-app-demo` (NEW) — Track B app Expo Dev Build

**Enfoque:** 2 tracks semánticamente separables en git commits, fusionados en un único cambio SDD. Track A (4 gaps de backend — pequeños, bloques TDD pura) + Track B (app móvil Expo Dev Build — el grueso del cambio). No requiere migración Prisma: `OperatorProfile`, `ClientProfile`, `User` ya existen desde cambio-002.

## Overview

El backend Demo está 100% listo (cambios 001-007) pero la app móvil no existe (`app/` solo tiene `.gitkeep`). Este cambio entrega ambos extremos de la Demo end-to-end: primero cierra 4 gaps pequeños de backend que bloquean el flujo móvil (operator profile, location, `/me`, CORS), luego crea la app Expo consumidora.

El seam `PaymentGateway` de cambio-006/007 se respeta sin modificaciones: la app solo consume `POST /payments/:id/init` y `POST /payments/webhook`. Los specs de `service-lifecycle`, `quote-lifecycle`, `payment-lifecycle` no se modifican — solo se consumen desde la app.

## Decisiones (D1-D16)

### Track A — Backend gaps

**D1 — `POST /api/operator/profile`.** NEW archivo `backend/src/routes/operator.routes.ts`. Reusa `validate` middleware + `requireRole(OPERATOR)` de `middleware/auth.ts`. Body Zod nuevo en `shared/src/schemas/operator.schema.ts`: `createOperatorProfileSchema` ({ truckType: string, licensePlate: string, photoUrl?: string, available?: boolean, lastLatitude?: number, lastLongitude?: number }). Flujo: verifica si ya existe OperatorProfile para userId → 409 con `code: 'PROFILE_EXISTS'`; si no, prisma.create. Retorna 201 con el perfil. Sin reorganizar routers existentes.

**D2 — `PATCH /api/operator/location`.** Mismo `operator.routes.ts`. Body `updateLocationSchema` ({ lastLatitude: number, lastLongitude: number, available?: boolean }). Solo toca el propio perfil (userId extraído de `req.user`). Siempre actualiza `lastSeenAt = new Date()`. Retorna 200 con el perfil actualizado. No requiere rol especial más allá del auth OPERATOR implícito al poseer el perfil.

**D3 — `GET /api/me` en NEW archivo `backend/src/routes/me.routes.ts`.** Se separa del operator router por semántica: es sobre hidratación de sesión, no sobre ser operador. Un cliente (sin OperatorProfile) también lo llama. Respuesta compuesta: `prisma.user.findUnique({ where: { id }, include: { clientProfile: true, operatorProfile: true } })`. 401 si no Bearer. 200 con `{ user: { id, phoneNumber, email?, name?, role }, clientProfile?: {...}, operatorProfile?: {...} }`. Sin filtros de campos sensibles — el token ya está en manos del user.

**D4 — `cors()` en `backend/src/app.ts`.** Paquete `cors` + `@types/cors`. Origen configurable via env `CORS_ORIGIN` (string, default `*` en dev, en prod lista separada por comas o regex). Insertar entre `express.json()` y `router`. No genera spec REQ (configuración transversal, sin comportamiento de dominio).

**D5 — TDD backend.** Vitest + mocks de PrismaClient (patrón cambio-004/005 auth + services tests). Tests por archivo:

- `backend/__tests__/operator.routes.test.ts` — POST profile 201, 409 si existe, 401 sin Bearer, 403 si no OPERATOR; PATCH location 200, actualiza lastSeenAt, 401 sinBearer.
- `backend/__tests__/me.routes.test.ts` — 200 con perfil completo, 200 sin perfiles (solo user), 401 sin Bearer.
- Extender `backend/__tests__/env.test.ts` con escenarios `CORS_ORIGIN` (default dev '*', required prod).

### Track B — Mobile app Expo Dev Build

**D6 — Expo Dev Build setup.** `app/package.json` con `expo ~51.x`, `react-native`, `react-navigation v7`, `zustand`, `axios`, `@rnmapbox/maps`, `socket.io-client`, `expo-secure-store`, `expo-web-browser`, `expo-linking`, `expo-status-bar`. `app/app.json` con plugins `@rnmapbox/maps` (configura token de download en build). `npx expo prebuild` genera `android/` e `ios/` — ambos **gitignored** (ver D-R4). Setup documentado en `app/README.md` (prebuild + secret MAPBOX_DOWNLOADS_TOKEN en EAS).

**D7 — Metro monorepo.** `app/metro.config.js` con `watchFolders` apuntando a `../shared` (y `nodeModulesPaths` incluyendo `../node_modules` y `./node_modules`). Resolución de `@destrabe/shared` via workspace symlink. Reusa el patrón estándar Expo monorepo.

**D8 — React Navigation v7.** Árbol condicional según estado de authStore:

```
RootStack
├─ (null token)        AuthStack: PhoneScreen → CodeScreen
├─ (sin perfil rol)     OnboardingStack: RolePicker → ClientProfileForm | OperatorProfileForm
├─ (role=CLIENT)        ClientTabs: ServicesList, Profile
│   └─ nested ClientStack: NewService (MapboxPicker), ServiceDetail (quotes polling+accept), Payment
└─ (role=OPERATOR)      OperatorTabs: AvailableToggle, NearbyServices, ActiveService
```

`Stack.Screen` con `options` por pantalla; sin drawer navigator (Demo simple).

**D9 — Zustand stores (3 pequeños).**

- `authStore`: `{ user, token, role, hydrated, login(token,user), logout(), hydrate() }`. Persist SOLO token + userId en SecureStore vía middleware custom `persist` (`destrabe.token`, `destrabe.userId`).
- `servicesStore`: `{ myServices[], activeService, fetchMy(), fetchActive() }`. Sin persist — siempre fetch fresco al montar.
- `uiStore`: `{ loading: Set<string>, toasts[] }`. Helper `withLoading(key, fn)` para botones.

Zustand v5 con `create` y tipos TS fuertes. Stores son singletons fuera del React tree (accesibles desde interceptores Axios).

**D10 — Axios client.** `app/src/lib/api.ts`. baseURL = `EXPO_PUBLIC_API_URL`. Interceptor request: inyecta `Authorization: Bearer ${authStore.getState().token}`. Response interceptor: si 401 → `authStore.logout()` + reset navigation (vía evento publicado en uiStore). Manejo de errores de red (timeout, offline) con toast genérico. Tipado Response genérico reusando tipos de `@destrabe/shared`.

**D11 — API contract mapping.** El spec mobile (D11 REQ-MOB-QUOTES-LIST) referenció `POST /services/:id/quotes/:qid/accept` para aceptar, pero el backend real (cambio-005) es `POST /quotes/:id/accept`. La app implementa `apiQuotes.ts` con `acceptQuote(quoteId)` → POST real. No hay cambio de spec — solo mapping de la app. Anotado en tasks como aceptance note. Mismo principio para otros endpoints (el spec referencia rutas canónicas, la app ajusta a las reales).

**D12 — Mapbox.** `@rnmapbox/maps` v10+. Init en `App.tsx` antes del RootStack: `Mapbox.setAccessToken(EXPO_PUBLIC_MAPBOX_TOKEN)`. Componente reusable `<MapboxPicker latitude longitude onPick />` en `app/src/components/MapView.tsx`. Usado en `NewServiceScreen` (origin + opcional dest) y `OperatorProfileScreen` (default lastLat/lastLng). Sin tracking en vivo (Demo out of scope) — solo picker estático.

**D13 — `usePolling` hook.** `app/src/lib/usePolling.ts`: `usePolling(fetcher, intervalMs, enabled)`. Limpia `setInterval` en unmount. Se pausa con `enabled=false` cuando `useIsFocused()` retorna false (React Navigation focus). Intervalos (D-locked): 5s quotes cliente, 3s payment, 10s servicios cercanos operador. Concurrency control: solo una fetch en vuelo (ref flag).

**D14 — MP sandbox.** `expo-web-browser` `openBrowserAsync(redirectUrl)` abre el `init_point` o `sandbox_init_point` devuelto por `POST /payments/:id/init`. Sin deep link: la app no registra scheme de retorno — MP solo envía webhook server-side. La app polling payment cada 3s, timeout 5min → UI "pendiente, revisa más tarde".

**D15 — SecureStore.** `expo-secure-store` con claves `destrabe.token`, `destrabe.userId`. `authStore.hydrate()` los lee en bootstrap de `App.tsx` antes de decidir el navigator root (Auth / Onboarding / Client / Operator). Escritura en `login()`, borrado en `logout()`.

**D16 — Testing strategy.**

- Backend (Track A): TDD estricto, Vitest + mocks Prisma. RED→GREEN.
- Mobile (Track B): **Demo NO lleva tests unitarios RN** — el costo de testar apps RN (mocks de RN, navigation, Mapbox) es alto y no aporta confianza para Demo. Explicit tradeoff: verificación manual basada en escenarios Gherkin del spec `mobile-app-demo` con 2 dispositivos/emuladores. Mobile TDD queda como deuda para MVP.

## Archivos NEW vs MODIFIED

### Track A — Backend

- **NEW** `backend/src/routes/operator.routes.ts`
- **NEW** `backend/src/routes/me.routes.ts`
- **NEW** `backend/__tests__/operator.routes.test.ts`
- **NEW** `backend/__tests__/me.routes.test.ts`
- **NEW** `shared/src/schemas/operator.schema.ts`
- **MODIFIED** `backend/src/routes/index.ts` (mount `/api/operator` + `/api/me`)
- **MODIFIED** `backend/src/app.ts` (cors())
- **MODIFIED** `backend/src/lib/env.ts` (CORS_ORIGIN)
- **MODIFIED** `backend/__tests__/env.test.ts` (+escenarios CORS TDD)
- **MODIFIED** `shared/src/index.ts` (export `createOperatorProfileSchema`, `updateLocationSchema`)
- **MODIFIED** `backend/package.json` (`cors` + `@types/cors` deps)

### Track B — Mobile (árbol NEW bajo `app/`, native dirs gitignored)

- **NEW** `app/package.json`, `app/app.json`, `app/tsconfig.json`, `app/metro.config.js`, `app/babel.config.js`, `app/.gitignore` (exclude `android/`, `ios/`, `.expo/`)
- **NEW** `app/src/App.tsx`
- **NEW** `app/src/navigation/{RootStack,AuthStack,OnboardingStack,ClientStack,OperatorStack}.tsx`
- **NEW** `app/src/stores/{authStore,servicesStore,uiStore}.ts`
- **NEW** `app/src/lib/{api.ts,secureStorage.ts,usePolling.ts,useMapbox.ts,mapboxPicker.tsx,apiQuotes.ts}`
- **NEW** `app/src/screens/auth/{PhoneScreen,CodeScreen}.tsx`
- **NEW** `app/src/screens/onboarding/{RolePickerScreen,ClientProfileScreen,OperatorProfileScreen}.tsx`
- **NEW** `app/src/screens/client/{ServicesListScreen,NewServiceScreen,ServiceDetailScreen,PaymentScreen}.tsx`
- **NEW** `app/src/screens/operator/{AvailableToggleScreen,NearbyServicesScreen,ActiveServiceScreen}.tsx`
- **NEW** `app/src/components/{ServiceCard,QuoteCard,StatusBadge}.tsx`
- **NEW** `app/README.md` (setup prebuild + secret MAPBOX_DOWNLOADS_TOKEN + EXPO_PUBLIC_* env + runbook dev local)
- **MODIFIED** `package.json` raíz (add `"app"` a `workspaces` array)

## Riesgos & mitigaciones

- **R1 Critical — `MAPBOX_DOWNLOADS_TOKEN` secret de build.** Sin este token, `@rnmapbox/maps` no compila en `prebuild`. Mitigación: `app/README.md` documenta el alta en mapbox.com + configuración EAS secret + fallback de descarga manual del tarball.
- **R2 High — Metro monorepo config.** `@destrabe/shared` workspace symlink puede romper Metro resolver. Mitigación: `metro.config.js` con `watchFolders` + `nodeModulesPaths` correctos (patrón estándar Expo monorepo docs).
- **R3 High — Deep link MP sandbox.** Demo no implementa, solo polling. Tradeoff explicito: tras `openBrowserAsync` el navegador MP queda abierto; la app polling en background confirma. MVP puede añadir scheme `destrabe://` + `Linking` para retorno.
- **R4 Medium — Android/iOS prebuild outputs.** `npx expo prebuild` genera `android/` e `ios/` con cientos de MB. Mitigación: `app/.gitignore` los excluye. Iteraciones JS/TS se rebuild con hot reload sin re-prebuild.
- **R5 Medium — Bearer sin refresh token.** Demo sin refresh; sesión expira 7d → re-login manual. MVP: refresh endpoint + refresh token en SecureStore.
- **R6 Low — Estado de app entre navigation transitions.** Zustand como singletons fuera del React tree — accesible desde interceptores y hooks sin prop drilling.

## Out of scope (Demo)

- Tracking GPS en vivo (MVP)
- Socket.io server real (MVP — Demo usa polling)
- FCM push notifications (MVP — Demo usa polling)
- Upload imágenes a S3/CDN — usar `photoUrl` string plano en Demo
- Panel admin web `frontend/` (MVP)
- Historial de servicios y calificaciones / reviews (MVP)
- Multi-rol por cuenta (Demo: 1 user.role = 1 perfil único)
- Refresh token flow (MVP)
- Refunds / cancelación de pago
- Validación de formato de `licensePlate` (Demo)

## Acceptance note (D11)

El spec `mobile-app-demo.md` referencia endpoints canónicos del旅程 Demo (e.g. `POST /services/:id/quotes/:qid/accept`). La app implementa un mapeo fino en `app/src/lib/apiQuotes.ts` al backend real (`POST /quotes/:id/accept` — cambio-005). No hay cambio de spec — el mapping es detalle de implementación de la app. Tareas D11 lo reflejan: `apiQuotes.ts` es la capa de indirección entre pantallas y backend.

Sin migración Prisma requerida. Schema ya tiene `OperatorProfile`, `ClientProfile`, `User` desde cambio-002.
