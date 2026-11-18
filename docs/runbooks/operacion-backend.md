# Operación del backend (DCC-17)

## Sondas de salud

| Ruta                | Qué comprueba                                                        | Uso                                         |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `GET /health/live`  | Solo que el proceso responde. No toca la BD ni Redis.                | Healthcheck del contenedor en Coolify.      |
| `GET /health/ready` | BD (`SELECT 1`) y, mientras exista, Redis (`PING`), con 2 s de tope. | Saber si la API puede atender; diagnóstico. |
| `GET /health`       | Igual que `/health/ready`. Se mantiene por compatibilidad.           | —                                           |

Coolify debe usar `/health/live`: si la BD o Redis fallan un momento, el contenedor no se reinicia en bucle; `/health/ready` responde 503 y lo deja ver. El cambio en Coolify lo hace `ops` con permiso del usuario.

Las sondas que responden bien no se registran en el log.

## Logs

- Una línea JSON por evento en stdout (`pino`). Coolify ya guarda la salida del contenedor.
- Cada petición lleva un `requestId`: se toma de la cabecera `X-Request-Id` si llega una válida (hasta 128 caracteres `A-Z a-z 0-9 _ . : -`) y si no se genera. Se devuelve siempre en `X-Request-Id`.
- Por petición se registra método, ruta (sin query), estado y duración. No se registran cabeceras ni cuerpo.
- Se ocultan (`[REDACTED]`) los campos `authorization`, `cookie`, `set-cookie`, `x-webhook-token`, `password`, `token`, `accessToken`, `refreshToken`, `secret`, `otp`, `otpCode`, `phone` y `phoneNumber`. Los números de teléfono dentro del texto de un error se enmascaran (`+57******4567`).

## Errores

- 4xx: igual que antes, `{ error, code }`.
- 5xx: `{ error: "Internal Server Error", code, requestId }`. El mensaje y la traza solo van al log; con el `requestId` se encuentra la línea. Los errores de dominio 5xx (p. ej. `MERCADOPAGO_ERROR`) conservan su `code`.

## Cabeceras HTTP

`helmet()` con su configuración por defecto y sin `X-Powered-By`. `CORS_ORIGIN` es obligatorio en producción y no puede ser `*`; en desarrollo local y pruebas vale `*` por defecto.

## Arranque y apagado

- La imagen arranca con `backend/docker-entrypoint.sh`: aplica las migraciones y, si terminan bien, hace `exec node`. Node queda como PID 1 y recibe las señales.
- Con `SIGTERM` o `SIGINT` el proceso deja de aceptar conexiones, espera las peticiones en curso, cierra los procesos de fondo registrados en `steps` (`backend/src/server.ts`), desconecta Prisma y sale con 0. Si algo falla sale con 1; si tarda más de 8 s, fuerza la salida con 1 (Docker manda `SIGKILL` a los 10 s).
- Un proceso de fondo nuevo (p. ej. el barrido de expiración de servicios) se añade a `steps` para que se detenga antes de cerrar la BD.
