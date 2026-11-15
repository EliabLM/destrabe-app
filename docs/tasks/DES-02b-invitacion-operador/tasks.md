# DES-02b — Tareas y verificación

- [x] Test RED/GREEN shared para cuerpos estrictos y token 256 bits.
- [x] Test HTTP RED/GREEN para sesiones, bodies, secreto solo en emisión y respuestas.
- [x] Test de flujo móvil RED/GREEN para canje, /api/me y error de red.
- [ ] DB aislada CI: alta CLIENT, ADMIN/no ADMIN, teléfono, expiración, replay/concurrencia, fallo transaccional, cuota/auditoría, índices/FK y rollback de ensayo; confirmar resultado de job `Contratos DB` en HEAD exacto.
- [ ] Prueba pública Better Auth en DB aislada: `role` enviado por OTP/update-user permanece CLIENT.
- [ ] Verificar npm ci, build shared/backend, prisma generate, ts:check app, npm test, lint, format:check y diff --check.
- [ ] Revisión CTO vía PR; sin merge/despliegue/ADMIN real.
