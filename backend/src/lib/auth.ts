import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer, phoneNumber } from 'better-auth/plugins';
import { toNodeHandler } from 'better-auth/node';
import { isColombianMobile } from '@destrabe/shared';
import { prisma } from './prisma';
import { env } from './env';
import { sendOtp } from './plivo';
import {
  checkSmsAllowed,
  clientIpFromHeaders,
  isOtpTestNumber,
  reserveSmsSend,
} from './smsGuard';

/** Caducidad del OTP (≤ 5 min, DCC-05). */
export const OTP_EXPIRES_IN_SECONDS = 5 * 60;
/** Intentos de verificación por código; al agotarlos el código se invalida. */
export const OTP_ALLOWED_ATTEMPTS = 3;

/**
 * Better Auth config (cambio-003 / REQ-003).
 *
 * - `prismaAdapter`: puentea Better Auth contra el PrismaClient (Postgres).
 * - `phoneNumber` plugin: OTP por SMS. `sendOTP` delega a `sendOtp` (Plivo en
 *   prod / log en dev). Se OMITE `verifyOTP` para que Better Auth verifique
 *   internamente el código contra la tabla `Verification` (la lib genera y
 *   persiste el OTP durante `sendOTP`). El design proponía
 *   `verifyOTP: () => false` como placeholder, pero eso bloquearía toda
 *   verificación → desviación documentada en el return del apply.
 * - `signUpOnVerification`: al verificar un teléfono SIN usuario existente,
 *   el plugin lanza `FAILED_TO_UPDATE_USER` (500) a menos que se configure
 *   este callback. Lo añadimos para habilitar el registro solo por teléfono
 *   (la spec implícita REQ-007 espera que verify cree sesión+usuario para un
 *   teléfono nuevo). Email temporal determinista por teléfono; `email` es
 *   opcional+unique en el schema, así que el dominio `.local` evita colisiones
 *   con futuros registros por email. Ajuste detectado en T9 (apply).
 * - `additionalFields.role`: rol de usuario almacenado como string (Better Auth
 *   no soporta enum directo); se castea a `UserRole` al leer.
 * - DCC-05: solo móviles `+573…` (`phoneNumberValidator`), límites por número,
 *   por IP y tope diario global en Postgres (`smsGuard`), `allowedAttempts`.
 *   El hook `before` corta antes de generar el código; `sendOTP` vuelve a
 *   comprobar y registra el envío de forma atómica. La IP del cliente llega en
 *   `x-forwarded-for` con un único valor que Express calcula con `trust proxy`
 *   (ver `normalizeClientIp`); por eso Better Auth no necesita `trustedProxies`.
 * - `authHandler`: handler montable en Express vía `toNodeHandler(auth.handler)`
 *   (la firma de `toNodeHandler` acepta `{ handler } | handler`).
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  advanced: {
    ipAddress: {
      // Un único valor, puesto por `normalizeClientIp` (Express + trust proxy).
      ipAddressHeaders: ['x-forwarded-for'],
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/phone-number/send-otp') return;
      await checkSmsAllowed(
        ctx.body?.phoneNumber,
        clientIpFromHeaders(ctx.headers ?? ctx.request?.headers),
      );
    }),
  },
  plugins: [
    bearer(),
    phoneNumber({
      phoneNumberValidator: (phone) => isColombianMobile(phone),
      // OJO: no configurar `advanced.backgroundTasks`. Con él, Better Auth no
      // espera a `sendOTP` y los 429/503 de `reserveSmsSend` no llegarían al
      // cliente (el código se generaría igualmente).
      sendOTP: async ({ phoneNumber, code }, ctx) => {
        if (isOtpTestNumber(phoneNumber) && ctx) {
          // Desarrollo/pruebas: código fijo, sin SMS ni consumo de cupo.
          const identifier = `phone-number-otp-${phoneNumber}`;
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            identifier,
          );
          await ctx.context.internalAdapter.createVerificationValue({
            identifier,
            value: `${env.OTP_TEST_CODE}:0`,
            expiresAt: new Date(Date.now() + OTP_EXPIRES_IN_SECONDS * 1000),
          });
          return;
        }
        await reserveSmsSend(
          phoneNumber,
          clientIpFromHeaders(ctx?.headers ?? ctx?.request?.headers),
        );
        await sendOtp(phoneNumber, code);
      },
      otpLength: 6,
      expiresIn: OTP_EXPIRES_IN_SECONDS,
      allowedAttempts: OTP_ALLOWED_ATTEMPTS,
      // Sign-up por teléfono: si verify-otp no encuentra usuario, Better Auth
      // crea un User con `email = getTempEmail(phoneNumber)` y marca
      // `phoneNumberVerified=true`. Necesario para el flujo de registro solo
      // por teléfono (T9 / REQ-007). Sin esto, la verificación de un teléfono
      // nuevo responde 500 `FAILED_TO_UPDATE_USER`.
      signUpOnVerification: {
        getTempEmail: (phoneNumber) => `tmp+${phoneNumber}@destrabe.local`,
      },
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'CLIENT',
        input: false, // nunca aceptarlo en sign-up/update-user público
      },
    },
  },
});

/**
 * Handler montable en Express:
 * `router.use('/api/auth', authHandler)` (T6).
 */
export const authHandler = toNodeHandler(auth.handler);
