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
  tools: ['protocol', 'shared'],
  core: ['db', 'model-gateway', 'observability', 'protocol', 'shared', 'tools'],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('foundation package boundaries', () => {
  it('allows only declared downward @builderhelm dependencies', () => {
    const violations: string[] = [];

    for (const [packageName, allowed] of Object.entries(allowedDependencies)) {
      const sourceRoot = resolve(packagesRoot, packageName, 'src');
      for (const path of sourceFiles(sourceRoot)) {
        const imports = [
          ...readFileSync(path, 'utf8').matchAll(/from ['"]@builderhelm\/([^'"]+)['"]/g),
        ];
        for (const match of imports) {
          const dependency = match[1];
          const dependencyPackage = dependency?.split('/')[0];
          if (dependencyPackage !== undefined && !allowed.includes(dependencyPackage)) {
            violations.push(`${packageName} -> ${dependency}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
