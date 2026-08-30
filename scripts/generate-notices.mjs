/**
 * Collects the licence text of every dependency that ships inside the desktop
 * bundle and writes one attribution file.
 *
 * MIT, BSD, ISC, and Apache-2.0 all require the copyright and permission notice
 * to travel with binary distributions. Minified bundles do not carry them, so
 * the notice has to be reproduced as a separate document.
 *
 * The dependency list comes from `pnpm licenses list --prod --json`, so it is
 * the resolved production graph rather than a hand-maintained list that silently
 * drifts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'apps/desktop/out/THIRD_PARTY_NOTICES.txt');
const licenseFilePattern = /^(licence|license|copying|notice)([.-].*)?$/i;

/** Resolved production dependencies, grouped by licence, from the lockfile. */
function productionDependencies() {
  const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--long'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const grouped = JSON.parse(raw);
  const packages = [];
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      packages.push({
        name: entry.name,
        version: Array.isArray(entry.versions) ? entry.versions.join(', ') : '',
        license,
        author: typeof entry.author === 'string' ? entry.author : '',
        homepage: typeof entry.homepage === 'string' ? entry.homepage : '',
        paths: Array.isArray(entry.paths) ? entry.paths : [],
      });
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

/** The package's own licence text, which is the part we are obliged to carry. */
function readLicenseText(paths) {
  for (const directory of paths) {
    if (!directory || !existsSync(directory)) continue;
    const match = readdirSync(directory).find((entry) => licenseFilePattern.test(entry));
    if (match === undefined) continue;
    const text = readFileSync(join(directory, match), 'utf8').trim();
    if (text.length > 0) return text;
  }
  return null;
}

const packages = productionDependencies();
if (packages.length === 0) {
  throw new Error(
    'Resolved no production dependencies; refusing to write an empty notice.',
  );
}

const sections = [];
const missing = [];
for (const entry of packages) {
  const text = readLicenseText(entry.paths);
  if (text === null) missing.push(`${entry.name} (${entry.license})`);
  const heading = [
    `${entry.name}${entry.version.length > 0 ? ` ${entry.version}` : ''}`,
    `License: ${entry.license}`,
    entry.author.length > 0 ? `Author: ${entry.author}` : '',
    entry.homepage.length > 0 ? `Homepage: ${entry.homepage}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
  sections.push(
    `${'='.repeat(78)}\n${heading}\n${'='.repeat(78)}\n\n${
      text ??
      `No licence file was published with this package. Its declared licence is ${entry.license}.`
    }\n`,
  );
}

const header = `BuilderHelm — Third-Party Notices

BuilderHelm is proprietary software. It incorporates the open-source components
listed below, each of which remains subject to its own licence. Those licences
apply to the listed components only and grant no rights to BuilderHelm itself.

The Chromium, Node.js, and ffmpeg components of the Electron runtime are covered
by the separate LICENSES.chromium.html file distributed alongside this notice.

A machine-readable list of components is available on request.

Components: ${packages.length}
Generated from the resolved production dependency graph.
`;

const voiceAppendix = `
---

Voice runtime and optional on-device models

sherpa-onnx-node is a production dependency and is listed with the packages
above (Apache-2.0). Local speech models are not bundled; the user downloads
them in Settings → Voice. Those weights keep their upstream licences:

- Whisper Tiny (openai/whisper) — MIT
- Zipformer bilingual (k2-fsa / icefall) — Apache-2.0
- Parakeet TDT (NVIDIA) — NVIDIA Open Model License

Cloud transcription uses the OpenAI API under the user's own key. Local models
never send audio off-device.
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${header}\n${sections.join('\n')}${voiceAppendix}`, 'utf8');

process.stdout.write(
  `Wrote ${packages.length} component notices to ${output.replace(`${root}/`, '')}\n`,
);
if (missing.length > 0) {
  // Not fatal: the declared licence is still recorded above. Worth surfacing so
  // a package shipping no licence file gets noticed rather than silently thinned.
  process.stdout.write(`No licence file published by: ${missing.join(', ')}\n`);
}
