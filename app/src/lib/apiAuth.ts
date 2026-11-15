import { api } from './api';

export interface VerifyOtpResponse {
  token: string;
  user: {
    id: string;
    phoneNumber: string;
    role: string;
  };
}

/**
 * Send OTP to phone number.
 * POST /api/auth/phone-number/send-otp
 */
export async function otpSend(phoneNumber: string): Promise<void> {
  await api.post('/api/auth/phone-number/send-otp', { phoneNumber });
}

/**
 * Verify OTP code.
 * POST /api/auth/phone-number/verify
 * Better Auth devuelve el token de sesión firmado en set-auth-token (bearer plugin).
 */
export async function otpVerify(
  phoneNumber: string,
  code: string,
): Promise<VerifyOtpResponse> {
  const res = await api.post<VerifyOtpResponse>('/api/auth/phone-number/verify', {
    phoneNumber,
    code,
  });
  const token = res.headers['set-auth-token'];
  if (typeof token !== 'string' || !token) {
    throw new Error('La verificación no devolvió un token de sesión');
  }
  return { ...res.data, token };
}

/** Revoca la sesión persistida en el servidor usando el Bearer actual. */
export async function otpSignOut(): Promise<void> {
  await api.post('/api/auth/sign-out');
}
