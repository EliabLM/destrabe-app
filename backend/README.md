# Backend: ejecución en producción (DES-06a)

Construir desde la raíz: `npm ci`, `npm run build -w @destrabe/shared`, `npx prisma generate --schema=backend/prisma/schema.prisma`, `npm run build -w @destrabe/backend`. El JS queda en `backend/dist/server.js`; las pruebas no se emiten. Configurar las variables indicadas en `backend/.env.example` mediante el gestor de secretos del entorno, **nunca** copiar esa plantilla como configuración pública. Desde `backend/`, `npm start` ejecuta `prisma migrate deploy --schema=prisma/schema.prisma` y **sólo si termina bien** inicia `node dist/server.js`. La base PostGIS es un servicio externo (desde DCC-19 no se usa Redis); no se crean ni se cargan datos de prueba.

La imagen se construirá en CI para `linux/arm64` desde la raíz (`docker buildx build --platform linux/arm64 -f Dockerfile .`); ambas etapas usan Debian bookworm-slim y `prisma generate` corre dentro de la etapa runtime para seleccionar su motor nativo ARM64. No ejecutar este build en el VPS. `GET /health` comprueba la DB (`SELECT 1`) y responde 503 sin detalles cuando falla o supera 2 s. Al arrancar, el proceso inicia también el barrido que cancela los servicios vencidos (`SERVICE_EXPIRY_SWEEP_SECONDS`, 60 por defecto); ver `docs/runbooks/expiracion-servicios.md`. No es una prueba de despliegue ni de una base real.

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
- Si la transacción de conteo no obtiene conexión o bloqueo a tiempo (`maxWait` 5 s, `timeout` 10 s), responde 503 `SMS_TEMPORARILY_UNAVAILABLE` (nunca 500) y no envía.
- IP real: `TRUST_PROXY` (por defecto `loopback,uniquelocal`) fija el `trust proxy` de Express; antes de Better Auth, `X-Forwarded-For` se reemplaza por esa IP única, así que Better Auth no necesita `trustedProxies`. Debe cubrir la red Docker de Traefik/Coolify; `true` no se admite. **Da por hecho que solo Traefik llega al contenedor: no publicar su puerto en el host.** Si se publicara, las conexiones llegarían desde la puerta de enlace de Docker (red privada, de confianza) y `X-Forwarded-For` se podría falsificar; en ese caso, restringir `TRUST_PROXY` al CIDR de la red de Coolify.
- Desarrollo y pruebas: los números de `OTP_TEST_NUMBERS` (separados por comas) usan el código fijo `OTP_TEST_CODE`, sin SMS y sin consumir cupo. En producción, definir cualquiera de las dos hace fallar el arranque.
- Demo (DCC-22): los números de `OTP_LOG_NUMBERS` (separados por comas, permitida en producción) reciben un código al azar con el mismo vencimiento y los mismos límites, pero no se envía SMS: el código se escribe en el log (`[otp-demo] OTP for +57******4567: 123456`). En producción sin Plivo, cualquier otro número recibe 403 `OTP_LOGIN_RESTRICTED` ("Por ahora el ingreso está limitado a cuentas de prueba.") antes de generar el código. Guía: `docs/runbooks/otp-demo.md`.
- Logs: el teléfono se enmascara (`+57******4567`). En producción sin credenciales de Plivo solo se imprime el código de los números de `OTP_LOG_NUMBERS`; el de cualquier otro número nunca se imprime. Fuera de producción sin credenciales el código se imprime en el log.
- **Coste:** con el tope de 20 y la tarifa más cara de Plivo a Colombia (USD 0,3789 en Movistar y "otros"), el peor caso es de unos USD 7,6 al día, que puede repetirse cada día. **El tope real es el saldo prepagado de Plivo** (sin recarga automática): mantenerlo bajo y activar en la consola de Plivo una alerta de saldo o gasto.
- Limitación inherente: cualquiera puede agotar el cupo de un número concreto (24 h sin poder entrar) o el tope global con pocas IP. Es el precio de acotar el coste. `PAYMENT_GATEWAY=stub` evita pagos reales. Dominio de API y origen CORS se configuran por entorno. No ejecutar `prisma migrate dev` en producción.
