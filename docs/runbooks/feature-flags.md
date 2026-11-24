# Feature flags por usuario

Las features nuevas se despliegan en producción **apagadas para todos menos
para una allowlist** (en la práctica, el dueño del producto). Cuando están
bien, se liberan a todos. No hay servicios externos: el estado vive en la
variable de entorno `FEATURE_FLAGS` del backend.

## Qué va detrás de un flag

- **Sí:** toda feature nueva visible para el usuario (pantallas, botones,
  endpoints nuevos, cambios de comportamiento de negocio).
- **No:** correcciones de errores, parches de seguridad, refactors y cambios
  de infraestructura. Esos se despliegan directamente.

## Piezas

| Pieza                                     | Dónde                                      |
| ----------------------------------------- | ------------------------------------------ |
| Catálogo de flags (constante tipada)      | `shared/src/featureFlags.ts`               |
| Formato y validación de `FEATURE_FLAGS`   | `backend/src/lib/featureFlagsConfig.ts`    |
| `isFeatureEnabled` / `getEnabledFeatures` | `backend/src/lib/featureFlags.ts`          |
| Middleware `requireFeature(flag)` (404)   | `backend/src/middleware/requireFeature.ts` |
| `GET /api/me/features`                    | `backend/src/routes/me.routes.ts`          |
| Store de la app y hook `useFeature(flag)` | `app/src/stores/featuresStore.ts`          |

## Flags en uso

| Flag           | Qué protege                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pagoSimulado` | `POST /payments/:id/simulate` (#16): el cliente dueño aprueba o rechaza su pago en la demo. Además exige `PAYMENT_GATEWAY=stub`; si no, responde 404. |
| `ubicacionGps` | Reservado para la ubicación por GPS de la app.                                                                                                        |

## 1. Crear un flag

Añade el nombre (camelCase) al catálogo en `shared/src/featureFlags.ts`:

```ts
export const FEATURE_FLAGS = [
  'pagoSimulado',
  'ubicacionGps',
  'miFeature',
] as const;
```

Sin configurar, el flag está **apagado para todos** (falla cerrado), así que
el código puede fusionarse y desplegarse sin riesgo.

## 2. Proteger el código

**Backend, ruta entera** (después de `requireAuth`; responde 404 como si la
ruta no existiera):

```ts
import { requireFeature } from '../middleware/requireFeature';

router.post('/algo', requireAuth, requireFeature('miFeature'), handler);
```

**Backend, lógica dentro de un handler:**

```ts
import { isFeatureEnabled } from '../lib/featureFlags';

if (await isFeatureEnabled('miFeature', (req as AuthedRequest).user)) {
  // comportamiento nuevo
}
```

**App** (los flags se cargan solos al iniciar sesión y al reabrir la app):

```tsx
import { useFeature } from '../stores/featuresStore';

const showNueva = useFeature('miFeature');
return showNueva ? <BotonNuevo /> : null;
```

La app pide los flags tras un `/api/me` correcto (al iniciar sesión o al
reabrirla). Si `/api/me/features` falla, usa los últimos conocidos de ese
usuario; si no hay, todo apagado. Sin red al abrir la app se cierra la sesión
(comportamiento previo de `hydrate`), así que no hay modo offline real.
Ocultar en la app es solo UX: la protección real es el backend.

## 3. Activarlo solo para mí (allowlist)

**Valida el JSON antes de pegarlo en Coolify** (desde la raíz del repo, con
`npm install` y `npm run build -w @destrabe/shared` hechos). Usa el mismo
parser que el arranque del backend y devuelve el valor en una línea:

```bash
npm run flags:check -w @destrabe/backend -- '{"miFeature":{"mode":"allowlist","users":["+573001234567"]}}'
```

Si responde `FEATURE_FLAGS inválida: ...`, corrige antes de guardar. Si aun
así un despliegue no arranca, vuelve a poner el valor anterior de la variable
en Coolify y redespliega.

En Coolify → aplicación del backend → _Environment Variables_, define
`FEATURE_FLAGS` (JSON en una sola línea) y **redespliega**:

```json
{ "miFeature": { "mode": "allowlist", "users": ["+573001234567"] } }
```

`users` acepta teléfonos E.164 con `+` (lo más cómodo) o ids de usuario. Un
teléfono sin `+` (solo dígitos) se rechaza al validar. Para ver
el cambio en la app, ciérrala y vuelve a abrirla (o vuelve a iniciar sesión).

## 4. Liberarlo para todos

Cambia el modo a `all` en Coolify y redespliega:

```json
{ "miFeature": "all" }
```

Para apagarlo de emergencia: `"miFeature": "off"` (o quitar la clave) y
redesplegar.

## 5. Retirar el flag (limpieza)

Cuando la feature lleve un tiempo liberada, un PR quita los `requireFeature` /
`isFeatureEnabled` / `useFeature` de ese flag y lo borra del catálogo. Luego se
quita su clave de `FEATURE_FLAGS` en Coolify. Si la variable menciona un flag
que ya no está en el catálogo, el backend arranca igual y solo deja un aviso
en el log.

## Formato y errores

Modos: `"off"`, `"all"` o `{ "mode": "off" | "allowlist" | "all", "users": [...] }`.
JSON roto, un modo desconocido, una clave mal escrita (p. ej. `user` en vez de
`users`) o un teléfono que no sea E.164 (también sin `+`) **hacen fallar el arranque** con un
mensaje `FEATURE_FLAGS inválida: ...` que indica el campo. Si un despliegue no
arranca tras tocar la variable, revisa ese mensaje en los logs de Coolify.

## Más adelante

La lógica consulta un `FeatureFlagStore` (`setFeatureFlagStore`). Para mover
los flags a una tabla en BD basta con otro store; los llamadores no cambian.
