import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({ value: null as string | null }));
const getMyFeaturesMock = vi.hoisted(() => vi.fn());

vi.mock('../../app/src/lib/secureStorage', () => ({
  secureStorage: {
    getFeatures: async () => cache.value,
    setFeatures: async (v: string) => {
      cache.value = v;
    },
  },
}));
vi.mock('../../app/src/lib/apiFeatures', () => ({
  getMyFeatures: getMyFeaturesMock,
}));

import { featuresStore } from '../../app/src/stores/featuresStore';

beforeEach(() => {
  cache.value = null;
  getMyFeaturesMock.mockReset();
  featuresStore.getState().reset();
});

describe('featuresStore (app)', () => {
  it('carga los flags del backend y los guarda por usuario', async () => {
    getMyFeaturesMock.mockResolvedValue(['pagoSimulado']);
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual(['pagoSimulado']);
    expect(JSON.parse(cache.value!)).toEqual({
      userId: 'u1',
      features: ['pagoSimulado'],
    });
  });

  it('sin red usa los últimos valores conocidos del mismo usuario', async () => {
    cache.value = JSON.stringify({ userId: 'u1', features: ['ubicacionGps'] });
    getMyFeaturesMock.mockRejectedValue(new Error('Network Error'));
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual(['ubicacionGps']);
  });

  it('sin red y sin caché: todo apagado', async () => {
    getMyFeaturesMock.mockRejectedValue(new Error('Network Error'));
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual([]);
  });

  it('no reutiliza la caché de otro usuario ni flags desconocidos', async () => {
    cache.value = JSON.stringify({ userId: 'u2', features: ['pagoSimulado'] });
    getMyFeaturesMock.mockRejectedValue(new Error('Network Error'));
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual([]);

    cache.value = JSON.stringify({ userId: 'u1', features: ['viejo'] });
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual([]);
  });

  it('caché corrupta: todo apagado', async () => {
    cache.value = '{no-json';
    getMyFeaturesMock.mockRejectedValue(new Error('Network Error'));
    await featuresStore.getState().load('u1');
    expect(featuresStore.getState().features).toEqual([]);
  });

  it('una respuesta tardía no pisa el estado tras cerrar sesión', async () => {
    let resolve!: (v: string[]) => void;
    getMyFeaturesMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const pending = featuresStore.getState().load('u1');
    await Promise.resolve();
    featuresStore.getState().reset();
    resolve(['pagoSimulado']);
    await pending;
    expect(featuresStore.getState().features).toEqual([]);
  });
});
