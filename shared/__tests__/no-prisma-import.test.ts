import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listTsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('shared is agnostic of prisma (REQ-008)', () => {
  it('no source file imports @prisma/client or prisma', () => {
    const files = listTsFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(
        content,
        `${file} should not import @prisma/client or prisma`,
      ).not.toMatch(/from\s+['"](@prisma\/client|prisma)['"]/);
    }
  });
});
