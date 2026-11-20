import { Writable } from 'node:stream';
import { createLogger } from '../../src/lib/logger';

/** Logger real (mismas reglas de redacción) que escribe en memoria. */
export function captureLogs() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...String(chunk).split('\n').filter(Boolean));
      done();
    },
  });
  const logger = createLogger({ level: 'debug', destination });
  return {
    logger,
    text: () => lines.join('\n'),
    entries: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
