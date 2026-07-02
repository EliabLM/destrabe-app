# Especificación Técnica — App de Intermediación de Grúas
**Versión:** 1.0.0  
**Fecha:** Junio 2026  
**Estado:** Borrador aprobado  

---

## Tabla de contenido

1. [Contexto del proyecto](#1-contexto-del-proyecto)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura del sistema](#3-arquitectura-del-sistema)
4. [Estructura de repositorio](#4-estructura-de-repositorio)
5. [Módulos y responsabilidades](#5-módulos-y-responsabilidades)
6. [Modelo de datos](#6-modelo-de-datos)
7. [Flujos principales](#7-flujos-principales)
8. [Infraestructura y despliegue](#8-infraestructura-y-despliegue)
9. [Variables de entorno](#9-variables-de-entorno)
10. [ADRs — Architecture Decision Records](#10-adrs--architecture-decision-records)

---

## 1. Contexto del proyecto

Aplicación móvil de intermediación entre clientes que necesitan servicios de grúa y operadores de grúa. Funciona bajo un modelo de oferta libre similar a InDriver: el cliente publica una solicitud, los operadores cercanos envían cotizaciones, y el cliente acepta la mejor oferta.

### Alcances definidos

| Fase | Descripción | Plazo |
|---|---|---|
| **Demo** | Flujo completo solicitud → oferta → aceptación. Sin pagos reales, sin tracking en vivo. | < 1 mes |
| **MVP** | Producto operable: pagos reales, tracking GPS, historial, calificaciones, panel admin. | Por estimar |

### Tipos de usuario

- **Cliente:** quien solicita el servicio de grúa.
- **Operador:** quien ofrece el servicio con su grúa.

### Modelo de negocio

La plataforma cobra al cliente y transfiere al operador descontando una comisión configurable. Split de pago vía Mercado Pago Marketplace.

---

## 2. Stack tecnológico

### App móvil

| Capa | Tecnología | Justificación |
|---|---|---|
| Framework | React Native (Expo SDK) | Un solo repo para iOS y Android. Expo simplifica builds y OTA updates. |
| Lenguaje | TypeScript | Type safety end-to-end con el backend. |
| Navegación | React Navigation v7 | Estándar de facto en React Native. |
| Estado global | Zustand | Liviano, sin boilerplate. Suficiente para este dominio. |
| HTTP client | Axios + interceptors | Manejo automático de refresh de token JWT. |
| Mapas | Mapbox SDK RN (`@rnmapbox/maps`) | 50K map loads/mes gratis. 30% más barato que Google Maps a escala. |
| Socket client | `socket.io-client` | Sync con el backend para chat y tracking. |

### Backend

| Capa | Tecnología | Justificación |
|---|---|---|
| Runtime | Node.js 20 LTS | Estabilidad y soporte a largo plazo. |
| Framework | Express + TypeScript | Liviano, flexible, sin overhead de NestJS para este scope. |
| ORM | Prisma | Type-safe, migraciones declarativas, excelente DX con TypeScript. |
| Base de datos | PostgreSQL 16 | Relacional, ACID, soporte nativo de PostGIS para geo-queries. |
| Realtime | Socket.io (integrado en el mismo proceso Express) | Sin dependencia externa. Suficiente para el volumen inicial. |
| Auth | Better Auth | Open source, self-hostable, agnóstico de proveedor, usa el mismo Postgres. |
| Jobs / colas | BullMQ + Redis | Procesamiento async: timeouts de solicitud, notificaciones diferidas. |
| Validación | Zod | Schemas compartibles con el frontend. |

### Servicios externos

| Servicio | Proveedor | Uso |
|---|---|---|
| Push notifications | FCM (Firebase Cloud Messaging) | Gratuito, ilimitado. Solo se usa el servicio de push, no la plataforma Firebase. |
| OTP SMS | Plivo | 30-40% más barato que Twilio. Verify API sin costo por autenticación. |
| Pagos | Mercado Pago Marketplace | Split automático plataforma/operador. Cobertura Colombia. |
| Email transaccional | Resend (free tier: 3K emails/mes) | Confirmaciones, recuperación de cuenta. |

### Infraestructura demo

| Componente | Proveedor |
|---|---|
| VPS | Hetzner CX22 (2 vCPU, 4GB RAM, ~€4.5/mes) |
| Containerización | Docker + Docker Compose |
| Reverse proxy | Caddy (HTTPS automático vía Let's Encrypt) |
| CI/CD | GitHub Actions → SSH deploy |

---

## 3. Arquitectura del sistema

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTES MÓVILES                      │
│          React Native (Expo) — iOS & Android                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / WSS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    CADDY (Reverse Proxy)                     │
│              TLS termination + routing                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐     ┌──────────────────────────────────┐
│   Express API    │     │        Socket.io Server           │
│   REST + Auth    │◄────│  (mismo proceso, puerto 3000)    │
│                  │     │  Namespaces: /tracking /chat      │
└────────┬─────────┘     └──────────────────────────────────┘
         │
    ┌────┴─────────────────────────┐
    │                              │
    ▼                              ▼
┌──────────────┐          ┌──────────────┐
│  PostgreSQL  │          │    Redis      │
│  (Prisma)    │          │  (BullMQ +   │
│              │          │   Socket.io  │
│  Better Auth │          │   adapter)   │
│  tables      │          └──────────────┘
└──────────────┘
         │
    ┌────┴──────────────────────────────────┐
    │              SERVICIOS EXTERNOS        │
    ├──────────────┬────────────┬───────────┤
    │     FCM      │   Plivo    │  Mercado  │
    │    (Push)    │   (OTP)    │   Pago    │
    └──────────────┴────────────┴───────────┘
```

### Comunicación en tiempo real

- **Namespace `/tracking`:** el operador emite su posición GPS cada 3 segundos cuando tiene un servicio activo. El cliente suscrito al room `service:{id}` recibe las actualizaciones.
- **Namespace `/chat`:** mensajes entre cliente y operador dentro de un servicio aceptado. Los mensajes se persisten en Postgres para historial.
- **Adapter Redis:** necesario cuando se escale a más de una instancia del backend. En la demo puede omitirse y usar el adapter en memoria.

---

## 4. Estructura de repositorio

Monorepo con workspaces de npm:

```
gruas-app/
├── apps/
│   ├── mobile/                  # React Native (Expo)
│   │   ├── src/
│   │   │   ├── screens/
│   │   │   │   ├── client/      # Solicitud, cotizaciones, tracking
│   │   │   │   └── operator/    # Dashboard, solicitudes, oferta
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── stores/          # Zustand stores
│   │   │   ├── services/        # Axios instances, socket client
│   │   │   └── navigation/
│   │   ├── app.json
│   │   └── package.json
│   │
│   └── backend/                 # Express API
│       ├── src/
│       │   ├── routes/
│       │   │   ├── auth.routes.ts
│       │   │   ├── service.routes.ts
│       │   │   ├── quote.routes.ts
│       │   │   ├── payment.routes.ts
│       │   │   └── operator.routes.ts
│       │   ├── sockets/
│       │   │   ├── tracking.socket.ts
│       │   │   └── chat.socket.ts
│       │   ├── services/        # Lógica de negocio
│       │   ├── jobs/            # BullMQ workers
│       │   ├── lib/
│       │   │   ├── auth.ts      # Better Auth config
│       │   │   ├── prisma.ts
│       │   │   ├── redis.ts
│       │   │   ├── fcm.ts
│       │   │   └── plivo.ts
│       │   ├── middleware/
│       │   └── app.ts
│       ├── prisma/
│       │   └── schema.prisma
│       └── package.json
│
├── packages/
│   └── shared/                  # Tipos y schemas Zod compartidos
│       ├── src/
│       │   ├── types/
│       │   └── schemas/
│       └── package.json
│
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── Caddyfile
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
└── package.json                 # Root workspace config
```

---

## 5. Módulos y responsabilidades

### Backend — módulos principales

| Módulo | Ruta | Responsabilidad |
|---|---|---|
| Auth | `POST /auth/*` | Better Auth handlers: registro, login OTP, refresh token, logout. |
| Servicios | `POST /services` | Crear solicitud de grúa (cliente). |
| | `GET /services/nearby` | Listar solicitudes cercanas al operador (PostGIS). |
| | `PATCH /services/:id/status` | Cambiar estado: `pending → active → completed → cancelled`. |
| Cotizaciones | `POST /services/:id/quotes` | Operador envía cotización. |
| | `POST /quotes/:id/accept` | Cliente acepta cotización → dispara pago. |
| Pagos | `POST /payments/intent` | Crear intención de pago en Mercado Pago. |
| | `POST /payments/webhook` | Webhook de confirmación MP → activa servicio. |
| Operadores | `GET /operators/profile` | Perfil, historial, rating. |
| | `PATCH /operators/availability` | Toggle disponible/no disponible. |
| Admin | `GET /admin/*` | Panel de administración (MVP). |

### App móvil — pantallas principales

**Flujo Cliente:**
```
Onboarding → Registro/Login (OTP) → Home (mapa)
  → Nueva solicitud → Tipo + ubicación + descripción
  → Esperando cotizaciones → Lista de ofertas
  → Detalle oferta → Confirmar y pagar
  → Tracking en vivo → Servicio completado → Calificar
```

**Flujo Operador:**
```
Onboarding → Registro/Login (OTP) → Dashboard
  → Toggle disponible → Notificación nueva solicitud
  → Detalle solicitud (mapa) → Enviar cotización
  → Esperando → Servicio asignado → Navegar al cliente
  → Completar servicio → Ver ganancias
```

---

## 6. Modelo de datos

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  CLIENT
  OPERATOR
  ADMIN
}

enum ServiceType {
  BREAKDOWN   // Vehículo varado
  TRANSFER    // Traslado programado
}

enum ServiceStatus {
  PENDING      // Esperando cotizaciones
  QUOTED       // Tiene al menos una cotización
  ACTIVE       // Cotización aceptada, en curso
  COMPLETED    // Servicio finalizado
  CANCELLED
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  REFUNDED
}

model User {
  id          String    @id @default(cuid())
  phone       String    @unique
  name        String?
  role        UserRole
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Better Auth sessions (manejadas por la librería)
  sessions    Session[]

  clientProfile   ClientProfile?
  operatorProfile OperatorProfile?
}

model ClientProfile {
  id        String    @id @default(cuid())
  userId    String    @unique
  user      User      @relation(fields: [userId], references: [id])
  services  Service[]
}

model OperatorProfile {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id])
  truckType     String
  licensePlate  String
  photoUrl      String?
  available     Boolean   @default(false)
  rating        Float     @default(0)
  ratingCount   Int       @default(0)
  // Posición actual (actualizada por Socket.io)
  lastLatitude  Float?
  lastLongitude Float?
  lastSeenAt    DateTime?
  mpAccountId   String?   // Mercado Pago Marketplace cuenta vinculada

  quotes        Quote[]
  reviews       Review[]
}

model Service {
  id              String        @id @default(cuid())
  clientProfileId String
  client          ClientProfile @relation(fields: [clientProfileId], references: [id])

  type            ServiceType
  status          ServiceStatus @default(PENDING)
  description     String?
  photoUrl        String?

  // Ubicación origen
  originLat       Float
  originLng       Float
  originAddress   String?

  // Ubicación destino (para traslados)
  destLat         Float?
  destLng         Float?
  destAddress     String?

  acceptedQuoteId String?       @unique
  acceptedQuote   Quote?        @relation("AcceptedQuote", fields: [acceptedQuoteId], references: [id])

  expiresAt       DateTime      // Timeout si no llegan cotizaciones
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  quotes          Quote[]       @relation("ServiceQuotes")
  messages        Message[]
  payment         Payment?
  review          Review?
}

model Quote {
  id                String          @id @default(cuid())
  serviceId         String
  service           Service         @relation("ServiceQuotes", fields: [serviceId], references: [id])
  operatorProfileId String
  operator          OperatorProfile @relation(fields: [operatorProfileId], references: [id])

  amount            Float
  estimatedMinutes  Int?
  note              String?
  createdAt         DateTime        @default(now())

  acceptedForService Service?       @relation("AcceptedQuote")
}

model Payment {
  id              String        @id @default(cuid())
  serviceId       String        @unique
  service         Service       @relation(fields: [serviceId], references: [id])

  mpPaymentId     String?       @unique  // ID de Mercado Pago
  amount          Float
  commission      Float         // Porcentaje cobrado por la plataforma
  operatorAmount  Float         // Monto transferido al operador
  status          PaymentStatus @default(PENDING)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model Message {
  id        String   @id @default(cuid())
  serviceId String
  service   Service  @relation(fields: [serviceId], references: [id])
  senderId  String
  content   String
  createdAt DateTime @default(now())
}

model Review {
  id                String          @id @default(cuid())
  serviceId         String          @unique
  service           Service         @relation(fields: [serviceId], references: [id])
  operatorProfileId String
  operator          OperatorProfile @relation(fields: [operatorProfileId], references: [id])
  rating            Int             // 1-5
  comment           String?
  createdAt         DateTime        @default(now())
}

// Better Auth — tabla de sesiones (generada por la librería)
model Session {
  id        String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}
```

---

## 7. Flujos principales

### 7.1 Registro con OTP (Better Auth + Plivo)

```
Mobile                    Backend                    Plivo
  │                          │                          │
  ├─ POST /auth/phone/send ──►│                          │
  │  { phone: "+573001234" }  ├─ genera OTP (6 dígitos) │
  │                          ├──── SMS OTP ─────────────►│
  │                          │◄─── entregado ───────────┤
  │◄─ 200 { sessionId } ─────┤                          │
  │                          │                          │
  ├─ POST /auth/phone/verify ►│                          │
  │  { sessionId, code }     ├─ valida OTP              │
  │                          ├─ crea User + Profile     │
  │◄─ 200 { accessToken,     │                          │
  │         refreshToken }   │                          │
```

### 7.2 Ciclo de vida de un servicio

```
Estado:    PENDING ──► QUOTED ──► ACTIVE ──► COMPLETED
                                    │
                                    └──► CANCELLED

PENDING:   Cliente crea solicitud. Timer BullMQ: 15 min.
           Si expira sin cotizaciones → CANCELLED + push al cliente.

QUOTED:    Primer operador cotiza. Push al cliente: "Tienes una oferta".
           Múltiples operadores pueden cotizar simultáneamente.

ACTIVE:    Cliente acepta cotización → webhook MP confirma pago
           → Socket.io notifica al operador → tracking activo.

COMPLETED: Operador marca completado → se habilita calificación.
```

### 7.3 Split de pago (Mercado Pago Marketplace)

```
Cliente ──paga──► Mercado Pago
                      │
          ┌───────────┴───────────┐
          │ comisión (X%)         │ monto operador (100-X%)
          ▼                       ▼
   Cuenta plataforma        Cuenta operador MP
```

El porcentaje de comisión es configurable desde el panel admin (almacenado en tabla `Config` en Postgres, no hardcodeado).

### 7.4 Tracking en tiempo real (Socket.io)

```javascript
// Operador emite posición cada 3s
socket.emit('location:update', {
  serviceId: 'srv_123',
  lat: 10.391,
  lng: -75.479,
  timestamp: Date.now()
})

// Backend retransmite al room del servicio
io.to(`service:srv_123`).emit('operator:location', payload)

// Cliente escucha
socket.on('operator:location', ({ lat, lng }) => {
  // actualiza marcador en mapa Mapbox
})
```

---

## 8. Infraestructura y despliegue

### Docker Compose (producción)

```yaml
# infra/docker-compose.prod.yml
version: '3.9'

services:
  backend:
    build: ./apps/backend
    restart: always
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
    depends_on:
      - postgres
      - redis
    ports:
      - "3000:3000"

  postgres:
    image: postgres:16-alpine
    restart: always
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### Caddyfile

```
api.gruas-app.com {
  reverse_proxy backend:3000
}
```

### Pipeline CI/CD (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/gruas-app
            git pull origin main
            docker compose -f infra/docker-compose.prod.yml up -d --build
            docker compose exec backend npx prisma migrate deploy
```

---

## 9. Variables de entorno

```bash
# apps/backend/.env.example

# Base de datos
DATABASE_URL="postgresql://user:password@localhost:5432/gruas_db"

# Redis
REDIS_URL="redis://localhost:6379"

# Better Auth
BETTER_AUTH_SECRET="change-me-32-chars-minimum"
BETTER_AUTH_URL="https://api.gruas-app.com"

# Plivo (OTP)
PLIVO_AUTH_ID=""
PLIVO_AUTH_TOKEN=""
PLIVO_PHONE_NUMBER=""

# FCM (Push notifications)
FCM_PROJECT_ID=""
FCM_PRIVATE_KEY=""
FCM_CLIENT_EMAIL=""

# Mercado Pago
MP_ACCESS_TOKEN=""
MP_PUBLIC_KEY=""
MP_WEBHOOK_SECRET=""
MP_COMMISSION_PERCENTAGE=10

# Mapbox (usado en mobile, pero puede validarse en backend)
MAPBOX_SECRET_TOKEN=""

# Resend (email)
RESEND_API_KEY=""

# App
PORT=3000
NODE_ENV=development
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=30d
SERVICE_TIMEOUT_MINUTES=15
```

---

## 10. ADRs — Architecture Decision Records

---

### ADR-001: React Native con Expo como framework móvil

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La app debe correr en iOS y Android. El equipo tiene experiencia en JavaScript/TypeScript. El tiempo disponible para la demo es menor a 1 mes.

**Decisión:**  
Usar React Native con Expo SDK.

**Consecuencias positivas:**
- Un solo codebase para ambas plataformas.
- Expo simplifica builds nativos, OTA updates y gestión de permisos (GPS, notificaciones).
- Expo Go permite testing en dispositivo sin compilar.

**Consecuencias negativas:**
- Algunas librerías nativas requieren `expo prebuild` y salir del managed workflow.
- Mapbox SDK (`@rnmapbox/maps`) requiere prebuild. Se asume desde el inicio.

**Alternativas descartadas:**
- Flutter: curva de aprendizaje en Dart.
- Nativo iOS/Android: costo de desarrollo x2.

---

### ADR-002: Express + TypeScript en lugar de NestJS

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
El backend cubre una API REST y WebSockets para una app de intermediación. El scope inicial es acotado (< 15 endpoints en la demo).

**Decisión:**  
Usar Express con TypeScript directamente, sin framework de alto nivel.

**Consecuencias positivas:**
- Sin overhead de decoradores, módulos e inyección de dependencias de NestJS.
- Arranque más rápido para la demo.
- Más fácil de entender para cualquier desarrollador Node.js.
- Socket.io se integra nativamente sin adaptadores adicionales.

**Consecuencias negativas:**
- Requiere disciplina manual en la organización del código (sin estructura impuesta).
- Si el proyecto crece significativamente, puede ser conveniente migrar a NestJS.

**Criterio de revisión:**  
Si el equipo supera 3 desarrolladores backend o el número de módulos supera 20, reevaluar migración a NestJS.

---

### ADR-003: Better Auth como solución de autenticación

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La app requiere autenticación por número de teléfono (OTP SMS). Se priorizó portabilidad total de los datos de usuario y capacidad de migrar a infraestructura propia sin fricción.

**Decisión:**  
Usar Better Auth con Postgres propio como store de usuarios.

**Consecuencias positivas:**
- Open source, sin pricing por MAU.
- Los datos de usuarios viven en el Postgres de la aplicación desde el día 1 — no hay migración futura.
- Compatible con Express mediante middleware estándar.
- Plugin de phone OTP disponible en el ecosistema.
- JWTs estándar RS256 — compatibles con cualquier validador futuro (PostgREST, otros servicios).

**Consecuencias negativas:**
- No tiene SDK oficial de React Native. El cliente móvil consume la REST API de Better Auth directamente, lo que requiere implementar manualmente el flujo de token refresh (~1-2 días de trabajo adicional en la demo).
- Proyecto más joven que alternativas como SuperTokens.

**Alternativas descartadas:**
- **Supabase Auth:** lock-in al ecosistema. Migración de hashes de contraseñas es compleja.
- **Clerk:** SaaS puro, no self-hostable. $0.02/MAU, a 100K usuarios son ~$2,000/mes solo en auth.
- **Firebase Auth:** lock-in a Google Cloud. Sin portabilidad.
- **Keycloak:** sobredimensionado para este scope. Requiere JVM + configuración compleja.

---

### ADR-004: Socket.io self-hosted en el mismo proceso Express

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La app necesita dos canales en tiempo real: tracking GPS del operador y chat cliente-operador. Ambos se activan únicamente cuando un servicio está en estado `ACTIVE`.

**Decisión:**  
Integrar Socket.io en el mismo proceso del servidor Express. Redis como adapter para escalabilidad futura.

**Consecuencias positivas:**
- Sin servicio adicional que operar en la demo.
- Latencia mínima (mismo proceso, sin red entre HTTP y WS).
- El adapter de Redis está disponible como `@socket.io/redis-adapter` — activable sin cambio de código cuando se escale horizontalmente.

**Consecuencias negativas:**
- Si el tráfico WebSocket crece mucho, puede competir con el CPU del proceso HTTP. Mitigación: escalar a múltiples instancias con el adapter Redis.

**Alternativas descartadas:**
- **Supabase Realtime:** introduce dependencia externa para un canal; los datos de chat tendrían que sincronizarse entre dos sistemas.
- **Ably:** costo a escala ($0.00026/mensaje), dependencia de tercero innecesaria dado que Socket.io resuelve el caso de uso.

---

### ADR-005: Mapbox como proveedor de mapas

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La app requiere: mapa interactivo, geocoding de dirección a coordenadas, y routing para mostrar ETA del operador. Google Maps era la opción obvia pero el cliente priorizó reducción de costos de infraestructura.

**Decisión:**  
Usar Mapbox con el SDK oficial de React Native (`@rnmapbox/maps`).

**Consecuencias positivas:**
- 50,000 map loads/mes gratuitos — suficiente para demo y primeras semanas de MVP.
- Geocoding: $0.75/1,000 requests vs $5/1,000 de Google Maps (83% más barato).
- Mapa Matching API para snap GPS a carreteras: escala por vehículo activo, no por carga de mapa.
- Google Maps puede activarse en el futuro cambiando solo el provider en la capa de servicios.

**Consecuencias negativas:**
- Cobertura de POIs en Colombia es inferior a Google Maps.
- `@rnmapbox/maps` requiere `expo prebuild` — no funciona en Expo Go.
- Desde agosto 2025, el Search Box de Mapbox cobra por keystroke sin debounce. **Obligatorio implementar debounce ≥ 300ms en cualquier campo de búsqueda de dirección.**

**Alternativas descartadas:**
- **Google Maps:** más costoso a escala. La plataforma busca independencia de Google.
- **HERE Maps:** free tier más generoso (250K requests/mes) pero SDK React Native menos maduro.

---

### ADR-006: Mercado Pago Marketplace como pasarela de pagos

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La plataforma retiene una comisión y transfiere el resto al operador. Se requiere split automático de pagos. El mercado objetivo es Colombia.

**Decisión:**  
Usar Mercado Pago con el producto Marketplace para split automático.

**Consecuencias positivas:**
- Cobertura nativa en Colombia (PSE, tarjeta crédito/débito).
- Split automático plataforma/operador sin transferencias manuales.
- Checkout Pro disponible como SDK para React Native.
- Comisión de MP: ~3.49% + IVA por transacción (competitivo en LATAM).

**Consecuencias negativas:**
- El producto Marketplace requiere aprobación de Mercado Pago Colombia, proceso que puede tomar 1-2 semanas. **Debe iniciarse en paralelo al desarrollo, no al final.**
- Webhooks de confirmación de pago pueden tener latencia de segundos — el servicio no se activa instantáneamente tras el pago.

**Alternativas descartadas:**
- **Stripe:** sin soporte PSE en Colombia. Poco reconocido por el usuario colombiano.
- **Wompi / Kushki:** no tienen split automático nativo tipo Marketplace.

---

### ADR-007: Monorepo con npm workspaces

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
El proyecto tiene dos apps (mobile, backend) que comparten tipos TypeScript y schemas de validación Zod.

**Decisión:**  
Usar monorepo con npm workspaces y un paquete `@gruas/shared` para tipos y schemas compartidos.

**Consecuencias positivas:**
- Un solo `git clone` y `npm install` configura todo el proyecto.
- Los tipos del API (request/response bodies) se definen una vez y se usan en mobile y backend — errores de contrato detectados en compilación, no en runtime.
- CI/CD más simple: un solo pipeline.

**Consecuencias negativas:**
- Builds más lentos si no se configura caché correctamente.
- Requiere disciplina para no crear dependencias circulares entre paquetes.

---

### ADR-008: Plivo como proveedor de OTP SMS

**Fecha:** Junio 2026  
**Estado:** Aceptado

**Contexto:**  
La autenticación es exclusivamente por número de teléfono. Se necesita un proveedor SMS con buena entrega en Colombia y costo predecible.

**Decisión:**  
Usar Plivo para envío de OTP.

**Consecuencias positivas:**
- 30-40% más barato que Twilio en tarifa base.
- Verify API sin costo por autenticación — solo se paga el SMS entregado.
- Fraud Shield incluido sin costo adicional.
- API compatible con Twilio — migración trivial si es necesario.

**Consecuencias negativas:**
- Menor reconocimiento de marca que Twilio (sin impacto técnico).
- Soporte en español limitado.

**Nota sobre WhatsApp OTP:**  
Evaluar en MVP si el OTP por WhatsApp tiene mejor tasa de entrega en Colombia (~$0.02-0.03/mensaje vs SMS). Plivo soporta ambos canales.

---

*Documento generado para uso con Claude Code. Mantener actualizado ante cualquier cambio de decisión arquitectónica.*
