import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const providerImport =
  /(?:from\s+|import\s*\()(['"])(?:openai|@anthropic-ai\/sdk|ollama|@google\/generative-ai|cohere-ai|groq-sdk|@mistralai\/mistralai)\1/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('provider SDK boundary', () => {
  it('keeps provider SDK imports inside packages/model-gateway', () => {
    const violations = sourceFiles(repositoryRoot)
      .filter((path) => !path.includes('/packages/model-gateway/'))
      .filter((path) => providerImport.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(`${repositoryRoot}/`, ''));

    expect(violations).toEqual([]);
  });

  it('keeps the native Keychain binding inside the privileged adapter', () => {
    const violations = sourceFiles(repositoryRoot)
      .filter((path) => path.includes('/src/'))
      .filter((path) => !path.endsWith('/apps/desktop/src/main/keyring-secret-store.ts'))
      .filter((path) => readFileSync(path, 'utf8').includes("'@napi-rs/keyring'"))
      .map((path) => path.replace(`${repositoryRoot}/`, ''));

    expect(violations).toEqual([]);
  });
});
