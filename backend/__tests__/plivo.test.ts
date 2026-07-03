import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T2 — Plivo client (REQ-005)
 * - dev mode (sin PLIVO_AUTH_ID): sendOtp loggea OTP, no invoca Plivo.
 * - prod mode (PLIVO vars set): sendOtp invoca client.messages.create.
 *
 * Mocks hoisted para interceptar el `require('plivo')` lazy-loading y el
 * import de `./env` que consume plivo.ts. `envMock` es un objeto mutable
 * compartido entre el mock y los tests.
 */

const { ClientCtor, plivoClientMock, envMock } = vi.hoisted(() => ({
  ClientCtor: vi.fn(),
  plivoClientMock: { messages: { create: vi.fn() } },
  envMock: {
    PLIVO_AUTH_ID: undefined as string | undefined,
    PLIVO_AUTH_TOKEN: undefined as string | undefined,
    PLIVO_PHONE_NUMBER: undefined as string | undefined,
  },
}));

vi.mock('../src/lib/env', () => ({ env: envMock }));

vi.mock('plivo', () => ({ Client: ClientCtor }));

describe('plivo client — sendOtp (REQ-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ClientCtor.mockReturnValue(plivoClientMock);
    plivoClientMock.messages.create.mockResolvedValue({});
    envMock.PLIVO_AUTH_ID = undefined;
    envMock.PLIVO_AUTH_TOKEN = undefined;
    envMock.PLIVO_PHONE_NUMBER = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the OTP and does not call Plivo when PLIVO_AUTH_ID is not set (dev mode)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendOtp } = await import('../src/lib/plivo');

    await sendOtp('+573001234567', '123456');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('+573001234567'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('123456'));
    expect(ClientCtor).not.toHaveBeenCalled();
    expect(plivoClientMock.messages.create).not.toHaveBeenCalled();
  });

  it('invokes client.messages.create when PLIVO_AUTH_ID/TOKEN/PHONE are set (prod mode)', async () => {
    envMock.PLIVO_AUTH_ID = 'auth-id';
    envMock.PLIVO_AUTH_TOKEN = 'auth-token';
    envMock.PLIVO_PHONE_NUMBER = '+571234567890';

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const { sendOtp } = await import('../src/lib/plivo');

    await sendOtp('+573001234567', '123456');

    expect(ClientCtor).toHaveBeenCalledWith('auth-id', 'auth-token');
    expect(plivoClientMock.messages.create).toHaveBeenCalledTimes(1);
    expect(plivoClientMock.messages.create).toHaveBeenCalledWith({
      src: '+571234567890',
      dst: '+573001234567',
      text: expect.stringContaining('123456'),
    });
  });
});
