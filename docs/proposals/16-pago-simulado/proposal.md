# Propuesta — 16: pago simulado en el backend

**Issue:** #16 (DCC-09) · **Rama:** `feature/16-pago-simulado` · **Hallazgos:** DES-A12 (parte backend), DES-A08 (comparación del token)

## Por qué

La demo debe recorrer solicitar → cotizar → aceptar → pagar → completar sin pasarela real. Hoy no se puede:

- `GET /services/:id` no devuelve el pago, así que la app no ve si está pendiente o confirmado.
- Con `PAYMENT_GATEWAY=stub`, `init` devuelve `https://pago.stub/<id>`, un dominio que no existe.
- Confirmar el pago exige llamar al webhook con un token secreto. Nadie puede hacerlo desde la app.
- Sin pago `CONFIRMED` el operador no puede completar el servicio: la demo se corta en `ACTIVE`.

## Qué cambia

- El detalle del servicio incluye `payment { id, status, amount, commission }` para el cliente dueño y el operador asignado.
- Nuevo `POST /payments/:id/simulate` con `{ result: "approved" | "rejected" }`. Solo el cliente dueño, solo con `PAYMENT_GATEWAY=stub` y el flag `pagoSimulado` activo para él, solo desde `PENDING`. Usa la misma transición que el webhook.
- `init` con el stub devuelve `simulated: true` en vez de una URL falsa.
- El token del webhook stub se compara en tiempo constante.

## Fuera de alcance

- Pantallas de la app (DCC-12) y MercadoPago real (DCC-20).
- Reintentar un pago rechazado (queda `FAILED`; ver spec).

## Riesgos

| Riesgo                                                        | Mitigación                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| El endpoint de simulación llega a producción con pagos reales | Exige `PAYMENT_GATEWAY=stub` **y** el flag; con `mercadopago` responde 404.                     |
| Dos confirmaciones a la vez (webhook y simulación)            | La transición solo actualiza si el pago sigue `PENDING` (`updateMany` con condición de estado). |

## Rollback

Revertir el PR. No hay migración de base de datos.
