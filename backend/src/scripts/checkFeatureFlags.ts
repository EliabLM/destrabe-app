import { parseFeatureFlagsConfig } from '../lib/featureFlagsConfig';

/**
 * Valida un valor de `FEATURE_FLAGS` antes de pegarlo en Coolify (issue #13).
 *
 *   npm run flags:check -w @destrabe/backend -- '{"pagoSimulado":"all"}'
 *
 * Usa el mismo parser que el arranque del backend. Sale con código 1 si el
 * JSON haría fallar el arranque.
 */
export function checkFeatureFlags(
  raw: string | undefined,
  out: (msg: string) => void = console.log,
  warn: (msg: string) => void = console.warn,
): boolean {
  if (raw === undefined || raw.trim() === '') {
    out("Uso: npm run flags:check -w @destrabe/backend -- '<json>'");
    return false;
  }
  try {
    const config = parseFeatureFlagsConfig(raw, warn);
    out(
      `OK. Configuración que verá el backend:\n${JSON.stringify(config, null, 2)}`,
    );
    out(`Valor en una línea para Coolify:\n${JSON.stringify(JSON.parse(raw))}`);
    return true;
  } catch (err) {
    out((err as Error).message);
    return false;
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  process.exitCode = checkFeatureFlags(process.argv[2]) ? 0 : 1;
}
