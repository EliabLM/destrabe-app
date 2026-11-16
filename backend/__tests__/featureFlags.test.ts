import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureFlag } from '@destrabe/shared';
import { parseEnv } from '../src/lib/env';
import { parseFeatureFlagsConfig } from '../src/lib/featureFlagsConfig';
import { checkFeatureFlags } from '../src/scripts/checkFeatureFlags';
import {
  configFlagStore,
  getEnabledFeatures,
  isFeatureEnabled,
  setFeatureFlagStore,
} from '../src/lib/featureFlags';

const ELIAB = { id: 'user-eliab', phone: '+573001234567' };
const OTRO = { id: 'user-otro', phone: '+573009999999' };

function useConfig(raw: string) {
  setFeatureFlagStore(configFlagStore(parseFeatureFlagsConfig(raw)));
}

afterEach(() => setFeatureFlagStore(configFlagStore({})));

describe('isFeatureEnabled', () => {
  it('off: apagado para todos', async () => {
    useConfig('{"pagoSimulado":"off"}');
    expect(await isFeatureEnabled('pagoSimulado', ELIAB)).toBe(false);
  });

  it('all: activo para todos', async () => {
    useConfig('{"pagoSimulado":{"mode":"all"}}');
    expect(await isFeatureEnabled('pagoSimulado', OTRO)).toBe(true);
  });

  it('allowlist por id de usuario', async () => {
    useConfig('{"pagoSimulado":{"mode":"allowlist","users":["user-eliab"]}}');
    expect(await isFeatureEnabled('pagoSimulado', ELIAB)).toBe(true);
    expect(await isFeatureEnabled('pagoSimulado', OTRO)).toBe(false);
  });

  it('allowlist por teléfono E.164', async () => {
    useConfig(
      '{"ubicacionGps":{"mode":"allowlist","users":["+573001234567"]}}',
    );
    expect(await isFeatureEnabled('ubicacionGps', ELIAB)).toBe(true);
    expect(await isFeatureEnabled('ubicacionGps', OTRO)).toBe(false);
  });

  it('allowlist sin usuario (sin sesión) queda apagado', async () => {
    useConfig('{"pagoSimulado":{"mode":"allowlist","users":["user-eliab"]}}');
    expect(await isFeatureEnabled('pagoSimulado', null)).toBe(false);
  });

  it('teléfono vacío no coincide con nada', async () => {
    useConfig('{"pagoSimulado":{"mode":"allowlist","users":["user-eliab"]}}');
    expect(await isFeatureEnabled('pagoSimulado', { id: 'x', phone: '' })).toBe(
      false,
    );
  });

  it('flag sin configurar: apagado', async () => {
    useConfig('{}');
    expect(await isFeatureEnabled('pagoSimulado', ELIAB)).toBe(false);
  });

  it('flag desconocido: apagado', async () => {
    useConfig('{"pagoSimulado":"all"}');
    expect(await isFeatureEnabled('noExiste' as FeatureFlag, ELIAB)).toBe(
      false,
    );
  });
});

describe('getEnabledFeatures', () => {
  it('lista solo los flags activos para el usuario', async () => {
    useConfig(
      '{"pagoSimulado":{"mode":"allowlist","users":["+573001234567"]},"ubicacionGps":"all"}',
    );
    expect(await getEnabledFeatures(ELIAB)).toEqual([
      'pagoSimulado',
      'ubicacionGps',
    ]);
    expect(await getEnabledFeatures(OTRO)).toEqual(['ubicacionGps']);
  });
});

describe('parseFeatureFlagsConfig', () => {
  it('vacío o ausente = sin flags', () => {
    expect(parseFeatureFlagsConfig(undefined)).toEqual({});
    expect(parseFeatureFlagsConfig('  ')).toEqual({});
  });

  it('normaliza la forma corta', () => {
    expect(parseFeatureFlagsConfig('{"pagoSimulado":"all"}')).toEqual({
      pagoSimulado: { mode: 'all', users: [] },
    });
  });

  it('ignora con aviso los flags que no están en el catálogo', () => {
    const warn = vi.fn();
    expect(parseFeatureFlagsConfig('{"viejo":"all"}', warn)).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"viejo"'));
  });

  it.each([
    ['JSON roto', '{pagoSimulado:', /FEATURE_FLAGS no es JSON válido/],
    ['modo inválido', '{"pagoSimulado":"on"}', /FEATURE_FLAGS inválida/],
    [
      'teléfono no E.164',
      '{"pagoSimulado":{"mode":"allowlist","users":["+57 300"]}}',
      /pagoSimulado\.users\.0: teléfono no está en formato E\.164/,
    ],
    [
      'clave desconocida en la regla',
      '{"pagoSimulado":{"mode":"allowlist","user":["x"]}}',
      /FEATURE_FLAGS inválida: pagoSimulado/,
    ],
    ['no es un objeto', '["pagoSimulado"]', /FEATURE_FLAGS inválida/],
    [
      'teléfono sin +',
      '{"pagoSimulado":{"mode":"allowlist","users":["573001234567"]}}',
      /pagoSimulado\.users\.0: parece un teléfono sin el \+/,
    ],
  ])('falla con mensaje claro: %s', (_name, raw, msg) => {
    expect(() => parseFeatureFlagsConfig(raw)).toThrow(msg);
  });
});

describe('FEATURE_FLAGS en parseEnv', () => {
  it('mal formada hace fallar el arranque', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'test', FEATURE_FLAGS: '{"pagoSimulado":"si"}' }),
    ).toThrow(/FEATURE_FLAGS inválida/);
  });

  it('bien formada queda parseada en env', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      FEATURE_FLAGS: '{"ubicacionGps":{"mode":"allowlist","users":["u1"]}}',
    });
    expect(env.FEATURE_FLAGS).toEqual({
      ubicacionGps: { mode: 'allowlist', users: ['u1'] },
    });
  });

  it('ausente = todo apagado', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).FEATURE_FLAGS).toEqual({});
  });
});

describe('checkFeatureFlags (validación antes de Coolify)', () => {
  it('acepta un JSON válido y devuelve la línea para pegar', () => {
    const out = vi.fn();
    expect(checkFeatureFlags('{ "pagoSimulado": "all" }', out)).toBe(true);
    expect(out).toHaveBeenCalledWith(
      expect.stringContaining('{"pagoSimulado":"all"}'),
    );
  });

  it('rechaza un JSON que haría fallar el arranque', () => {
    const out = vi.fn();
    expect(checkFeatureFlags('{"pagoSimulado":"on"}', out)).toBe(false);
    expect(out).toHaveBeenCalledWith(
      expect.stringContaining('FEATURE_FLAGS inválida'),
    );
  });

  it('sin argumento muestra el uso', () => {
    const out = vi.fn();
    expect(checkFeatureFlags(undefined, out)).toBe(false);
    expect(out).toHaveBeenCalledWith(expect.stringContaining('Uso:'));
  });
});
