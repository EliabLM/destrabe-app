import { env } from './env';
import { maskPhone } from './logMask';

/**
 * Cliente SMS de Plivo sin SDK (DCC-04).
 *
 * Llama directamente a la API REST de Plivo
 * (`POST /v1/Account/{auth_id}/Message/`) con `fetch`, Basic auth y un
 * *timeout*. Sustituye al SDK `plivo`, que arrastraba `request` (abandonado).
 *
 * Sin `PLIVO_AUTH_ID`/`PLIVO_AUTH_TOKEN`: fuera de producción `sendOtp`
 * registra el OTP (con el teléfono enmascarado) y NO llama a Plivo; en
 * producción falla de forma explícita y nunca imprime el código (DCC-05).
 *
 * Los errores nunca incluyen el texto del mensaje ni el destinatario.
 */

export const PLIVO_API_BASE = 'https://api.plivo.com/v1';
export const PLIVO_TIMEOUT_MS = 10_000;

export async function sendSms(dst: string, text: string): Promise<void> {
  const authId = env.PLIVO_AUTH_ID;
  const authToken = env.PLIVO_AUTH_TOKEN;
  if (!authId || !authToken) {
    throw new Error('Plivo credentials are not configured');
  }

  const url = `${PLIVO_API_BASE}/Account/${encodeURIComponent(authId)}/Message/`;
  const basic = Buffer.from(`${authId}:${authToken}`).toString('base64');

  // AbortController + setTimeout (en vez de AbortSignal.timeout) para poder
  // simular el reloj en los tests.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLIVO_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ src: env.PLIVO_PHONE_NUMBER, dst, text }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Plivo request timeout after ${PLIVO_TIMEOUT_MS} ms`);
    }
    throw new Error('Plivo request failed', { cause: err });
  } finally {
    clearTimeout(timer);
  }

  // No necesitamos el cuerpo (y puede repetir el mensaje o el destinatario).
  await res.body?.cancel().catch(() => {});
  if (!res.ok) {
    throw new Error(`Plivo responded with HTTP ${res.status}`);
  }
}

export async function sendOtp(phone: string, code: string): Promise<void> {
  if (!env.PLIVO_AUTH_ID || !env.PLIVO_AUTH_TOKEN) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Plivo credentials are not configured');
    }
    console.log(`[dev] OTP for ${maskPhone(phone)}: ${code}`);
    return;
  }
  await sendSms(phone, `destrabe: tu código es ${code}. Vence en 5 min.`);
}
