# Destrabe App — Expo Dev Build

Aplicación móvil Expo para la Demo de Destrabe (clientes y operadores de asistencia en ruta).

## Prerequisites

| Tool        | Version | Notes                                |
| ----------- | ------- | ------------------------------------ |
| Node        | >= 20.x |                                      |
| npm         | >= 10.x |                                      |
| JDK         | >= 17   | Solo Android (temurin/recomendado)   |
| Android SDK | API 34+ | Solo Android, con `ANDROID_HOME` set |
| Xcode       | >= 15.x | Solo iOS                             |

## Setup

### 1. Install workspace dependencies

```bash
# From the monorepo root
npm install
```

> La app usa Expo SDK 58 (React Native 0.88, React 19, Nueva Arquitectura). No funciona en Expo Go por `@rnmapbox/maps`: hace falta un _development build_. Para revisar dependencias: `npm run doctor -w @destrabe/app` (`expo-doctor`) y `npx expo install --check` dentro de `app/`.

### 2. Environment variables

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Las siguientes variables **runtime** son necesarias (validadas al startup por la app):

| Variable                   | Descripción                   | Ejemplo                 |
| -------------------------- | ----------------------------- | ----------------------- |
| `EXPO_PUBLIC_API_URL`      | URL base del backend          | `http://localhost:3001` |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | Mapbox public token (runtime) | `pk.eyJ1Ijoi...`        |

La siguiente variable es **build-time** (solo necesaria para `npx expo prebuild`):

| Variable                       | Descripción                                   |
| ------------------------------ | --------------------------------------------- |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Mapbox secret token para descargar SDK nativo |

> Se pasa como variable de entorno (o como secreto de EAS), nunca en `app.json`. Obtén `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` desde [Mapbox Account > Access Tokens](https://account.mapbox.com/access-tokens/). Crea un token con scopes `DOWNLOADS:READ`. Sin este token, `@rnmapbox/maps` falla en la compilación nativa.

### 3. Prebuild (solo necesario la primera vez o al cambiar plugins nativos)

```bash
RNMAPBOX_MAPS_DOWNLOAD_TOKEN=xxxxx npx expo prebuild
```

Esto genera las carpetas `android/` e `ios/` con los proyectos nativos. Ambos directorios están en `.gitignore` y no se commitan.

> ⚠️ Si omites `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`, el prebuild fallará porque `@rnmapbox/maps` no puede descargar el SDK de Mapbox nativo.

### 4. Run

```bash
# Usando npm workspaces (recomendado)
npm run dev --workspace app

# O directamente con Expo
npx expo run:android   # Android
npx expo run:ios       # iOS
```

Para hot-reload en desarrollo JS/TS no es necesario re-ejecutar prebuild — solo salvar el archivo.

## Generar e instalar la app en un teléfono Android (EAS Build)

La app no funciona en Expo Go (usa `@rnmapbox/maps`), así que se instala un APK generado en los servidores de Expo con **EAS Build**. Los dos perfiles de `eas.json` entran en el plan gratuito (cola gratuita; puede tardar más en empezar):

| Perfil        | Para qué                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `development` | _Development build_: APK con `expo-dev-client` que carga el código desde tu PC con `expo start`. |
| `preview`     | APK interno autónomo (lleva el código dentro); para enseñar la demo sin PC.                      |

No compiles en el VPS: todo el build ocurre en EAS.

### Paso 1. Cuenta y CLI (una sola vez)

1. Crea una cuenta gratuita en <https://expo.dev/signup>.
2. En tu PC, desde `app/`:

   ```bash
   npm install -g eas-cli
   eas login
   eas init
   ```

   La guía usa `eas env:set`, que existe desde eas-cli 21.1.0 (antes era `eas env:create`, hoy obsoleto). `eas.json` exige esa versión mínima; compruébala con `eas --version`.

   `eas init` crea el proyecto en Expo y añade `extra.eas.projectId` (y `owner`) a `app.json`. Ese id no es secreto: haz commit de ese cambio.

### Paso 2. Variables de entorno en EAS (una sola vez)

Los valores se guardan en EAS, **nunca** en `eas.json`, `app.json` ni en el repo.

1. Token secreto de descarga de Mapbox (scope `DOWNLOADS:READ`, ver arriba), como variable **secreta**:

   ```bash
   eas env:set --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --value "sk.xxxx" \
     --visibility secret --environment development --environment preview
   ```

2. Variables públicas de la app (se incrustan en el APK, por eso no son secretas):

   ```bash
   eas env:set --name EXPO_PUBLIC_MAPBOX_TOKEN --value "pk.xxxx" \
     --visibility plaintext --environment development --environment preview
   eas env:set --name EXPO_PUBLIC_API_URL --value "https://<tu-backend>" \
     --visibility plaintext --environment development --environment preview
   ```

   Compruébalo con `eas env:list --environment preview`. También se pueden crear desde la web (expo.dev → proyecto → Environment variables).

> El perfil `preview` es un build _release_: Android bloquea `http://` en claro, así que `EXPO_PUBLIC_API_URL` debe ser `https://`. En `development` sirve una IP local (`http://192.168.x.x:3001`).

### Paso 3. Development build

```bash
cd app
eas build -p android --profile development
```

1. Al terminar, EAS muestra un enlace y un código QR. Ábrelo en el teléfono, descarga el APK e instálalo (Android pedirá permitir "instalar apps de origen desconocido" para el navegador).
2. En tu PC, con el teléfono en la misma red Wi-Fi:

   ```bash
   npx expo start --dev-client
   ```

3. Abre la app "destrabe" del teléfono y escanea el QR de la terminal (o elige el servidor de la lista). Los cambios de JS/TS se recargan sin volver a compilar; solo hay que repetir el build si cambian dependencias nativas o plugins.

Para `expo start`, las variables `EXPO_PUBLIC_*` se leen de `app/.env` (paso 2 de Setup).

### Paso 4. APK de demo (`preview`)

```bash
cd app
eas build -p android --profile preview
```

Instala el APK desde el enlace o QR igual que en el paso 3. Arranca sin PC y usa las variables del entorno `preview` de EAS.

## Backend

El backend debe estar corriendo para que la app funcione:

```bash
# Iniciar servicios (PostgreSQL + Redis)
docker compose -f infra/docker-compose.dev.yml up -d postgres redis

# Iniciar backend en modo desarrollo
npm run dev --workspace backend
```

## Manual Smoke Flow (Demo)

Para validar la app manualmente, necesitas **dos dispositivos o emuladores** (un cliente y un operador).

### Flujo completo Gherkin

1. **Auth** — Ambos usuarios:
   - Ingresar teléfono E.164 → "Enviar código"
   - Ingresar código 6 dígitos → "Verificar"
   - La app persiste el token y navega según el rol

2. **Onboarding Operador**:
   - Completar tipo de vehículo y patente → "Crear perfil"
   - Navega al home del operador

3. **Onboarding Cliente**:
   - Pantalla de bienvenida → "Ir al inicio"
   - Navega al home del cliente

4. **Cliente crea servicio**:
   - Presionar FAB (+) → llenar coordenadas de origen → "Solicitar"
   - Esperar cotizaciones (polling 5s)

5. **Operador cotiza**:
   - Activar toggle "Disponible"
   - Ver servicio PENDING en "Servicios Cercanos" (polling 10s)
   - Tocar → ingresar monto → "Cotizar"

6. **Cliente acepta cotización**:
   - Volver a detalle del servicio → ver cotización
   - Presionar "Aceptar"

7. **Pago**:
   - En pantalla de pago → "Pagar"
   - Completar en sandbox de MercadoPago
   - Polling 3s hasta confirmación

8. **Operador completa**:
   - En "Servicio Activo" → "Marcar completado"

### Variables por emulador/dispositivo

Cada dispositivo necesita su propio `.env` o se puede sobrescribir vía Expo. Para probar en un solo emulador, alterna entre roles recargando la app con un usuario diferente.

## Troubleshooting

| Problema                           | Causa común                                              | Solución                                   |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `@rnmapbox/maps` build fail        | `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` no configurado o inválido | Verificar token con scope `DOWNLOADS:READ` |
| Metro `@destrabe/shared` not found | Monorepo workspace no instalado                          | `npm install` desde raíz                   |
| 401 en todas las requests          | Token vencido o faltante                                 | Re-login en la app                         |
| Pantalla de error al startup       | Variable env faltante                                    | Verificar `.env`                           |
| Mapbox no renderiza                | `EXPO_PUBLIC_MAPBOX_TOKEN` no configurado                | Verificar `.env`, recargar app             |
| Prebuild falla                     | Dependencias nativas no instaladas                       | Ejecutar `npm install` primero             |
