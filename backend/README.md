# Backend: ejecución en producción (DES-06a)

Construir desde la raíz: `npm ci`, `npm run build -w @destrabe/shared`, `npx prisma generate --schema=backend/prisma/schema.prisma`, `npm run build -w @destrabe/backend`. El JS queda en `backend/dist/server.js`; las pruebas no se emiten. Configurar las variables indicadas en `backend/.env.example` mediante el gestor de secretos del entorno, **nunca** copiar esa plantilla como configuración pública. Desde `backend/`, `npm start` ejecuta `prisma migrate deploy --schema=prisma/schema.prisma` y **sólo si termina bien** inicia `node dist/server.js`. La base PostGIS y Redis son servicios externos; no se crean ni se cargan datos de prueba.

La imagen se construirá en CI para `linux/arm64` desde la raíz (`docker buildx build --platform linux/arm64 -f Dockerfile .`); ambas etapas usan Debian bookworm-slim y `prisma generate` corre dentro de la etapa runtime para seleccionar su motor nativo ARM64. No ejecutar este build en el VPS. `GET /health` comprueba DB (`SELECT 1`) y Redis (`PING`), responde 503 sin detalles cuando una dependencia falla o supera 2 s. No es una prueba de despliegue ni de una base real.

## OTP por SMS (DCC-05)

- Solo se envía a móviles colombianos (`^\+573\d{9}$`); cualquier otro número responde 400 antes de generar el código.
- Límites persistentes en Postgres (tabla `SmsSendLog`, guarda HMAC del teléfono y de la IP, nunca el valor en claro; se purga a los 2 días). Ventanas deslizantes; al superarlos responde 429 `TOO_MANY_OTP_REQUESTS`:

  | Variable                | Por defecto | Qué limita                                                                                     |
  | ----------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
  | `SMS_LIMIT_PHONE_15MIN` | 3           | envíos al mismo número en 15 min                                                               |
  | `SMS_LIMIT_PHONE_DAY`   | 10          | envíos al mismo número en 24 h                                                                 |
  | `SMS_LIMIT_IP_HOUR`     | 10          | envíos desde la misma IP en 1 h                                                                |
  | `SMS_LIMIT_IP_DAY`      | 30          | envíos desde la misma IP en 24 h                                                               |
  | `SMS_DAILY_CAP`         | 50          | SMS en total en 24 h; al llegar responde 503 `SMS_DAILY_CAP_REACHED` y deja un aviso en el log |

- OTP de 6 dígitos, caduca a los 5 min y se invalida tras 3 intentos fallidos.
- IP real: `TRUST_PROXY` (por defecto `loopback,uniquelocal`) fija el `trust proxy` de Express; antes de Better Auth, `X-Forwarded-For` se reemplaza por esa IP única, así que Better Auth no necesita `trustedProxies`. Debe cubrir la red Docker de Traefik/Coolify; `true` no se admite.
- Desarrollo y pruebas: los números de `OTP_TEST_NUMBERS` (separados por comas) usan el código fijo `OTP_TEST_CODE`, sin SMS y sin consumir cupo. En producción, definir cualquiera de las dos hace fallar el arranque.
- Logs: el teléfono se enmascara (`+57******4567`). En producción sin credenciales de Plivo el envío falla de forma explícita y el código nunca se imprime; fuera de producción sin credenciales el código se imprime en el log.
- Recomendado: activar en la consola de Plivo una alerta de saldo o gasto. `PAYMENT_GATEWAY=stub` evita pagos reales. Dominio de API y origen CORS se configuran por entorno. No ejecutar `prisma migrate dev` en producción.
