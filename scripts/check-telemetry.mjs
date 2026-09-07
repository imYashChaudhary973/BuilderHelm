/**
 * Fails when anything that reports usage off the machine enters the tree.
 *
 * The published Privacy Policy tells users, as a flat promise, that BuilderHelm
 * ships with no product analytics, no telemetry, and no crash reporting. That is
 * a statement of fact in a legal document, not an aspiration: the moment someone
 * runs `pnpm add @sentry/electron` the policy becomes false and we are
 * misrepresenting the product to every paying customer.
 *
 * A promise that depends on everyone remembering is not a promise. This check is
 * what keeps it true.
 *
 * Both dependency kinds are inspected. Production deps obviously ship, but so do
 * build-time plugins: a bundler plugin injects its client into the output even
 * though it sits in devDependencies.
 *
 * Adding one of these is a product and legal decision. If it is ever taken
 * deliberately, update the Privacy Policy in the same change, then add the
 * package here with a note - do not delete the check.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Whole scopes whose purpose is shipping observations to a vendor. */
const forbiddenScopes = new Map([
  ['@sentry', 'error and performance reporting'],
  ['@bugsnag', 'crash reporting'],
  ['@amplitude', 'product analytics'],
  ['@segment', 'analytics pipeline'],
  ['@datadog', 'RUM and APM'],
  ['@newrelic', 'APM'],
  ['@highlight-run', 'session replay'],
  ['@openreplay', 'session replay'],
]);

/** Exact packages. Scope-less or shipped alongside a permitted scope. */
const forbiddenPackages = new Map([
  ['posthog-js', 'product analytics'],
  ['posthog-node', 'product analytics'],
  ['mixpanel', 'product analytics'],
  ['mixpanel-browser', 'product analytics'],
  ['amplitude-js', 'product analytics'],
  ['analytics-node', 'analytics pipeline'],
  ['newrelic', 'APM'],
  ['dd-trace', 'APM'],
  ['rollbar', 'error reporting'],
  ['bugsnag', 'crash reporting'],
  ['logrocket', 'session replay'],
  ['logrocket-react', 'session replay'],
  ['fullstory', 'session replay'],
  ['@fullstory/browser', 'session replay'],
  ['react-ga', 'Google Analytics'],
  ['react-ga4', 'Google Analytics'],
  ['ga-gtag', 'Google Analytics'],
  ['@vercel/analytics', 'product analytics'],
  ['@vercel/speed-insights', 'field telemetry'],
  ['@microsoft/applicationinsights-web', 'application telemetry'],
  ['applicationinsights', 'application telemetry'],
  ['electron-log-uploader', 'log shipping'],
  ['@aptabase/electron', 'product analytics'],
  ['aptabase', 'product analytics'],
  ['countly-sdk-web', 'product analytics'],
  ['countly-sdk-nodejs', 'product analytics'],
  ['heap-api', 'product analytics'],
  ['@openpanel/web', 'product analytics'],
]);

/**
 * Electron and Chromium ship their own reporters. They need no dependency, so
 * the dependency scan alone would miss them.
 */
const forbiddenSource = [
  { pattern: /\bcrashReporter\b/, reason: "Electron's crash reporter uploads minidumps" },
  {
    pattern: /setUsageStatsEnabled\s*\(\s*true\s*\)/,
    reason: 'enables Chromium usage-stats reporting',
  },
  { pattern: /--enable-crash-reporter\b/, reason: "enables Electron's crash reporter" },
  { pattern: /\bmetricsRecordingOnly\b/, reason: 'Chromium metrics recording' },
];

/** Ingest endpoints, in case a client is hand-rolled rather than installed. */
const forbiddenHosts = [
  'sentry.io',
  'i.posthog.com',
  'app.posthog.com',
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'api.mixpanel.com',
  'api.amplitude.com',
  'api.segment.io',
  'browser-intake-datadoghq.com',
  'notify.bugsnag.com',
  'api.rollbar.com',
  'r.logrocket.io',
  'static.hotjar.com',
  'edge.fullstory.com',
  'cdn.heapanalytics.com',
];

function packageJsonPaths(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === 'out' ||
      entry === 'dist' ||
      entry.startsWith('.')
    ) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      packageJsonPaths(path, found);
    } else if (entry === 'package.json') {
      found.push(path);
    }
  }
  return found;
}

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === 'out' ||
      entry === 'dist' ||
      entry.startsWith('.')
    ) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.(ts|tsx|js|mjs|cjs|html)$/.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(path);
    }
  }
  return found;
}

const failures = [];
let manifests = 0;
let files = 0;

for (const path of packageJsonPaths(root)) {
  manifests += 1;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const name of Object.keys(declared)) {
    const reason = forbiddenPackages.get(name) ?? forbiddenScopes.get(name.split('/')[0]);
    if (reason !== undefined) {
      failures.push(`${relative(root, path)}: depends on ${name} (${reason})`);
    }
  }
}

// This file names the very things it forbids, so exclude it from its own scan.
const self = resolve(root, 'scripts/check-telemetry.mjs');

for (const path of [
  resolve(root, 'apps'),
  resolve(root, 'packages'),
  resolve(root, 'scripts'),
]) {
  for (const file of sourceFiles(path)) {
    if (file === self) continue;
    files += 1;
    const source = readFileSync(file, 'utf8');
    for (const { pattern, reason } of forbiddenSource) {
      if (pattern.test(source)) {
        failures.push(`${relative(root, file)}: ${String(pattern)} - ${reason}`);
      }
    }
    for (const host of forbiddenHosts) {
      if (source.includes(host)) {
        failures.push(`${relative(root, file)}: references ${host}`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    'BuilderHelm promises no analytics, telemetry, or crash reporting.\n' +
      'The published Privacy Policy states this as fact. These break it:\n' +
      `${failures.map((line) => `  ${line}`).join('\n')}\n` +
      'If this is deliberate, amend the Privacy Policy in the same change,\n' +
      'then allow it in scripts/check-telemetry.mjs with a note.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `No analytics, telemetry, or crash reporting: ${manifests} manifests and ${files} files clean.\n`,
  );
}
