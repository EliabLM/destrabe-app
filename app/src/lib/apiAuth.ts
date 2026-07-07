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
 * POST /api/auth/phone/send-otp
 */
export async function otpSend(phoneNumber: string): Promise<void> {
  await api.post('/api/auth/phone/send-otp', { phoneNumber });
}

/**
 * Verify OTP code.
 * POST /api/auth/phone/verify-otp
 * Returns token + user.
 */
export async function otpVerify(
  phoneNumber: string,
  code: string,
): Promise<VerifyOtpResponse> {
  const res = await api.post<VerifyOtpResponse>('/api/auth/phone/verify-otp', {
    phoneNumber,
    code,
  });
  return res.data;
}
