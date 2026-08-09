import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packagesRoot = resolve(import.meta.dirname, '../../packages');
const allowedDependencies: Readonly<Record<string, readonly string[]>> = {
  shared: [],
  protocol: ['shared'],
  db: ['shared'],
  observability: ['shared'],
  'model-gateway': ['protocol', 'shared'],
  core: ['db', 'observability', 'protocol', 'shared'],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('foundation package boundaries', () => {
  it('allows only declared downward @zero dependencies', () => {
    const violations: string[] = [];

    for (const [packageName, allowed] of Object.entries(allowedDependencies)) {
      const sourceRoot = resolve(packagesRoot, packageName, 'src');
      for (const path of sourceFiles(sourceRoot)) {
        const imports = [
          ...readFileSync(path, 'utf8').matchAll(/from ['"]@zero\/([^'"]+)['"]/g),
        ];
        for (const match of imports) {
          const dependency = match[1];
          if (dependency !== undefined && !allowed.includes(dependency)) {
            violations.push(`${packageName} -> ${dependency}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
