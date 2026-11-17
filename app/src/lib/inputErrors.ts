/** Lo mínimo de un esquema zod (v3 o v4) que usa este módulo. */
interface SafeParseSchema {
  safeParse(value: unknown):
    | { success: true }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }> };
      };
}

/** Etiquetas en español de los campos que validan los esquemas compartidos. */
const FIELD_LABELS: Record<string, string> = {
  originLat: 'Latitud de origen (entre -90 y 90)',
  originLng: 'Longitud de origen (entre -180 y 180)',
  destLat: 'Latitud de destino (entre -90 y 90)',
  destLng: 'Longitud de destino (entre -180 y 180)',
  lastLatitude: 'Latitud (entre -90 y 90)',
  lastLongitude: 'Longitud (entre -180 y 180)',
  description: 'Descripción (máximo 500 caracteres)',
  photoUrl: 'Foto: la URL debe empezar por https://',
  truckType: 'Tipo de vehículo (máximo 60 caracteres)',
  licensePlate: 'Placa (máximo 20 caracteres)',
};

/**
 * Valida `payload` con el esquema compartido que aplica el backend y devuelve
 * un mensaje en español con los campos inválidos, o `null` si es válido.
 */
export function validationMessage(
  schema: SafeParseSchema,
  payload: unknown,
): string | null {
  const result = schema.safeParse(payload);
  if (result.success) return null;
  const fields = [
    ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
  ];
  return `Revisa estos campos:\n${fields
    .map((field) => `• ${FIELD_LABELS[field] ?? field}`)
    .join('\n')}`;
}

/** Mensaje legible de un error de la API (`{ error, code }` o `message`). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const error = err as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    error?.message ??
    fallback
  );
}
