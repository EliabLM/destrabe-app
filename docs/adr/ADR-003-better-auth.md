# ADR-003: Better Auth como solución de autenticación

**Fecha:** Junio 2026 (implementado Julio 2026 en `cambio-003-auth`)  
**Estado:** Aceptado  
**Migrado desde:** `docs/specs/cambio-003-auth/spec.md` / `docs/architecture/spec-tecnica-destrabe-app.md` §10

---

## Contexto

La app requiere autenticación por número de teléfono (OTP SMS). Se priorizó portabilidad
total de los datos de usuario y capacidad de migrar a infraestructura propia sin fricción.

Restricciones del Stack:

- Postgres 16 ya elegido (ADR implícita de data layer) y gestionado vía Prisma.
- Backend Express + TypeScript (ADR-002); no hay framework con abstracciones de auth.
- Mobile React Native (ADR-001) consume REST directa; no se admite SDK que compile a nativo.
- Presupuesto demo < 1 mes; no se admite SaaS con pricing por MAU.

Better Auth se evaluó como una librería TypeScript framework-agnostic que gestiona sessions
JWT vía cookies, con un plugin `phoneNumber` para OTP y `prismaAdapter` para persistir en el
mismo Postgres del dominio.

## Decisión

Usar **Better Auth** con **Postgres propio** como store de usuarios, montado sobre el proceso
Express existente. Los detalles concretos surgidos en la fase de implementación
(`cambio-003-auth`, T1–T9) consolidan la decisión:

- **Librería:** `better-auth ^1.6.23` + plugin `phoneNumber`, fixed en `package.json` (la API
  del 1.x es joven y puede cambiar; el pin es la mitigación). El cliente móvil consume la REST
  API expuesta por Better Auth; no se usa SDK RN.
- **Montaje en Express:** el handler de Better Auth se expone vía
  `toNodeHandler(auth.handler)` montado en `router.use('/api/auth', authHandler)`. La
  `better-call` reconstruye la URL completa desde `req.baseUrl`/`req.originalUrl`/`req.url` al
  montarlo, así el basePath `/api/auth` del plugin sigue matcheando aunque `app.use(path, fn)`
  normalmente quite el prefijo. No hace falta `app.all('/api/auth/*', ...)`.
- **Persistencia:** `prismaAdapter` contra el Postgres existente. Modelos gestionados por
  Better Auth: `User`, `Session`, `Account`, `Verification` (schema generado por CLI).
- **Generación de capa identidad:** `better-auth ^1.6.23` NO incluye binario `auth` (clase
  `bin` ausente en el paquete). Se usa `npx @better-auth/cli@latest generate` para generar
  los modelos en `schema.prisma`.
- **Campo de teléfono:** el plugin `phoneNumber` exige la columna `phoneNumber` en `User`
  (PascalCase, no configurable). Renombrar a `phone` rompe el binding del plugin.
- **Registro solo por teléfono (`signUpOnVerification`):** obligatorio para alta de usuario
  único-OTP. Sin este callback, el `verify` de un teléfono nuevo lanza
  `FAILED_TO_UPDATE_USER` (500) porque el plugin intenta `findBy phoneNumber → null` y no
  crea el `User`. La configuración usada:
  ```ts
  signUpOnVerification: {
    getTempEmail: (phoneNumber) => `tmp+${phoneNumber}@destrabe.local`,
  }
  ```
  `getTempEmail` recibe el `phoneNumber` (string), no un `ctx`.
- **Callback `verifyOTP` omitido:** Better Auth verifica el código internamente contra la
  tabla `Verification` (valor persistido `${code}:${attempts}`). El design §3/§11 proponía un
  placeholder `verifyOTP: () => false`; eso BLOQUEARÍA toda verificación (todo `verify`
  retornaría false). Se omite el callback y se delega al verificador interno del plugin.
- **Roles de usuario:** `additionalFields.role` (tipo `UserRole`, default `CLIENT`) sobre el
  modelo `User`; los roles se enforcean vía middleware `requireRole` (T7) y exponen tipado
  compartido en `shared` (T8).
- **OTP SMS en prod:** `Plivo` (ADR-008) vía `client.messages.create`. En dev (`PLIVO_AUTH_ID`
  ausente) `sendOtp` loggea el OTP a consola (sin llamada externa), capturable por tests.
- **Sesión:** cookies firmadas por Better Auth (`session_token`). `GET /get-session` responde
  `200` con body `null` (no `401`) cuando no hay cookie activa. `POST /sign-out` setea
  `Set-Cookie` con `Max-Age=0`.

### Endpoints reales del plugin `phoneNumber` (mounteados bajo `/api/auth`)

| Método | Ruta                     | Body / Efecto                                                                     |
| ------ | ------------------------ | --------------------------------------------------------------------------------- |
| POST   | `/phone-number/send-otp` | `{ phoneNumber }` → `{ message: "code sent" }`                                    |
| POST   | `/phone-number/verify`   | `{ phoneNumber, code }` → `{ status, token, user }` + `Set-Cookie: session_token` |
| GET    | `/get-session`           | `{ session, user }` o `null`                                                      |
| POST   | `/sign-out`              | cookie borrada (`Max-Age=0`)                                                      |

> **Desviación de la spec:** la spec §7.1 usaba `/phone/send-otp` y `/phone/verify-otp`.
> El plugin real expone `/phone-number/*` y `/verify` (sin `-otp`). Documentado en T9.

## Consecuencias positivas

- Open source, sin pricing por MAU.
- Los datos de usuarios viven en el Postgres de la aplicación desde el día 1 — no hay
  migración futura (tabla `User`+`Session` coexisten con el dominio de negocio).
- Compatible con Express mediante un handler estándar (`toNodeHandler`); la integración se
  reduce a un `router.use('/api/auth', authHandler)`.
- Plugin de phone OTP disponible en el ecosistema; el flujo send → verify → cookie de sesión
  se valida end-to-end (T9, db smoke).
- JWTs estándar en cookies — compatibles con cualquier validador futuro (PostgREST, otros
  servicios) y consumibles desde el cliente móvil vía cookie o token.
- Roles y middleware interno (`requireAuth`, `requireRole`, T7) reutilizan la sesión de
  Better Auth sin capa de auth paralela.

## Consecuencias negativas

- No tiene SDK oficial de React Native. El cliente móvil consume la REST API de Better Auth
  directamente, lo que requiere implementar manualmente el flujo de token refresh
  (~1-2 días de trabajo adicional en la demo). No bloquea el backend; el refresh en mobile
  queda como cambio futuro.
- Proyecto más joven que alternativas como SuperTokens; API del 1.x puede cambiar. Mitigado
  fijando `better-auth ^1.6.23` en `package.json`.
- `better-auth ^1.6.23` no incluye CLI binario; se requiere `@better-auth/cli` externa vía
  `npx @better-auth/cli@latest generate` para regenerar la capa de identidad. Paso extra en
  setup y onboarding.
- El plugin `phoneNumber` impone el nombre de columna `phoneNumber` (no configurable);
  renombrar a `phone` rompería el binding. Convención a respetar en futuros cambios.
- `signUpOnVerification` es obligatorio para registro solo-por-OTP; olvidar el callback
  produce `500 FAILED_TO_UPDATE_USER` en verify de teléfonos nuevos.
- En tests del singleton `prisma` importado por `auth.ts`, el `PrismaClient` captura
  `DATABASE_URL` en construcción (hoisted antes de los guards del test). Hay que inyectar
  `DATABASE_URL` al proceso que lanza vitest (no basta con setearlo dentro del test file).

## Alternativas descartadas

- **Supabase Auth:** lock-in al ecosistema. Migración de hashes de contraseñas es compleja.
- **Clerk:** SaaS puro, no self-hostable. ~$0.02/MAU, a 100K usuarios son ~$2,000/mes solo
  en auth.
- **Firebase Auth:** lock-in a Google Cloud. Sin portabilidad.
- **Keycloak:** sobredimensionado para este scope. Requiere JVM + configuración compleja.

## Notas de implementación

- **T5 (`backend/src/lib/auth.ts`):** config con `prismaAdapter` + plugin `phoneNumber`
  (`sendOTP: sendOtp` delega a Plivo en prod, log en dev) + `additionalFields.role` +
  `signUpOnVerification.getTempEmail`. `verifyOTP` omitido (delegado al verificador interno).
- **T6 (`backend/src/routes/index.ts`):** `router.use('/api/auth', authHandler)` con
  `authHandler = toNodeHandler(auth.handler)`. Smoke `auth.mount.test.ts` valida montaje sin
  PG up (sub-ruta inexistente → 404, `/health` sigue ok).
- **T7 (`backend/src/middleware/auth.ts`):** `requireAuth` valida cookie de sesión y
  enriquece `req.user`; `requireRole` chequea `user.role`.
- **T9 (`backend/__tests__/auth.otp.flow.test.ts`):** flujo send → verify → get-session →
  sign-out con `request.agent` (cookie jar) + mock de Plivo que captura el OTP del callback
  `sendOTP({phoneNumber, code})`.
- **CLI:** `npx @better-auth/cli@latest generate` (no `npx auth generate` como decía la
  proposal — el paquete principal no trae binario).
