import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorProfileSchema,
  createServiceSchema,
  httpsUrlSchema,
  nearbyServicesQuerySchema,
  updateLocationSchema,
} from '../src';

// DCC-03: límites de entrada en coordenadas, textos, URL y radio de búsqueda.

const validService = {
  type: 'BREAKDOWN',
  originLat: 4.65,
  originLng: -74.1,
};

const outOfRangeLat = [90.0001, -90.0001, 1000, Infinity, -Infinity, NaN];
const outOfRangeLng = [180.0001, -180.0001, 1000, Infinity, -Infinity, NaN];

describe('createServiceSchema — coordenadas', () => {
  it('acepta los extremos válidos', () => {
    for (const [lat, lng] of [
      [90, 180],
      [-90, -180],
      [0, 0],
    ]) {
      const input = {
        ...validService,
        originLat: lat,
        originLng: lng,
        destLat: lat,
        destLng: lng,
      };
      expect(createServiceSchema.safeParse(input).success).toBe(true);
    }
  });

  it.each(outOfRangeLat)('rechaza originLat y destLat = %s', (lat) => {
    expect(
      createServiceSchema.safeParse({ ...validService, originLat: lat })
        .success,
    ).toBe(false);
    expect(
      createServiceSchema.safeParse({
        ...validService,
        destLat: lat,
        destLng: 0,
      }).success,
    ).toBe(false);
  });

  it.each(outOfRangeLng)('rechaza originLng y destLng = %s', (lng) => {
    expect(
      createServiceSchema.safeParse({ ...validService, originLng: lng })
        .success,
    ).toBe(false);
    expect(
      createServiceSchema.safeParse({
        ...validService,
        destLat: 0,
        destLng: lng,
      }).success,
    ).toBe(false);
  });
});

describe('createServiceSchema — textos y URL', () => {
  it('description admite 500 caracteres y rechaza 501', () => {
    expect(
      createServiceSchema.safeParse({
        ...validService,
        description: 'a'.repeat(500),
      }).success,
    ).toBe(true);
    expect(
      createServiceSchema.safeParse({
        ...validService,
        description: 'a'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('photoUrl acepta el esquema https en mayúsculas', () => {
    for (const photoUrl of [
      'HTTPS://cdn.example.com/f.jpg',
      'Https://cdn.example.com/f.jpg',
    ]) {
      expect(
        createServiceSchema.safeParse({ ...validService, photoUrl }).success,
      ).toBe(true);
    }
  });

  it('photoUrl exige https y como máximo 2048 caracteres', () => {
    const ok = 'https://cdn.example.com/f.jpg';
    expect(
      createServiceSchema.safeParse({ ...validService, photoUrl: ok }).success,
    ).toBe(true);
    for (const photoUrl of [
      'http://cdn.example.com/f.jpg',
      'javascript:alert(1)',
      'ftp://cdn.example.com/f.jpg',
      'no es una url',
      `https://cdn.example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(
        createServiceSchema.safeParse({ ...validService, photoUrl }).success,
      ).toBe(false);
    }
  });
});

describe('nearbyServicesQuerySchema', () => {
  it('radiusKm es opcional (el backend aplica NEARBY_RADIUS_KM)', () => {
    const parsed = nearbyServicesQuerySchema.parse({
      lat: '4.65',
      lng: '-74.1',
    });
    expect(parsed).toEqual({ lat: 4.65, lng: -74.1 });
  });

  it('acepta radiusKm entre 1 y 25', () => {
    for (const radiusKm of ['1', '15', '25']) {
      expect(
        nearbyServicesQuerySchema.safeParse({ lat: '0', lng: '0', radiusKm })
          .success,
      ).toBe(true);
    }
  });

  it('rechaza radiusKm fuera de rango o no finito', () => {
    for (const radiusKm of [
      '0',
      '0.5',
      '-1',
      '25.1',
      '20000',
      'NaN',
      'Infinity',
      'abc',
      '',
    ]) {
      expect(
        nearbyServicesQuerySchema.safeParse({ lat: '0', lng: '0', radiusKm })
          .success,
      ).toBe(false);
    }
  });

  it('rechaza lat/lng fuera de rango o no finitos', () => {
    for (const q of [
      { lat: '1000', lng: '0' },
      { lat: '-90.5', lng: '0' },
      { lat: '0', lng: '181' },
      { lat: 'Infinity', lng: '0' },
      { lat: '0', lng: '-Infinity' },
      { lat: 'NaN', lng: '0' },
      { lat: '', lng: '0' },
      { lat: '0', lng: '' },
      { lat: '   ', lng: '0' },
      { lng: '0' },
    ]) {
      expect(nearbyServicesQuerySchema.safeParse(q).success).toBe(false);
    }
  });
});

describe('esquemas de operador', () => {
  const profile = { truckType: 'grúa', licensePlate: 'ABC123' };

  it('createOperatorProfileSchema valida coordenadas, textos y photoUrl', () => {
    expect(createOperatorProfileSchema.safeParse(profile).success).toBe(true);
    for (const extra of [
      { lastLatitude: 91 },
      { lastLongitude: -181 },
      { lastLatitude: Infinity },
      { lastLongitude: NaN },
      { photoUrl: 'http://cdn.example.com/f.jpg' },
      { truckType: 'a'.repeat(61) },
      { licensePlate: 'a'.repeat(21) },
    ]) {
      expect(
        createOperatorProfileSchema.safeParse({ ...profile, ...extra }).success,
      ).toBe(false);
    }
  });

  it('updateLocationSchema rechaza coordenadas fuera de rango', () => {
    expect(
      updateLocationSchema.safeParse({ lastLatitude: 4.6, lastLongitude: -74 })
        .success,
    ).toBe(true);
    for (const loc of [
      { lastLatitude: 1000, lastLongitude: 0 },
      { lastLatitude: 0, lastLongitude: 1000 },
      { lastLatitude: -Infinity, lastLongitude: 0 },
      { lastLatitude: 0, lastLongitude: NaN },
    ]) {
      expect(updateLocationSchema.safeParse(loc).success).toBe(false);
    }
  });
});

describe('httpsUrlSchema sin `URL` funcional (React Native 0.74)', () => {
  it('valida photoUrl aunque `new URL()` lance', () => {
    vi.stubGlobal(
      'URL',
      class {
        constructor() {
          throw new Error('URL.protocol is not implemented');
        }
      },
    );
    try {
      for (const photoUrl of [
        'https://cdn.example.com/f.jpg',
        'HTTPS://cdn.example.com/f.jpg',
      ]) {
        expect(httpsUrlSchema.safeParse(photoUrl).success).toBe(true);
        expect(
          createServiceSchema.safeParse({ ...validService, photoUrl }).success,
        ).toBe(true);
        expect(
          createOperatorProfileSchema.safeParse({
            truckType: 'grúa',
            licensePlate: 'ABC123',
            photoUrl,
          }).success,
        ).toBe(true);
      }
      for (const photoUrl of [
        'http://cdn.example.com/f.jpg',
        'https://',
        'https:// espacio.com',
        'https://cdn.example.com/a b.jpg',
        'xhttps://cdn.example.com',
      ]) {
        expect(httpsUrlSchema.safeParse(photoUrl).success).toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
