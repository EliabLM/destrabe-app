import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { phoneNumber } from 'better-auth/plugins';
import { toNodeHandler } from 'better-auth/node';
import { prisma } from './prisma';
import { env } from './env';
import { sendOtp } from './plivo';

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
 * - `additionalFields.role`: rol de usuario almacenado como string (Better Auth
 *   no soporta enum directo); se castea a `UserRole` al leer.
 * - `authHandler`: handler montable en Express vía `toNodeHandler(auth.handler)`
 *   (la firma de `toNodeHandler` acepta `{ handler } | handler`).
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  plugins: [
    phoneNumber({
      sendOTP: ({ phoneNumber, code }) => sendOtp(phoneNumber, code),
      otpLength: 6,
      expiresIn: 5 * 60, // 5 min
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'CLIENT',
      },
    },
  },
});

/**
 * Handler montable en Express:
 * `app.all('/api/auth/*', authHandler)` (T6).
 */
export const authHandler = toNodeHandler(auth.handler);
