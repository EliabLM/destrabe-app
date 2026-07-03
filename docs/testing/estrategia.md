# Estrategia de Testing — destrabe

## Filosofía: TDD estricto

Red → Green → Refactor. Cada pieza de código nace de un test que la justifica.

1. Escribir el test primero (RED: falla porque la impl no existe).
2. Escribir la implementación mínima para que pase (GREEN).
3. Refactorizar manteniendo el test verde.

## Suites separadas (backend)

| Suite | Comando            | Requiere DB  | Config                | Alcance                                                              |
| ----- | ------------------ | ------------ | --------------------- | -------------------------------------------------------------------- |
| unit  | `npm test`         | No           | `vitest.config.ts`    | schemas Zod, env, middleware, routes (sin tocar Postgres)            |
| db    | `npm run test:db`  | Sí (`db:up`) | `vitest.db.config.ts` | relaciones Prisma, cascade, enum constraints (fileParallelism=false) |
| all   | `npm run test:all` | Sí           | ambos                 | unit + db                                                            |

Helper de tests DB: `backend/__tests__/db/helpers.ts` — `prisma` + `resetDb()` (TRUNCATE todas las tablas CASCADE, en una sola sentencia para evitar deadlocks).

## Runners por dominio

| Dominio                    | Runner           | Alcance                                      |
| -------------------------- | ---------------- | -------------------------------------------- |
| backend + shared (Node)    | Vitest           | API Express, schemas Zod, lógica de servidor |
| app/ (React Native + Expo) | Jest + jest-expo | componentes, hooks, stores (futuro)          |

Vitest se eligió por soporte nativo de TS, watch rápido y ESM. RN usará Jest porque Expo lo integra por defecto. Los runners están scoped por dominio (no se mezclan).

## Cobertura

- Herramienta: `@vitest/coverage-v8` (provider v8).
- Umbral mínimo: 80% en lines, branches, functions y statements (global backend+shared).
- Config: `vitest.config.ts` raíz. `include: backend/src/**/*.ts`, `shared/src/**/*.ts`.
- Exclusiones de cobertura: barrels (`**/index.ts`), `backend/src/server.ts` (entry de arranque), `backend/src/lib/prisma.ts` (placeholder).
- Estado actual: 100% (cambio-001-foundation).

## Convenciones

- Archivos de test: `*.test.ts` dentro de `__tests__/` por paquete.
- Helpers de test: `__tests__/helpers/` si hace falta.
- `describe`: nombre del módulo o ruta.
- Tests HTTP (backend): `supertest` contra `createApp()` (factory sin `listen`).
- Tests unitarios de middleware: llamada directa con mocks o mini-app Express.

## Comandos

```bash
npm test                      # corre toda la suite (vitest run)
npm test -- --coverage        # con reporte de cobertura
npm run test:watch            # modo watch (TDD)
npm run test -w @destrabe/shared   # solo shared
npm run test -w @destrabe/backend  # solo backend
```

## Integración vs unitario

- **Unitario**: schemas (shared), `parseEnv`, middleware directo.
- **Integración**: `/health` vía supertest, resolución de workspace (`@destrabe/shared` desde backend).

## Próximos dominios (futuro)

- **app/ (RN)**: Jest + jest-expo + @testing-library/react-native. Se documentará al iniciar el cambio mobile.
- **E2E**: pendiente (probable Detox o Maestro) — se evalúa en MVP.
