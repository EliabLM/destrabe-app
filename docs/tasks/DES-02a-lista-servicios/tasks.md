# DES-02a — Tareas y trazabilidad

- [x] Comparar `main` fresco, contratos previos y límites de rol/perfil; spec y diseño delta.
- [x] RED→GREEN shared: `servicesList.schema.test.ts` (límite, query estricta, envelope).
- [x] RED→GREEN backend: `services.list.routes.test.ts` (auth, perfil ausente, keyset, cursor, ownership).
- [x] RED→GREEN app: `services.mobile.pager.test.ts`, `services.mobile.api.test.ts`, `services.mobile.session.test.ts` (páginas, errores, carrera logout/401).
- [ ] Integración CI: `db/services.list.test.ts` con Postgres temporal, dos CLIENT, empates y recorrido completo; registrar checks del HEAD del PR.
- [ ] Verificar `npm test`, build shared/backend, `ts:check` app, lint, format; no ejecutar DB local sin infraestructura aislada.
- [ ] Commit, push, PR español y revisión CTO. Sin merge.
