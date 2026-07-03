import { z } from 'zod';
import { userRoleSchema } from './user.schema';

/**
 * Schemas Zod de los contratos de autenticación (cambio-003 / REQ-006, REQ-007).
 *
 * Validan los payloads de los endpoints `phoneNumber` de Better Auth y la
 * shape de la sesión. Usados tanto en backend (validación de requests) como
 * en frontend (formularios + parseo de respuestas).
 */

/** Teléfono en formato E.164: `+<country><number>`. */
const phoneNumberField = z
  .string()
  .min(1, 'phoneNumber es requerido')
  .regex(
    /^\+\d{6,15}$/,
    'phoneNumber debe estar en formato E.164 (ej. +573001234567)',
  );

/** OTP de 6 dígitos (config `otpLength: 6` en design §3). */
const otpCodeField = z
  .string()
  .min(6, 'code debe tener 6 dígitos')
  .max(6, 'code debe tener 6 dígitos')
  .regex(/^\d{6}$/, 'code debe ser numérico');

export const sendOtpRequestSchema = z.object({
  phoneNumber: phoneNumberField,
});

export const verifyOtpRequestSchema = z.object({
  phoneNumber: phoneNumberField,
  code: otpCodeField,
});

export const authUserSchema = z.object({
  id: z.string(),
  phone: z.string(),
  role: userRoleSchema,
});

export const authSessionMetaSchema = z.object({
  id: z.string(),
  token: z.string(),
  userId: z.string(),
  expiresAt: z.union([z.string(), z.date()]),
});

export const authSessionSchema = z.object({
  user: authUserSchema,
  session: authSessionMetaSchema,
});

/** Tipos inferidos desde los schemas (alineados con `shared/src/types/auth.ts`). */
export type SendOtpRequestDTO = z.infer<typeof sendOtpRequestSchema>;
export type VerifyOtpRequestDTO = z.infer<typeof verifyOtpRequestSchema>;
export type AuthUserDTO = z.infer<typeof authUserSchema>;
export type AuthSessionDTO = z.infer<typeof authSessionSchema>;
