# OTP de la demo en los logs (DCC-22)

Para entrar a la demo publicada sin enviar SMS. El código se genera al azar
como siempre, vence a los 5 minutos y cuenta para los mismos límites de envío
(`SMS_LIMIT_*`, `SMS_DAILY_CAP`), pero no se envía: aparece en el log del
backend y solo para los números autorizados.

## Activar

1. En Coolify, en las variables del backend, define `OTP_LOG_NUMBERS` con los
   móviles autorizados en formato `+573XXXXXXXXX`, separados por comas.
2. No definas `OTP_TEST_NUMBERS` ni `OTP_TEST_CODE`: en producción hacen
   fallar el arranque.
3. Vuelve a desplegar. Si un número no tiene el formato `+573…`, el backend no
   arranca y el log dice `OTP_LOG_NUMBERS: solo móviles +573…`.

## Entrar

1. En la app, pide el código con un número de la lista.
2. En Coolify, abre los logs del backend y busca la línea
   `[otp-demo] OTP for +57******4567: 123456` (teléfono enmascarado).
3. Escribe el código en la app antes de 5 minutos. Tiene 3 intentos.

## Qué pasa con otros números

- Sin credenciales de Plivo (`PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`), cualquier
  número fuera de la lista recibe 403 `OTP_LOGIN_RESTRICTED`: "Por ahora el
  ingreso está limitado a cuentas de prueba." No se genera código ni se
  escribe nada de ese número en el log.
- Con credenciales de Plivo, los demás números reciben el SMS normal. Los de
  la lista siguen yendo al log.

## Apagar

Borra `OTP_LOG_NUMBERS` (o déjala vacía) y vuelve a desplegar.

## Seguridad

Los logs del backend en Coolify solo los ve el dueño del proyecto. El código
del log sirve hasta que vence (5 minutos) o se agotan los 3 intentos.
