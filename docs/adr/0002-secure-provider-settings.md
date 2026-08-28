# ADR 0002: Secure provider settings boundary

- Status: Accepted
- Date: 2026-08-09
- Reaffirmed: 2026-08-28 under the BuilderHelm package and Keychain names.

## Context

Provider configuration needs create, read, update, and delete while
guaranteeing that credential values never enter SQLite, logs, screenshots,
renderer state, or provider read responses. The application is macOS-first and
must fail closed if secure storage is unavailable.

## Decision

1. Store provider metadata in SQLite and credential values in the operating
   system keychain. SQLite contains only a generated opaque reference and the
   keychain service name.
2. Access the keychain through `@napi-rs/keyring` from one privileged
   main-process adapter. There is no file, environment-variable, or in-memory
   production fallback.
3. Make the core depend on the narrow `SecretStore` interface. Automated tests
   inject `MemorySecretStore`; the desktop entry point injects the keychain
   adapter.
4. Write the keychain value before committing provider metadata. If SQLite
   fails, remove or restore the keychain value. Delete follows the inverse
   operation and restores the credential if the metadata transaction fails.
5. Return a safe provider summary with `hasCredential: true`. Never return the
   opaque keychain reference or credential value to the renderer.
6. Keep all provider IPC inputs strict and schema-validated. Sensitive header
   names cannot use static values and must reference secure storage.
7. Record provider creates, updates, and deletes in append-only audit rows with
   a correlation ID. Audit snapshots contain only renderer-safe summaries.

## Consequences

- Provider configuration fails rather than silently downgrading when the
  keychain is unavailable.
- Credential updates can be rolled back without exposing values outside the
  core process.
- A renderer compromise can request only fixed provider operations and cannot
  enumerate stored credential references or retrieve secret values.
- Packaging must include the platform-specific native keychain binding.
- Windows and Linux credential storage remain unverified; see
  [ROADMAP](../ROADMAP.md) P6.

## Current implementation

- Service name: `app.builderhelm.credentials`.
- Secret reference format: `builderhelm.provider.<uuid>.api-key`.
- Enforced by `tests/security/secret-persistence.test.ts` and
  `tests/architecture/provider-boundary.test.ts`.
