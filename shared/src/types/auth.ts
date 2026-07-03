import { UserRole } from './user';

/**
 * Tipos de contrato de autenticación (cambio-003 / REQ-006, REQ-007).
 *
 * Estos tipos describen los payloads de los endpoints del plugin
 * `phoneNumber` de Better Auth (`/api/auth/phone/send-otp` y
 * `/api/auth/phone/verify-otp`) y la shape de la sesión devuelta por
 * `getSession`.
 *
 * NOTA: Better Auth almacena el teléfono en el campo `phoneNumber` en el
 * additionalField/columna, mientras que Prisma/spec §6 usa `phone` como
 * nombre de columna. `AuthUser` normaliza a `phone` (coincide con
 * `req.user` del middleware `requireAuth`).
 */

/** Usuario autenticado normalizado (el shape que `requireAuth` setea en `req.user`). */
export interface AuthUser {
  id: string;
  phone: string;
  role: UserRole;
}

/** Metadata mínima de la sesión Better Auth. */
export interface AuthSessionMeta {
  id: string;
  token: string;
  userId: string;
  /** ISO date string o Date según serialización. */
  expiresAt: string | Date;
}

/** Sesión completa devuelta por `auth.api.getSession`. */
export interface AuthSession {
  user: AuthUser;
  session: AuthSessionMeta;
}

/**
 * Payload de `POST /api/auth/phone/send-otp`.
 * El teléfono en formato E.164 (ej. `+573001234567`).
 */
export interface SendOtpRequest {
  phoneNumber: string;
}

/**
 * Payload de `POST /api/auth/phone/verify-otp`.
 * `code` es el OTP de 6 dígitos generado por Better Auth.
 */
export interface VerifyOtpRequest {
  phoneNumber: string;
  code: string;
}

/** Respuesta de `GET /api/auth/session` y de `verify-otp` exitoso. `null` si no hay sesión. */
export type AuthSessionResponse = AuthSession | null;
