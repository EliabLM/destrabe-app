-- DES-02b: solo tras retirar rutas que utilizan estas tablas y verificar respaldo.
-- Reversible únicamente mientras no se requieran invitaciones/eventos históricos:
-- exportar/reconciliar auditoría antes de ejecutar. Ejecutar en transacción de mantenimiento.
DROP TABLE "OperatorInvitationEvent";
DROP TABLE "OperatorInvitation";
