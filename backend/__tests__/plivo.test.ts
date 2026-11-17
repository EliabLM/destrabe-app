import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cliente SMS de Plivo (REQ-005 / DCC-04).
 *
 * - Modo dev (sin PLIVO_AUTH_ID): `sendOtp` registra el OTP y no llama a Plivo.
 * - Con credenciales: `POST /v1/Account/{auth_id}/Message/` con `fetch`,
 *   Basic auth y *timeout*. `fetch` está simulado: nunca se envían SMS reales.
 */

const { envMock } = vi.hoisted(() => ({
  envMock: {
    PLIVO_AUTH_ID: undefined as string | undefined,
    PLIVO_AUTH_TOKEN: undefined as string | undefined,
    PLIVO_PHONE_NUMBER: undefined as string | undefined,
  },
}));

vi.mock('../src/lib/env', () => ({ env: envMock }));

const fetchMock = vi.fn();

function setCredentials() {
  envMock.PLIVO_AUTH_ID = 'MAXXXXXXXXXXXXXXXXXX';
  envMock.PLIVO_AUTH_TOKEN = 'auth-token';
  envMock.PLIVO_PHONE_NUMBER = '+571234567890';
}

describe('plivo client — sendOtp (REQ-005)', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    envMock.PLIVO_AUTH_ID = undefined;
    envMock.PLIVO_AUTH_TOKEN = undefined;
    envMock.PLIVO_PHONE_NUMBER = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('logs the OTP and does not call Plivo when PLIVO_AUTH_ID is not set (dev mode)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendOtp } = await import('../src/lib/plivo');

    await sendOtp('+573001234567', '123456');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('+573001234567'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the message to the Plivo REST API with Basic auth (success)', async () => {
    setCredentials();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_uuid: ['uuid-1'] }), {
        status: 202,
      }),
    );
    const { sendOtp } = await import('../src/lib/plivo');

    await sendOtp('+573001234567', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.plivo.com/v1/Account/MAXXXXXXXXXXXXXXXXXX/Message/',
    );
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('MAXXXXXXXXXXXXXXXXXX:auth-token').toString('base64')}`,
    );
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      src: '+571234567890',
      dst: '+573001234567',
      text: expect.stringContaining('123456'),
    });
    // No registra el contenido del mensaje.
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('rejects on HTTP error without leaking the message or the code', async () => {
    setCredentials();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid dst' }), { status: 400 }),
    );
    const { sendOtp } = await import('../src/lib/plivo');

    const err = await sendOtp('+573001234567', '123456').catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('400');
    expect(err.message).not.toContain('123456');
    for (const spy of [errorSpy, logSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call.join(' '))).not.toContain('123456');
      }
    }
  });

  it('wraps network errors without leaking the message', async () => {
    setCredentials();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { sendOtp } = await import('../src/lib/plivo');

    const err = await sendOtp('+573001234567', '123456').catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Plivo request failed');
  });

  it('aborts the request after the timeout', async () => {
    setCredentials();
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const { sendSms, PLIVO_TIMEOUT_MS } = await import('../src/lib/plivo');

    const pending = sendSms('+573001234567', 'hola').catch((e) => e);
    await vi.advanceTimersByTimeAsync(PLIVO_TIMEOUT_MS + 1);
    const err = await pending;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/timeout/i);
  });
});
