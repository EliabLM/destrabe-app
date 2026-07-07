# Exploration — Cambio-008: App Móvil Demo

**Change ID:** `cambio-008-app-movil-demo`
**Etapa SDD:** Explore
**Branch:** `develop` (HEAD bd5e549)
**Store mode:** filesystem — `docs/{proposals,specs,designs,tasks}/cambio-008-app-movil-demo/`

## Current State

El backend está completo y funcional para el flujo Demo (cambios 001–007). El directorio `app/` solo contiene un `.gitkeep`. Este cambio es el primero que crea artefactos reales dentro de `app/`.

### Lo que el backend YA expone

- **Auth OTP** (cambio-003): Better Auth con plugin `phoneNumber` + Plivo (SMS en prod, log en dev). Sesiones JWT en cookie `session_token`. Roles `CLIENT` (default al registrarse) y `OPERATOR` (asignado manualmente vía DB o endpoint de admin; no hay endpoint público de cambio de rol).
- **Servicios** (cambio-004): CRUD de `Service` con FSM (`PENDING → QUOTED → ACTIVE → COMPLETED / CANCELLED`), búsqueda geoespacial PostGIS `ST_DWithin`, timer BullMQ 15 min.
- **Cotizaciones** (cambio-005): `POST /services/:id/quotes` (OPERATOR), `GET /services/:id/quotes` (auth), `POST /quotes/:id/accept` (CLIENT). Payment stub al aceptar (commission=0).
- **Pagos** (cambio-006/007): `POST /payments/:id/init` → redirige a MP sandbox; `POST /payments/webhook` → confirma. MercadoPago real con gateway pattern, idempotente.
- **Shared types** (`@destrabe/shared`): schemas Zod + enums (ServiceStatus, ServiceType, UserRole, PaymentStatus) + DTOs tipados. Compilado a `shared/dist/`; listo para importar desde `app/`.

### Lo que el backend **NO** tiene (gaps detectados para la app)

1. **Sin endpoint para crear/actualizar OperatorProfile.** `POST /services/:id/quotes` exige OperatorProfile preexistente (422 `OPERATOR_PROFILE_REQUIRED`), pero **no existe `POST /operator-profile` ni `PUT /operator-profile`**. El operador no puede registrar su `truckType`, `licensePlate`, ubicación inicial desde la app.
2. **Sin endpoint para actualizar ubicación del operador.** El modelo `OperatorProfile` tiene `lastLatitude`/`lastLongitude`/`lastSeenAt`, pero no hay ruta para que el operador reporte su posición actual. `GET /services/nearby` espera `lat`/`lng` en query params — la app operador debe enviarlas, pero necesita también persistirlas para recuperación de sesión.
3. **Sin CORS middleware.** `app.ts` no incluye `cors()`. La app móvil hará requests desde un origin diferente al backend (distinto puerto en dev, distinto host en prod). Esto **bloqueará** las requests del app.
4. **Sin socket.io server.** El stack de README lista `socket.io-client`, pero `backend/` no tiene dependencia `socket.io`. `notifications.ts` es solo un log stub. No hay mecanismo de push en tiempo real para notificar al cliente cuando un operador cotiza.
5. **Sin endpoint de perfil de usuario.** No hay `GET /me` ni `GET /profile` para que la app obtenga los datos del usuario autenticado (rol, teléfono, nombre). `GET /api/auth/get-session` de Better Auth devuelve datos mínimos de sesión, pero no el perfil (ClientProfile/OperatorProfile) asociado.
6. **Sin upload de imágenes.** `POST /services` acepta `photoUrl?: string`, pero no hay endpoint de upload (presigned URL S3 o endpoint multipart). La app necesitará subir fotos del vehículo averiado.

## Affected Areas

### Backend (cambios necesarios para habilitar la app — scope mínimo)

| Archivo | Motivo |
|---------|--------|
| `backend/src/app.ts` | Añadir `cors()` middleware con origin configurable (`CORS_ORIGIN` env var). Sin esto, la app no puede hacer requests. |
| `backend/src/routes/operator.routes.ts` _(nuevo)_ | `POST /operator/profile` (create/update OperatorProfile con truckType, licensePlate, lat/lng inicial) + `PATCH /operator/location` (actualizar lastLatitude/lastLongitude + lastSeenAt). **Requerido para el flujo operador.** |
| `backend/src/routes/me.routes.ts` _(nuevo)_ | `GET /me` — devuelve `{ user, clientProfile?, operatorProfile? }` para que la app sepa el estado del usuario. |
| `backend/src/lib/socket.ts` _(nuevo, opcional si se elige Socket.io)_ | Servidor socket.io adjunto al mismo HTTP server. Namespace/eventos: `quote:new` (operador → server → cliente dueño). |
| `backend/src/server.ts` | Si se añade socket.io, cambiar `app.listen` por `http.createServer(app).listen` y adjuntar el socket server. |
| `backend/src/lib/notifications.ts` | Si socket.io: reemplazar log stub por `io.to(clientSocketRoom).emit('quote:new', data)`. |
| `backend/src/lib/env.ts` | Añadir `CORS_ORIGIN` (default `*` en dev, restrictivo en prod). Opcional: `SOCKET_PORT` si socket.io en puerto separado. |
| `backend/package.json` | Añadir `cors`, `socket.io` (si aplica). |
| `infra/docker-compose.dev.yml` | Sin cambios (la app se ejecuta en el host, no en Docker; solo necesita el backend en `localhost:3000`). |

### App (archivos a crear)

| Archivo | Motivo |
|---------|--------|
| `app/package.json` | Inicializar proyecto Expo SDK 52/53. Dependencias: `expo`, `react-native`, `react-navigation`, `zustand`, `axios`, `@rnmapbox/maps`, `socket.io-client` (opcional). |
| `app/app.json` | Configuración Expo: scheme, plugins (Mapbox, expo-linking), deep link. |
| `app/tsconfig.json` | Extender `expo/tsconfig.base`, paths alias a `@destrabe/shared`. |
| `app/src/lib/api.ts` | Cliente Axios con `baseURL` configurable, interceptor de cookie/error. |
| `app/src/stores/authStore.ts` | Zustand slice: `sendOtp`, `verifyOtp`, `getSession`, `signOut`, estado `{ user, isLoading }`. |
| `app/src/stores/servicesStore.ts` | Zustand slice: `createService`, `fetchNearby`, `fetchService`, `updateStatus`. |
| `app/src/stores/quotesStore.ts` | Zustand slice: `createQuote`, `fetchQuotes`, `acceptQuote`. |
| `app/src/screens/AuthScreen.tsx` | Pantalla OTP: input de teléfono → sendOtp → input de código → verifyOtp. |
| `app/src/screens/OnboardingScreen.tsx` | Elección de rol (CLIENT/OPERATOR) + completar perfil correspondiente. |
| `app/src/screens/ClientHomeScreen.tsx` | Mapa + botón "Solicitar grúa". |
| `app/src/screens/CreateServiceScreen.tsx` | Formulario: tipo (BREAKDOWN|TRANSFER), origen en mapa, destino opcional, descripción, foto. |
| `app/src/screens/OperatorHomeScreen.tsx` | Mapa con servicios cercanos (marcadores). |
| `app/src/screens/ServiceDetailScreen.tsx` | Detalle del servicio + cotizaciones recibidas. |
| `app/src/screens/QuoteScreen.tsx` | Crear cotización (operador) o ver/aceptar cotizaciones (cliente). |
| `app/src/screens/PaymentScreen.tsx` | Iniciar pago → abrir MP sandbox en navegador. |
| `app/src/navigation/RootNavigator.tsx` | Stack navigator (React Navigation v7): Auth → Onboarding → Home (cliente/operador) → ServiceDetail → Quote/Payment. |
| `app/src/hooks/useSocket.ts` _(opcional)_ | Hook para socket.io-client, conexión/desconexión por ciclo de vida. |
| `app/src/components/` | Componentes reutilizables: `PhoneInput`, `OtpInput`, `MapView`, `ServiceCard`, `QuoteCard`. |
| `app/__tests__/` | Tests unitarios de stores con vitest (aislados de React Native). |

### Monorepo root

| Archivo | Motivo |
|---------|--------|
| `package.json` | Añadir `app` al array `workspaces` para que `npm install` resuelva dependencias del monorepo y `@destrabe/shared` sea importable. |
| `app/` | Ya existe como directorio con `.gitkeep`. Se inicializa con `npx create-expo-app@latest` o estructura manual. |

## API Contract (REST endpoints que la app debe consumir)

### Auth (Better Auth — montado bajo `/api/auth`)

| Método | Ruta | Body / Query | Respuesta | Auth | Rol |
|--------|------|-------------|-----------|------|-----|
| `POST` | `/api/auth/phone-number/send-otp` | `{ phoneNumber: string }` (E.164) | `{ success: true }` | No | — |
| `POST` | `/api/auth/phone-number/verify` | `{ phoneNumber: string, code: string }` (6 dígitos) | `{ user: { id, phoneNumber, role }, session: { id, token, expiresAt } }` + `Set-Cookie: session_token` | No | — |
| `GET` | `/api/auth/get-session` | — (cookie implícita) | `{ user, session }` o `null` | Cookie | — |
| `POST` | `/api/auth/sign-out` | — | `Set-Cookie: session_token=; Max-Age=0` | Cookie | — |

**Detalle técnico para la app:**
- La cookie `session_token` es HttpOnly (gestionada por Axios interceptors o `credentials: 'include'`). En React Native, Axios con `withCredentials: true` y `cookieJar` no funciona nativamente — **Better Auth expone endpoints REST que no requieren cookie si se usa el header `Authorization: Bearer <session_token>`**. La app debe extraer el token de la respuesta de `verify` o `get-session` y almacenarlo en el Zustand auth store, enviándolo como header `Authorization: Bearer <token>` en requests subsiguientes.
- El `requireAuth` middleware del backend (`auth.ts`) llama a `auth.api.getSession({ headers: req.headers })` — Better Auth **soporta tanto cookie como `Authorization: Bearer` header** para la sesión. La app debe enviar el token como header.
- `send-otp` y `verify` son públicos (sin auth).
- `get-session` y `sign-out` requieren sesión (cookie o Bearer token).

### Usuario / Perfil (endpoints NUEVOS requeridos — no existen hoy)

| Método | Ruta | Body | Respuesta | Auth | Rol |
|--------|------|------|-----------|------|-----|
| `GET` | `/api/me` | — | `{ user: { id, phone, role }, clientProfile?: { id, ... }, operatorProfile?: { id, truckType, licensePlate, available, lastLatitude, lastLongitude, ... } }` | Bearer | auth |
| `POST` | `/api/operator/profile` | `{ truckType: string, licensePlate: string, latitude?: number, longitude?: number }` | `{ id, truckType, licensePlate, available, ... }` | Bearer | auth (crea o actualiza, upsert) |
| `PATCH` | `/api/operator/location` | `{ latitude: number, longitude: number }` | `{ lastLatitude, lastLongitude, lastSeenAt }` | Bearer | OPERATOR |

### Servicios

| Método | Ruta | Body / Query | Respuesta | Auth | Rol |
|--------|------|-------------|-----------|------|-----|
| `POST` | `/services` | `{ type: 'BREAKDOWN' \| 'TRANSFER', originLat: number, originLng: number, destLat?: number, destLng?: number, description?: string, photoUrl?: string }` | `201 { id, status: 'PENDING', expiresAt, type, originLat, originLng }` | Bearer | CLIENT |
| `GET` | `/services/nearby` | `?lat=number&lng=number&radiusKm=5` | `[{ id, type, status, originLat, originLng, destLat?, destLng?, description?, photoUrl?, expiresAt, createdAt }]` | Bearer | OPERATOR |
| `GET` | `/services/:id` | — | Dueño/Admin: `{ ...completo con client }`. Operador: `{ ...público sin datos sensibles del cliente }`. Ajeno: `404` | Bearer | auth |
| `PATCH` | `/services/:id/status` | `{ status: 'CANCELLED' \| 'COMPLETED' }` | `{ ...service actualizado }` | Bearer | CLIENT (cancel propio) / OPERATOR (completar asignado) |

**Body shapes** (schemas Zod en `@destrabe/shared` — importables directamente en la app):

```typescript
// POST /services — createServiceSchema
{
  type: 'BREAKDOWN' | 'TRANSFER',   // ServiceType enum
  originLat: number,                 // requerido
  originLng: number,                 // requerido
  destLat?: number,                  // opcional
  destLng?: number,                  // opcional
  description?: string,              // opcional
  photoUrl?: string,                 // opcional (URL de imagen ya subida)
}
```

### Cotizaciones

| Método | Ruta | Body | Respuesta | Auth | Rol |
|--------|------|------|-----------|------|-----|
| `POST` | `/services/:id/quotes` | `{ amount: number (positivo), estimatedMinutes?: number (int positivo), note?: string (max 500) }` | `201 { id, amount, estimatedMinutes?, note? }` | Bearer | OPERATOR |
| `GET` | `/services/:id/quotes` | — | Dueño/Admin: `[{ id, amount, estimatedMinutes, note, operator: { truckType, licensePlate, rating } }]`. Operador: solo las propias. | Bearer | auth |
| `POST` | `/quotes/:id/accept` | `{}` (body vacío) | `{ ...service con status: 'ACTIVE', acceptedQuoteId }` | Bearer | CLIENT |

**Body shapes:**

```typescript
// POST /services/:id/quotes — createQuoteSchema
{
  amount: number,              // requerido, > 0
  estimatedMinutes?: number,   // opcional, entero positivo
  note?: string,               // opcional, max 500 chars
}

// POST /quotes/:id/accept — acceptQuoteSchema
{}                             // body vacío
```

### Pagos

| Método | Ruta | Body | Respuesta | Auth | Rol |
|--------|------|------|-----------|------|-----|
| `POST` | `/payments/:id/init` | — | `{ gatewayPaymentId: string, redirectUrl: string }` | Bearer | CLIENT |
| `POST` | `/payments/webhook` | `{ paymentId, status, gatewayReference? }` | `{ status: 'CONFIRMED' \| 'FAILED' \| 'ignored' }` | `X-Webhook-Token` header | Público |

**Nota sobre el flujo de pago en la app:**
- El `payment.id` se obtiene del `acceptedQuote` — al aceptar una cotización, el backend crea un `Payment` stub (`status: 'PENDING'`, `commission: 0` en stub, `commission: MP_COMMISSION` con MP real). La app debe guardar el `payment.id` que devuelve el `accept`.
- `POST /payments/:id/init` devuelve `redirectUrl` (URL de MercadoPago sandbox). La app abre esta URL con `expo-linking` + `expo-web-browser` (`WebBrowser.openAuthSessionAsync`). Tras el pago, MP redirige al usuario a una URL de retorno (configurable en MP dashboard); la app debe registrar un deep link scheme para capturar el retorno.

### Health (sin auth)

| Método | Ruta | Respuesta |
|--------|------|-----------|
| `GET` | `/health` | `{ status: 'ok' }` |

## Auth Flow desde la App

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Usuario ingresa teléfono (E.164: +57300...)              │
│    POST /api/auth/phone-number/send-otp { phoneNumber }     │
│    ← { success: true } (SMS en prod, log en dev)            │
├─────────────────────────────────────────────────────────────┤
│ 2. Usuario ingresa código OTP de 6 dígitos                  │
│    POST /api/auth/phone-number/verify { phoneNumber, code } │
│    ← { user: { id, phoneNumber, role }, session: { token } }│
│    ← Set-Cookie: session_token (HttpOnly)                   │
│                                                             │
│    APP GUARDA: session.token en Zustand authStore           │
│    APP ENVÍA: Authorization: Bearer <session.token>         │
│              en todas las requests subsiguientes via Axios  │
│              interceptor.                                   │
├─────────────────────────────────────────────────────────────┤
│ 3. App llama GET /api/me con Bearer token                   │
│    ← { user, clientProfile?, operatorProfile? }             │
│    → Si no tiene perfil del rol deseado → Onboarding        │
│    → Si tiene perfil → Home screen según rol                │
├─────────────────────────────────────────────────────────────┤
│ 4. Onboarding:                                              │
│    CLIENT: no-action (el ClientProfile se crea lazy al      │
│            crear el primer servicio en POST /services).     │
│    OPERATOR: POST /api/operator/profile { truckType,        │
│              licensePlate, latitude?, longitude? }          │
├─────────────────────────────────────────────────────────────┤
│ 5. Sesión persistente: al reabrir la app, llamar            │
│    GET /api/auth/get-session con el token almacenado.       │
│    Si es null → volver a login (paso 1).                    │
└─────────────────────────────────────────────────────────────┘
```

**Transporte del token:** React Native no maneja cookies HttpOnly automáticamente como un navegador. Better Auth soporta el header `Authorization: Bearer <token>` como alternativa. La app debe:
1. Extraer `session.token` de la respuesta `verify` (o `get-session`).
2. Almacenarlo en Zustand (persistido en `AsyncStorage` con middleware `persist`).
3. Configurar un interceptor de Axios que inyecte `Authorization: Bearer ${token}` en cada request.
4. Si un request devuelve 401, limpiar el token y redirigir a login.

## Shared Types — Lo que la app puede importar de `@destrabe/shared`

```typescript
// Enums (runtime values)
import { ServiceStatus, ServiceType, UserRole, PaymentStatus } from '@destrabe/shared';

// Schemas Zod (validación client-side)
import {
  createServiceSchema,
  nearbyServicesQuerySchema,
  updateServiceStatusSchema,
  createQuoteSchema,
  acceptQuoteSchema,
  sendOtpRequestSchema,
  verifyOtpRequestSchema,
} from '@destrabe/shared';

// Tipos inferidos (TypeScript)
import type {
  CreateServiceInput,
  NearbyServicesQuery,
  UpdateServiceStatusInput,
  CreateQuoteInput,
  AcceptQuoteInput,
  AuthUser,
  AuthSession,
  SendOtpRequestDTO,
  VerifyOtpRequestDTO,
} from '@destrabe/shared';
```

**Cómo funciona en el monorepo:**
- `shared/` compila a `shared/dist/` vía `npm run build -w @destrabe/shared`.
- `app/` referencia a `@destrabe/shared` en sus dependencias (workspace protocol: `"@destrabe/shared": "*"`).
- Para que el Metro bundler de Expo resuelva el paquete, se necesita configurar `metro.config.js` con `watchFolders` apuntando al root del monorepo y posiblemente un resolver para paquetes del workspace.
- Alternativa más simple: configurar Expo para usar `expo-yarn-workspaces` o el soporte nativo de workspaces de Yarn v1/npm workspaces con `metro.config.js`.

## Variables de Entorno que la App Necesita

| Variable | Propósito | Valor sugerido para dev |
|----------|-----------|------------------------|
| `EXPO_PUBLIC_API_URL` | Base URL del backend | `http://localhost:3000` (emulador Android: `http://10.0.2.2:3000`) |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Token público de Mapbox (pk.xxx) | Obtener de https://account.mapbox.com |
| `EXPO_PUBLIC_MP_PUBLIC_KEY` | Public key de MercadoPago (para SDK/web) | Obtener de MP dashboard (sandbox) |
| `EXPO_PUBLIC_APP_SCHEME` | URL scheme para deep links | `destrabe` |
| `EXPO_PUBLIC_SOCKET_URL` _(opcional)_ | URL del socket.io server | `http://localhost:3000` (mismo que API si socket comparte puerto) |

Variables del backend que impactan la app (no expuestas, pero relevantes):

| Variable | Impacto en la app |
|----------|------------------|
| `CORS_ORIGIN` | Debe incluir el origin del dev server de Expo (ej. `http://localhost:8081` para Metro, o `*` en dev). |
| `SERVICE_TIMEOUT_MINUTES` (default 15) | La app puede mostrar un countdown en la UI del cliente. |
| `PAYMENT_GATEWAY` (`stub` \| `mercadopago`) | Si es `stub`, `redirectUrl` es una URL de placeholder; la app debe manejarlo. |
| `MP_SANDBOX` (default `true` en dev) | La app debe saber si está en sandbox para mostrar avisos. |

## Estrategia de Tiempo Real para Cotizaciones

El backend **no tiene socket.io hoy**. `notifications.ts` es un log stub. Dos opciones:

| Opción | Descripción | Effort Backend | Effort App | Latencia |
|--------|-------------|---------------|------------|----------|
| **A. Polling** | La app cliente hace `GET /services/:id/quotes` cada N segundos (ej. cada 5s) mientras el servicio está `PENDING`/`QUOTED`. | **Cero** (no se toca backend). | **Bajo**: un `setInterval` o `useEffect` con limpieza. | 0–5s (configurable). |
| **B. Socket.io** | Añadir `socket.io` al backend + `socket.io-client` en la app. Eventos: `quote:new` (server → cliente), `service:cancelled` (server → cliente). Rooms por `serviceId`. | **Medio**: instalar `socket.io`, adjuntar a `http.Server`, autenticar conexiones vía token, emitir en `notifyClient`. ~4–6h backend. | **Medio**: hook `useSocket`, suscripción por `serviceId`, actualizar store al recibir evento. ~3–4h app. | Instantánea (<1s). |

**Recomendación: Opción A (Polling) para Fase Demo.** El README dice "socket.io-client en el scaffold si se necesita para notificar cotizaciones nuevas (evaluar)". Para Demo con volúmenes bajos, polling cada 5 segundos es suficiente y evita añadir complejidad de websockets al backend. La interfaz del hook de polling se puede diseñar de forma que migrar a socket.io en MVP sea un cambio mínimo (misma firma de store).

## Mapbox: Viabilidad en Expo

`@rnmapbox/maps` es el binding oficial de Mapbox GL para React Native. **NO funciona en Expo Go** — requiere módulos nativos (custom native code). Esto implica:

| Modo | ¿Mapbox funciona? | ¿Requiere prebuild? | DevEx |
|------|-------------------|---------------------|-------|
| **Expo Go** | ❌ No | No | Excelente (recarga rápida, sin build nativo). |
| **Expo Dev Build** (`npx expo prebuild` + `npx expo run:android`) | ✅ Sí | Sí (una vez, luego OTA updates) | Bueno (recarga rápida vía Metro, builds nativos solo al añadir/actualizar módulos nativos). |
| **Expo EAS Build** | ✅ Sí | Sí (en la nube) | Bueno para CI, más lento en iteración local. |

**Conclusión:** La app **debe usar Expo Dev Build** (no Expo Go) para incluir `@rnmapbox/maps`. Esto requiere:
1. `npx expo prebuild` (genera `android/` e `ios/`).
2. `npx expo run:android` o `npx expo run:ios` para desarrollo local.
3. Configurar `MAPBOX_DOWNLOADS_TOKEN` (token secreto con scope `DOWNLOADS:READ`) en `.netrc` o `~/.gradle/gradle.properties` para que el build descargue el SDK nativo de Mapbox.

## MercadoPago Redirect Flow en la App

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Cliente acepta cotización → Payment stub creado           │
│    (POST /quotes/:id/accept → response incluye payment.id)   │
├──────────────────────────────────────────────────────────────┤
│ 2. Cliente toca "Pagar" → POST /payments/:id/init            │
│    ← { gatewayPaymentId, redirectUrl }                       │
│    redirectUrl = "https://sandbox.mercadopago.com/..."       │
├──────────────────────────────────────────────────────────────┤
│ 3. App abre navegador externo:                               │
│    import * as WebBrowser from 'expo-web-browser';           │
│    const result = await WebBrowser.openAuthSessionAsync(     │
│      redirectUrl,                                            │
│      'destrabe://payment-return'                             │
│    );                                                        │
├──────────────────────────────────────────────────────────────┤
│ 4. Usuario completa pago en sandbox MP                       │
│    → MP redirige a destrabe://payment-return?status=...      │
├──────────────────────────────────────────────────────────────┤
│ 5. App recibe deep link (expo-linking):                      │
│    - Si success: mostrar "Pago exitoso"                      │
│    - Si pending: polling GET /payments/:id/status (nuevo)    │
│    - Si failure: mostrar "Pago rechazado" + reintentar       │
├──────────────────────────────────────────────────────────────┤
│ 6. PARALELO: MP envía webhook POST /payments/webhook         │
│    al backend (server-side, sin intervención de la app).      │
│    El backend actualiza Payment.status → CONFIRMED/FAILED.    │
│    La app hace polling de GET /me o GET /services/:id para   │
│    detectar el cambio de estado del payment.                 │
└──────────────────────────────────────────────────────────────┘
```

**Paquetes requeridos en la app:**
- `expo-linking` — manejo de deep links.
- `expo-web-browser` — `openAuthSessionAsync` para abrir MP en navegador externo y capturar redirect.
- Configurar `scheme: "destrabe"` en `app.json` para el deep link `destrabe://`.

**Nota sobre estado del payment:** El backend no expone `GET /payments/:id` hoy. La app puede saber el estado del pago indirectamente:
- Vía `GET /services/:id` (el service incluye `payment` en la respuesta para dueño).
- O añadiendo un endpoint `GET /payments/:id` en este cambio (scope mínimo, útil para polling post-pago).

## Enfoques de Desarrollo para la App

### Opción A: Expo Go + Polling sin Mapbox (mínimo esfuerzo, máxima limitación)

Usar `react-native-maps` (Google Maps/Apple Maps nativos del dispositivo, sin Mapbox), polling para cotizaciones, Expo Go sin prebuild.

| Pros | Contras |
|------|---------|
| Sin configuración nativa (sin Android Studio/Xcode). | **No usa Mapbox** — contradice el stack declarado en README. `@rnmapbox/maps` no funciona en Expo Go. |
| Recarga rápida (hot reload nativo de Expo Go). | `react-native-maps` tiene menos features que Mapbox (sin Mapbox Streets, sin custom styles, sin Directions API). |
| Iteración más rápida para UI/UX. | Menos fiel al stack productivo. Migrar a Mapbox en MVP sería rework. |
| Sin necesidad de build nativo en CI. | |

**Effort total:** **Bajo-Medio** (~3–4 días dev). Pero desviación del stack.

### Opción B: Expo Dev Build + Mapbox + Socket.io (recomendada)

Expo con `npx expo prebuild`, `@rnmapbox/maps`, dev builds locales, socket.io-client. Stack completo como en README.

| Pros | Contras |
|------|---------|
| **Stack fiel al README** — Mapbox real, socket.io-client, todo el stack declarado presente. | Requiere `npx expo prebuild` inicial. Build nativo local (~5–10 min primera vez). |
| Mapbox real para el mapa del Demo (selección de origen/destino, vista de operadores cercanos). | Para iterar en JS/TS no se necesita rebuild; solo al añadir módulos nativos. |
| Socket.io para notificaciones push de cotizaciones (experiencia Demo más pulida). | Añade ~6–10h de backend (socket.io server + auth) + ~3–4h de app (hook + store). |
| Deep links con `expo-linking` para retorno de MP — nativo y robusto. | |
| Build en CI vía EAS Build (gratuito para pocos builds/mes). | |

**Effort total:** **Medio-Alto** (~7–10 días dev, incluyendo backend gaps). Pero entrega un Demo fiel al producto final.

### Opción C: Bare React Native CLI (sin Expo)

Inicializar con `npx react-native init`, sin capa Expo. Control total sobre configuración nativa.

| Pros | Contras |
|------|---------|
| Control total sobre build nativo y dependencias. | Más boilerplate y configuración manual (linking de módulos, deep links manuales, etc.). |
| Sin overhead de Expo. | Sin OTA updates nativos (CodePush es alternativa pero más setup). |
| | Más lento en iteración que Expo Dev Build. |
| | No justificado para Fase Demo — la capa Expo no limita nada de lo que necesitamos. |

**Effort total:** **Alto** (~10–14 días dev). Overkill para Demo.

### Comparativa

| Criterio | A: Expo Go + Polling | B: Expo Dev Build + Mapbox + Socket.io | C: Bare RN CLI |
|----------|---------------------|--------------------------------------|----------------|
| Mapbox (`@rnmapbox/maps`) | ❌ No (usa Google Maps) | ✅ Sí | ✅ Sí |
| Socket.io real-time | ❌ No (polling) | ✅ Sí | ✅ Sí |
| Deep link MP return | ⚠️ Limitado (sin Expo WebBrowser) | ✅ Completo (expo-linking) | ✅ Manual |
| DevEx / Hot reload | ⭐⭐⭐⭐⭐ (Expo Go instantáneo) | ⭐⭐⭐⭐ (Metro, prebuild solo al inicio) | ⭐⭐⭐ (más lento, builds más frecuentes) |
| Fidelidad al stack README | ❌ Baja | ✅ Alta | ✅ Alta (pero sin Expo) |
| Setup inicial | 1–2h | 3–5h (prebuild + Mapbox config) | 8–12h |
| Esfuerzo total (incl. backend gaps) | ~4–5 días | ~7–10 días | ~12–15 días |
| Migración a MVP | Alto rework (cambiar mapa, añadir socket) | Mínimo (ya está el stack completo) | Medio |
| Compatibilidad con `@destrabe/shared` | ✅ (Metro resolver) | ✅ (Metro resolver) | ⚠️ (configuración manual) |

## Recommendation

**Opción B: Expo Dev Build + Mapbox + Socket.io (opcional → solo scaffold).**

### Justificación

1. **Mapbox es obligatorio para el Demo** — el README lo declara explícitamente y `@rnmapbox/maps` no funciona en Expo Go. La selección de origen en mapa es una feature visual central del Demo. Usar Google Maps (Opción A) es una desviación que requeriría rework completo en MVP.

2. **Socket.io: scaffold sí, implementación real diferida.** Siguiendo el patrón del README ("socket.io-client en el scaffold si se necesita para notificar cotizaciones nuevas (evaluar)"), se recomienda:
   - Incluir `socket.io-client` en las dependencias del `app/package.json`.
   - Crear `app/src/hooks/useSocket.ts` con la interfaz de conexión lista (conectar, desconectar, suscribir a room, escuchar eventos).
   - **PERO no conectar el socket en el store durante Demo** — usar polling en su lugar.
   - Esto deja el scaffolding listo para enchufar socket.io en MVP, sin añadir complejidad al backend ahora.

3. **Polling para notificaciones de cotizaciones durante Demo.** La app cliente hará `GET /services/:id/quotes` cada 5 segundos. Para volúmenes Demo es suficiente. El backend no se modifica.

4. **Backend gaps deben resolverse en este cambio (scope mínimo):**
   - `POST /api/operator/profile` y `PATCH /api/operator/location` — **bloqueantes** para el flujo operador.
   - `GET /api/me` — **bloqueante** para que la app conozca el estado del usuario.
   - `cors()` middleware — **bloqueante** para que las requests del app funcionen.
   - `GET /api/payments/:id` o incluir payment en `GET /api/services/:id` — conveniente para polling post-pago.
   - Upload de imágenes — **deferir**: para Demo, aceptar solo `photoUrl` como string (el usuario pega una URL o se usa una imagen placeholder). Upload real (S3 presigned URLs) es scope MVP.

### Scope del cambio-008 dividido en dos tracks

**Track A — Backend gaps (previo o paralelo a la app):**
1. `cors` middleware + `CORS_ORIGIN` env.
2. `POST /api/operator/profile` (upsert) + `PATCH /api/operator/location`.
3. `GET /api/me` (user + perfiles asociados).
4. `GET /api/payments/:id` (opcional, conveniente).

**Track B — App móvil:**
1. Inicializar proyecto Expo (SDK 52/53) con TypeScript.
2. Configurar `@rnmapbox/maps` + `MAPBOX_DOWNLOADS_TOKEN`.
3. Configurar monorepo (workspaces, Metro resolver para `@destrabe/shared`).
4. Implementar stores Zustand (auth, services, quotes, ui).
5. Implementar pantallas del flujo Demo completo.
6. Implementar polling de cotizaciones.
7. Configurar deep links para retorno de MP.
8. Scaffold de socket.io-client (sin conectar).

## Risks

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| **Mapbox requiere token secreto de descarga** (`MAPBOX_DOWNLOADS_TOKEN`) que no es público. El build falla sin él. | Alta | Alto | Documentar en setup. El token se configura en `~/.gradle/gradle.properties` (local) o en secrets de EAS Build (CI). No se commitea. |
| **Metro bundler no resuelve `@destrabe/shared`** desde el monorepo. La app no compila. | Media | Alto | Configurar `metro.config.js` con `watchFolders: ['../../shared']` y `nodeModulesPaths`. Alternativa: `expo-yarn-workspaces`. Probar en la primera iteración. |
| **Better Auth session via Bearer token no funciona como se espera** en React Native. El `auth.api.getSession({ headers })` espera la cookie, no el Bearer. | Media | Alto | Verificar en exploración adicional (o en la primera task de implementación). Better Auth soporta `Authorization: Bearer` en el header — confirmado en su documentación. Si falla, hay que exponer un endpoint `/api/auth/session` que envuelva `getSession` y use el header Bearer manualmente. |
| **OperatorProfile creation sin endpoint** — el operador no puede cotizar. | Alta | Crítico | Incluir `POST /api/operator/profile` en el scope del cambio-008 (Track A). |
| **Sin endpoint de ubicación del operador** — `GET /services/nearby` no recibe coordenadas actualizadas. | Alta | Alto | Incluir `PATCH /api/operator/location` en Track A. La app debe enviar la ubicación del operador periódicamente (o al abrir la pantalla de servicios cercanos). |
| **CORS bloquea las requests** desde la app (origin diferente). | Alta | Crítico | Incluir `cors()` middleware en `app.ts`. Configurar `CORS_ORIGIN=*` en dev. |
| **MercadoPago redirect en WebBrowser** — `openAuthSessionAsync` puede no capturar el deep link de retorno en Android (depende de la configuración de intent filters). | Media | Medio | Configurar `intentFilters` en `app.json` para el scheme `destrabe`. Probar en device real y emulador. Plan B: polling del estado del pago. |
| **`@rnmapbox/maps` breaking change** — cambios de API entre versiones de Expo SDK. | Baja | Medio | Fijar versiones en `package.json`. Usar la versión de `@rnmapbox/maps` compatible con el SDK de Expo elegido (documentado en la tabla de compatibilidad de Expo). |
| **Performance en dispositivo real** — Mapbox + polling + navegación pueden ser pesados en dispositivos de gama baja. | Baja | Bajo | Para Demo, aceptable. Usar `react-native-performance` o Flipper para monitorear. Lazy loading de pantallas con React Suspense. |

## Ready for Proposal

**Sí.** El análisis es completo: API contract definido, gaps de backend identificados, enfoques comparados, decisión de arquitectura tomada. Se recomienda proceder a la etapa `propose` con el scope descrito (Track A: backend gaps + Track B: app Demo).

**Próximos pasos en propose:**
- Definir el scope exacto del cambio-008 (qué va en este cambio y qué se difiere).
- Decidir si los endpoints de backend (Track A) van dentro de cambio-008 o como un cambio previo (cambio-007.5 o parte del scope de 008).
- Especificar la estructura de navegación (React Navigation v7 stack/tab navigator).
- Estimar tareas y orden de implementación.
