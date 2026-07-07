# Proposal — Cambio-008: App Móvil Demo

**Change ID:** `cambio-008-app-movil-demo` · **Etapa SDD:** Propose · **Basado en:** `docs/proposals/cambio-008-app-movil-demo/exploration.md` · **Branch:** `develop` (bd5e549)

## Intent

Cerrar los 4 gaps de backend que bloquean el flujo Demo y entregar la app Expo (cliente + operador) que ejercita extremo a extremo: auth OTP → onboarding → crear/aceptar cotizaciones → pagar sandbox MP → marcar COMPLETED. Sin este cambio, el operador no puede registrarse desde la app y el stack del README no tiene consumidor móvil.

## Capabilities

**New**
- `operator-onboarding`: `POST /api/operator/profile` (crear OperatorProfile: `truckType`, `licensePlate`, `photoUrl?`, `available`, `lastLat`, `lastLng`; guard `OPERATOR`; 409 si ya existe) + `PATCH /api/operator/location` (ubicación + `lastSeenAt`/`available`, perfil propio).
- `mobile-app-demo`: app Expo Dev Build cliente+operador (polling, deep link MP), reuso de `@destrabe/shared`, Zustand y Axios Bearer interceptor.

**Modified**
- `auth-lifecycle`: añadir `GET /api/me` (Bearer) → `{ user, clientProfile?, operatorProfile? }`.

> `service-lifecycle`, `quote-lifecycle`, `payment-lifecycle` no cambian a nivel spec (solo se consumen). `cors()` es configuración de app, no genera spec.

## In Scope

**Backend (Track A — gaps bloqueantes)**
- `POST /api/operator/profile`: Zod body, guard `OPERATOR`, 409 si perfil existe.
- `PATCH /api/operator/location`: actualiza ubicación + `lastSeenAt`/`available`, perfil propio.
- `GET /api/me`: Bearer → user + ClientProfile/OperatorProfile.
- `cors()` en `app.ts` con `CORS_ORIGIN` env (`*` dev, restrictivo prod).
- Tests TDD por endpoint (supertest).

**Mobile (Track B — app Demo)**
- Expo Dev Build: `package.json`, `app.json` (scheme `destrabe`, plugin Mapbox), `prebuild` documentado.
- React Navigation v7, Zustand (auth, services, quotes, ui), Axios interceptor Bearer + logout 401.
- Pantallas: auth OTP → onboarding → home cliente (lista+FAB) → crear solicitud (picker Mapbox, tipo, descripción) → detalle (polling quotes 5s) → aceptar quote → pago MP (`init`+`WebBrowser`+deep link+polling) → home operador (toggle available, cercanos polling) → crear quote → servicio activo (marcar COMPLETED explicando 409 `PAYMENT_PENDING`).
- Reuso de schemas/enums de `@destrabe/shared` (Metro `watchFolders`); socket.io-client solo scaffold.
- Env: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`, `MAPBOX_DOWNLOADS_TOKEN` (build-time). Token en `expo-secure-store`.

## Out of Scope (defer a MVP)

- Tracking GPS en vivo y socket.io server real (polling cubre Demo).
- Upload de imágenes (se acepta `photoUrl` string; S3 a MVP).
- Push FCM, panel admin web, historial, calificaciones, refunds.
- Recuperar cuenta / cambiar número y multi-rol por cuenta.
- `GET /payments/:id` standalone: el estado viene vía `GET /services/:id`.

## Risks & Tradeoffs

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| `MAPBOX_DOWNLOADS_TOKEN` secreto; build falla sin él. | Alta | Documentar en readme; Gradle props local o EAS secrets. No commitear. |
| Metro no resuelve `@destrabe/shared` en monorepo. | Media | `metro.config.js` con `watchFolders`+`nodeModulesPaths`; validar en primera task. |
| `openAuthSessionAsync` no captura deep link MP en Android. | Media | `intentFilters` para scheme `destrabe`; fallback a polling. |
| *(Tradeoff)* backend gaps + app = PR grande. | Alta | Tasks atómicas Track A→B; `work-unit-commits`. |
| *(Tradeoff)* Bearer RN sin cookie HttpOnly podría romper `requireAuth`. | Media | Better Auth soporta Bearer; validar en primera task; fallback wrapper `session-from-bearer`. |

## Open Questions (con defaults)

- **Snapshot auth**: `auth-store-v1`; migrar si cambia el shape.
- **Detener polling del cliente**: 30s tras último `expiresAt`; sanea en unmount.
- **Toggle `available` actualiza ubicación?**: ON envía `PATCH /operator/location`; OFF no.
- **Rol elegido persistido?**: no, se infiere de `GET /me` (presencia de perfil).

## Rollback Plan

Track A y B son separables en git. Revertir `operator.routes.ts`, `me.routes.ts` y `cors()` deja 001–007 intacto. Si la app no compila, eliminar `app/`. No hay migración Prisma.

## Success Criteria

- [ ] Flujo Demo end-to-end manual: cliente crea → operador cotiza → cliente acepta → pago MP sandbox CONFIRMED → operador marca COMPLETED desde la app.
- [ ] Backend gaps con tests (unit + supertest) pasando.
- [ ] App compila como Expo Dev Build con `@rnmapbox/maps` cargando un mapa; logout automático al recibir 401.

## Ready for Spec

Sí. Contrato y gaps acotados, stack cerrado, tradeoffs aceptados. Próximo: `sdd-spec` para `operator-onboarding`, `mobile-app-demo` (new) y delta `auth-lifecycle` con `GET /me`.