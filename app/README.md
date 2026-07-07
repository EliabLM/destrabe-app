# Destrabe App — Expo Dev Build

Aplicación móvil Expo para la Demo de Destrabe (clientes y operadores de asistencia en ruta).

## Prerequisites

| Tool   | Version    | Notes                                |
|--------|------------|--------------------------------------|
| Node   | >= 20.x    |                                      |
| npm    | >= 10.x    |                                      |
| JDK    | >= 17      | Solo Android (temurin/recomendado)   |
| Android SDK | API 34+ | Solo Android, con `ANDROID_HOME` set |
| Xcode  | >= 15.x    | Solo iOS                             |

## Setup

### 1. Install workspace dependencies

```bash
# From the monorepo root
npm install --legacy-peer-deps
```

> Nota: `--legacy-peer-deps` puede ser necesario por un conflicto entre `@rnmapbox/maps` (requiere react-native >= 0.79) y la versión 0.74.5 de Expo SDK 51.

### 2. Environment variables

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Las siguientes variables **runtime** son necesarias (validadas al startup por la app):

| Variable                    | Descripción                   | Ejemplo                          |
|-----------------------------|-------------------------------|----------------------------------|
| `EXPO_PUBLIC_API_URL`       | URL base del backend          | `http://localhost:3001`          |
| `EXPO_PUBLIC_MAPBOX_TOKEN`  | Mapbox public token (runtime) | `pk.eyJ1Ijoi...`                 |

La siguiente variable es **build-time** (solo necesaria para `npx expo prebuild`):

| Variable                     | Descripción                                      |
|------------------------------|--------------------------------------------------|
| `MAPBOX_DOWNLOADS_TOKEN`     | Mapbox secret token para descargar SDK nativo    |

> Obtén `MAPBOX_DOWNLOADS_TOKEN` desde [Mapbox Account > Access Tokens](https://account.mapbox.com/access-tokens/). Crea un token con scopes `DOWNLOADS:READ`. Sin este token, `@rnmapbox/maps` falla en la compilación nativa.

### 3. Prebuild (solo necesario la primera vez o al cambiar plugins nativos)

```bash
MAPBOX_DOWNLOADS_TOKEN=xxxxx npx expo prebuild
```

Esto genera las carpetas `android/` e `ios/` con los proyectos nativos. Ambos directorios están en `.gitignore` y no se commitan.

> ⚠️ Si omites `MAPBOX_DOWNLOADS_TOKEN`, el prebuild fallará porque `@rnmapbox/maps` no puede descargar el SDK de Mapbox nativo.

### 4. Run

```bash
# Usando npm workspaces (recomendado)
npm run dev --workspace app

# O directamente con Expo
npx expo run:android   # Android
npx expo run:ios       # iOS
```

Para hot-reload en desarrollo JS/TS no es necesario re-ejecutar prebuild — solo salvar el archivo.

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

| Problema                          | Causa común                                      | Solución                                           |
|-----------------------------------|--------------------------------------------------|----------------------------------------------------|
| `@rnmapbox/maps` build fail       | `MAPBOX_DOWNLOADS_TOKEN` no configurado o inválido | Verificar token con scope `DOWNLOADS:READ`        |
| Metro `@destrabe/shared` not found| Monorepo workspace no instalado                   | `npm install` desde raíz                           |
| 401 en todas las requests         | Token vencido o faltante                          | Re-login en la app                                 |
| Pantalla de error al startup      | Variable env faltante                             | Verificar `.env`                                   |
| Mapbox no renderiza               | `EXPO_PUBLIC_MAPBOX_TOKEN` no configurado         | Verificar `.env`, recargar app                     |
| Prebuild falla                    | Dependencias nativas no instaladas                | Ejecutar `npm install` primero                     |
