import { describe, expect, it } from 'vitest';
import {
  createOperatorProfileSchema,
  createServiceSchema,
} from '@destrabe/shared';
import {
  apiErrorMessage,
  validationMessage,
} from '../../app/src/lib/inputErrors';

describe('app — validación con los esquemas compartidos', () => {
  const service = { type: 'BREAKDOWN', originLat: 4.65, originLng: -74.1 };

  it('null si el payload es válido', () => {
    expect(validationMessage(createServiceSchema, service)).toBeNull();
  });

  it('explica en español la photoUrl http y la latitud fuera de rango', () => {
    const msg = validationMessage(createServiceSchema, {
      ...service,
      originLat: 1000,
      photoUrl: 'http://cdn.example.com/f.jpg',
    });
    expect(msg).toContain('https://');
    expect(msg).toContain('Latitud de origen');
  });

  it('cubre el perfil de operador', () => {
    const msg = validationMessage(createOperatorProfileSchema, {
      truckType: 'grúa',
      licensePlate: 'ABC123',
      lastLatitude: NaN,
    });
    expect(msg).toContain('Latitud');
  });

  it('apiErrorMessage lee `error` del backend', () => {
    expect(
      apiErrorMessage(
        { response: { data: { error: 'Validation failed' } } },
        'x',
      ),
    ).toBe('Validation failed');
    expect(apiErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
