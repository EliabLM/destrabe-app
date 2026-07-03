# Spec — Cambio-001: Foundation del monorepo destrabe

**Change ID:** `cambio-001-foundation`
**Etapa SDD:** Spec
**Basado en:** `docs/proposals/cambio-001-foundation/proposal.md`
**Branch:** `develop`

> Cada requisito tiene escenarios Gherkin que mapean 1:1 a tests (TDD estricto). Los tests se escriben antes que la implementación (etapa `apply`).

---

## REQ-001: Workspaces npm configurados

El repo tiene un `package.json` raíz con `workspaces: ["backend","shared"]` que permite instalar y enlazar ambos paquetes desde la raíz.

```gherkin
Scenario: npm install desde la raíz instala ambos workspaces
  Given un environment con Node 20 y el repo clonado
  When se ejecuta `npm install` en la raíz
  Then se crean `node_modules/` en la raíz y enlaces a `backend` y `shared`
  And el comando termina con exit code 0

Scenario: @destrabe/shared es resoluble como workspace dependency desde backend
  Given `backend/package.json` declara `"@destrabe/shared": "*"`
  When backend importa `@destrabe/shared`
  Then se resuelve al paquete local (workspace) sin consultar el registry
```

## REQ-002: Paquete @destrabe/shared consumible

`shared` es un paquete compilable con `tsc` que exporta tipos y schemas Zod consumibles cross-paquete. Incluye un ejemplo canónico: el enum `ServiceStatus` (de la spec técnica §6) y su schema Zod.

```gherkin
Scenario: build de shared genera dist con tipos
  Given el paquete `shared` con `src/index.ts` barrel
  When se ejecuta `npm run build -w @destrabe/shared`
  Then se crea `shared/dist/` con `.js` y `.d.ts`
  And el campo `exports` de `shared/package.json` expone `./dist/index.js` y tipos

Scenario: backend importa y parsea un ServiceStatus válido
  Given el backend depende de `@destrabe/shared`
  When se ejecuta `serviceStatusSchema.parse('PENDING')`
  Then el resultado es `'PENDING'`

Scenario: el schema rechaza un ServiceStatus inválido
  When se ejecuta `serviceStatusSchema.parse('INVALID')`
  Then se lanza un `ZodError`
```

## REQ-003: Backend Express con endpoint /health

`backend/src/app.ts` crea una app Express que monta `GET /health` y un middleware de errores.

```gherkin
Scenario: GET /health responde 200 y body canónico
  Given la app Express levantada
  When se hace `GET /health`
  Then la respuesta es status 200
  And el body es `{ "status": "ok" }`

Scenario: ruta inexistente responde 404
  When se hace `GET /no-existe`
  Then la respuesta es status 404
  And el body contiene `{ "error": "...", "code": "NOT_FOUND" }`
```

## REQ-004: Validación de variables de entorno con Zod

`backend/src/lib/env.ts` valida `process.env` con un schema Zod que incluye `NODE_ENV` y `PORT` (al mínimo). Produce un objeto `env` tipado o lanza con mensaje claro si hay vars inválidas.

```gherkin
Scenario: envs válidos producen objeto tipado
  Given `NODE_ENV=test` y `PORT=3000`
  When se importa `env` desde `lib/env`
  Then `env.PORT` es `3000` (number)
  And `env.NODE_ENV` es `'test'`

Scenario: NODE_ENV ausente defaultea a development
  Given `NODE_ENV` no definido y `PORT=3000`
  When se importa `env`
  Then `env.NODE_ENV` es `'development'`

Scenario: PORT no numérico lanza error claro
  Given `PORT=abc`
  When se importa `env`
  Then se lanza un error cuyo mensaje menciona `PORT`
```

## REQ-005: Error handler middleware

`backend/src/middleware/errorHandler.ts` captura errores no manejados y responde JSON consistente con `{ error, code }`.

```gherkin
Scenario: error lanzado en una ruta responde 500
  Given una ruta que lanza un error
  When se hace la request
  Then la respuesta es status 500
  And el body es `{ "error": "<mensaje>", "code": "INTERNAL_ERROR" }`
```

## REQ-006: Tooling de desarrollo (TS / ESLint / Prettier)

```gherkin
Scenario: tsconfig.base con strict true
  Given `tsconfig.base.json` en la raíz
  Then contiene `"strict": true`
  And `backend` y `shared` lo extienden vía project references

Scenario: lint pasa sin errores
  When se ejecuta `npm run lint`
  Then el exit code es 0

Scenario: build compila sin errores de tipos
  When se ejecuta `npm run build`
  Then `tsc` compila backend y shared sin errores
```

Config de Prettier (decidida): single quotes, semicolons `true`, 2 spaces, trailing comma `"all"`.
Config de ESLint: flat config v9 con `typescript-eslint`.

## REQ-007: Testing con Vitest y cobertura (TDD)

```gherkin
Scenario: npm test corre todos los tests y pasan
  When se ejecuta `npm test`
  Then el exit code es 0
  And existen tests para: /health, env (válido/inválido/default), shared schema (válido/inválido), error handler

Scenario: cobertura mínima 80% en todas las métricas
  When se ejecuta `npm test -- --coverage`
  Then lines >= 80%, branches >= 80%, functions >= 80%, statements >= 80%
```

## REQ-008 (non-functional): Sin dependencia de servicios externos para arrancar

El backend levanta sin PostgreSQL ni Redis corriendo. El prisma client es placeholder; `/health` no toca la DB.

```gherkin
Scenario: backend levanta sin DB ni Redis
  Given PostgreSQL y Redis NO corriendo
  When se ejecuta `npm run dev -w backend`
  Then el server escucha en `PORT`
  And `GET /health` responde 200
```

---

## Resolución de open questions (de la proposal)

- **Prettier:** single quotes, semicolons `true`, 2 spaces, trailing comma `"all"`. → ACEPTADO.
- **Cobertura:** 80% global backend+shared en lines/branches/functions/statements. → ACEPTADO.

## Cobertura de tests (mapeo requisito → test)

| Requisito | Test                                                        |
| --------- | ----------------------------------------------------------- |
| REQ-001   | `shared/__tests__/workspace.test.ts` (resolución de import) |
| REQ-002   | `shared/__tests__/serviceStatus.schema.test.ts`             |
| REQ-003   | `backend/__tests__/health.route.test.ts`                    |
| REQ-004   | `backend/__tests__/env.test.ts`                             |
| REQ-005   | `backend/__tests__/errorHandler.test.ts`                    |
| REQ-006   | `lint` + `build` pasan (CI/manual)                          |
| REQ-007   | suite Vitest + coverage report                              |
| REQ-008   | `backend/__tests__/health.no-db.test.ts`                    |

## Next

Etapa `design`: diseño técnico de la estructura de archivos, config concrets y flujo del server. Luego `tasks`.
