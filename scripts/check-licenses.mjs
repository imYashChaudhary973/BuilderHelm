/**
 * Fails when a shipped dependency carries a licence BuilderHelm cannot honour.
 *
 * BuilderHelm is proprietary and sold as a subscription, so reciprocal licences
 * are the real risk: GPL and AGPL would require releasing our source, and SSPL
 * and the source-available licences restrict commercial use. Today's dependency
 * graph is entirely permissive, and this check is what keeps it that way rather
 * than relying on someone remembering at `pnpm add` time.
 *
 * Only production dependencies are inspected. Build and test tooling is never
 * distributed, so its licence terms do not reach our users.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Permissive: attribution only, no obligation to release our own source.
const allowed = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

// Reciprocal or commercially restricted. Adding one of these is a product
// decision, not a dependency bump, so the check names the reason it stopped.
const forbidden = new Map([
  ['AGPL', 'network copyleft: would require publishing BuilderHelm source'],
  ['GPL', 'copyleft: would require publishing BuilderHelm source'],
  ['SSPL', 'source-available: restricts offering the software as a service'],
  ['BUSL', 'business source: restricts commercial use before the change date'],
  ['CC-BY-NC', 'non-commercial: incompatible with a paid product'],
  ['CC-BY-SA', 'share-alike: reciprocal obligations on derived work'],
  ['Elastic', 'source-available: restricts managed-service use'],
  ['CPAL', 'network copyleft with attribution requirements'],
  ['OSL', 'network copyleft'],
  ['EUPL', 'copyleft'],
]);

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--long'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const failures = [];
const review = [];
let inspected = 0;

for (const [license, entries] of Object.entries(JSON.parse(raw))) {
  for (const entry of entries) {
    inspected += 1;
    const name = `${entry.name}@${(entry.versions ?? []).join(',')}`;
    // LGPL first: "LGPL" contains "GPL", so the generic match below would
    // otherwise claim the wrong reason. LGPL is satisfiable by dynamic linking,
    // which is how ffmpeg arrives inside the Electron runtime, but an npm
    // package gets bundled into our JavaScript and cannot be relinked.
    if (license.includes('LGPL')) {
      failures.push(
        `${name}: ${license} — LGPL is only acceptable as a separately linked library, not as bundled JavaScript`,
      );
      continue;
    }
    const hit = [...forbidden.entries()].find(([token]) => license.includes(token));
    if (hit !== undefined) {
      failures.push(`${name}: ${license} — ${hit[1]}`);
      continue;
    }
    // Split expressions such as "(MIT OR Apache-2.0)" and accept if any term is.
    const terms = license
      .replace(/[()]/g, '')
      .split(/\s+(?:OR|AND)\s+/i)
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    if (terms.some((term) => allowed.has(term))) continue;
    review.push(`${name}: ${license}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Dependencies BuilderHelm cannot ship:\n${failures.map((line) => `  ${line}`).join('\n')}\n`,
  );
  process.exitCode = 1;
} else if (review.length > 0) {
  process.stderr.write(
    `Unrecognised licences needing review before release:\n${review
      .map((line) => `  ${line}`)
      .join('\n')}\n` +
      'Add the licence to the allowlist in scripts/check-licenses.mjs once cleared.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Licence check passed: ${inspected} shipped dependencies, all permissive.\n`,
  );
}
