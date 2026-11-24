# AGENTS.md

Destrabe es una app móvil de intermediación de servicios de grúa. El repo es un monorepo npm con los workspaces `app` (React Native + Expo), `backend` (Express + Prisma) y `shared` (`@destrabe/shared`, tipos y schemas Zod).
La documentación vive en `docs/`. Cada cambio sigue SDD (`proposals → specs → designs → tasks`) y TDD estricto (`docs/testing/estrategia.md`).
Stack, estructura y comandos: [README.md](./README.md).

## Agent skills

### Issue tracker

GitHub Issues de EliabLM/destrabe-app (con `gh`), siguiendo las etiquetas del equipo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` en la raíz + `docs/adr/`. See `docs/agents/domain.md`.
