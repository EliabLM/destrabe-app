import { env } from './env';

/**
 * Cliente Plivo con modo dev.
 *
 * Sin `PLIVO_AUTH_ID`, `sendOtp` loggea el OTP en consola y NO invoca Plivo
 * (modo dev — REQ-005). Con credenciales, instancia el cliente Plivo con
 * carga perezosa (dynamic import) para no cargar el paquete `plivo` en
 * entornos sin credenciales (dev/tests/unit).
 */

type PlivoClient = {
  messages: {
    create: (params: {
      src: string;
      dst: string;
      text: string;
    }) => Promise<unknown>;
  };
};

let plivoClient: PlivoClient | null = null;

async function getClient(): Promise<PlivoClient | null> {
  if (!env.PLIVO_AUTH_ID || !env.PLIVO_AUTH_TOKEN) return null;
  if (!plivoClient) {
    // Lazy dynamic import: evita cargar plivo en entornos sin credenciales.
    const plivo = await import('plivo');
    // El SDK de Plivo acepta `messages.create({src,dst,text})` (forma objeto)
    // en runtime; casteamos vía `unknown` porque los .ts solo tipan la forma
    // posicional.
    plivoClient = new plivo.Client(
      env.PLIVO_AUTH_ID,
      env.PLIVO_AUTH_TOKEN,
    ) as unknown as PlivoClient;
  }
  return plivoClient;
}

export async function sendOtp(phone: string, code: string): Promise<void> {
  const client = await getClient();
  if (!client) {
    console.log(`[dev] OTP for ${phone}: ${code}`);
    return;
  }
  await client.messages.create({
    src: env.PLIVO_PHONE_NUMBER!,
    dst: phone,
    text: `destrabe: tu código es ${code}. Vence en 5 min.`,
  });
}