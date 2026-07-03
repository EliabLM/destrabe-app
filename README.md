# destrabe

App móvil de intermediación de servicios de grúa. Modelo de oferta libre (tipo InDriver): el cliente publica una solicitud, los operadores cercanos cotizan, y el cliente acepta la mejor oferta. La plataforma retiene una comisión configurable y transfiere el resto al operador mediante split de pago.

> **Estado:** Fase Demo — estructura base. Sin pagos reales ni tracking en vivo aún.

## Fases

| Fase     | Alcance                                                                                 | Estado        |
| -------- | --------------------------------------------------------------------------------------- | ------------- |
| **Demo** | Flujo completo solicitud → oferta → aceptación. Sin pagos reales, sin tracking en vivo. | En estructura |
| **MVP**  | Pagos reales, tracking GPS, historial, calificaciones, panel admin.                     | Por estimar   |

## Stack

- **App móvil:** React Native (Expo SDK) · TypeScript · React Navigation v7 · Zustand · Axios · Mapbox (`@rnmapbox/maps`) · `socket.io-client`
- **Backend:** Node.js 20 LTS · Express + TypeScript · Prisma · PostgreSQL 16 (PostGIS) · Socket.io · Better Auth · BullMQ + Redis · Zod
- **Servicios externos:** FCM (push) · Plivo (OTP SMS) · Mercado Pago Marketplace (pagos) · Resend (email)
- **Infra:** Docker Compose + Caddy (HTTPS automático) en Hetzner CX22 · CI/CD vía GitHub Actions

## Estructura del repositorio

```
destrabe-app/
├── app/                # App móvil (React Native + Expo)
├── frontend/           # Admin web (MVP)
├── backend/            # API Express + TypeScript
├── shared/             # @destrabe/shared — tipos y schemas Zod
├── infra/              # Docker Compose, Caddyfile, deploy
├── .github/workflows/  # CI/CD
└── docs/               # Trazabilidad SDD + arquitectura
    ├── adr/            # Architecture Decision Records
    ├── architecture/   # Diagramas y diseño de arquitectura
    ├── backlog/        # Backlog de producto
    ├── roadmap/        # Roadmap y fases
    ├── specs/          # SDD — delta specs (requisitos + escenarios)
    ├── proposals/      # SDD — change proposals
    ├── designs/        # SDD — diseños técnicos
    ├── tasks/          # SDD — breakdown de tareas
    ├── testing/        # Estrategia TDD estricto
    ├── runbooks/       # Operación y despliegue
    ├── notes/          # Notas y decisiones
    ├── changelog/      # Changelog por release
    └── retros/         # Retrospectivas
```

## Documentación

- [Especificación técnica v1.0.0](./docs/architecture/spec-tecnica-destrabe-app.md) — contexto y arquitectura base
- [ADRs](./docs/adr/) — decisiones arquitectónicas
- [Roadmap](./docs/roadmap/) — fases Demo → MVP
- [Backlog](./docs/backlog/) — ítems de producto

## Metodología

El proyecto se desarrolla con **SDD (Spec-Driven Development)** y **TDD estricto**:

- Cada cambio sigue el ciclo `proposals → specs → designs → tasks → implementación → verificación`.
- Las decisiones arquitectónicas se registran como ADRs en `docs/adr/`.
- La estrategia y convenios de pruebas viven en `docs/testing/`.

## Empezar

> Estructura base. El setup de cada capa (`app/`, `backend/`, `shared/`) se inicializa en su etapa SDD correspondiente.

```bash
# (pendiente) instalación y arranque por capa — se documenta en cada etapa
```

## Licencia

Por definir.
