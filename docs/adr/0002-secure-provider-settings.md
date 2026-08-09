# ADR 0002: Secure provider settings boundary

- Status: Accepted
- Date: 2026-08-09

## Context

Phase 1 needs provider configuration CRUD while guaranteeing that credential
values never enter SQLite, logs, screenshots, renderer state, or provider read
responses. The application is currently macOS-first and must fail closed if
secure storage is unavailable.

## Decision

1. Store provider metadata in SQLite and credential values in macOS Keychain.
   SQLite contains only a generated opaque reference and Keychain service name.
2. Access Keychain through `@napi-rs/keyring` from one privileged main-process
   adapter. There is no file, environment-variable, or in-memory production
   fallback.
3. Make the core depend on the narrow `SecretStore` interface. Automated tests
   inject `MemorySecretStore`; the desktop entry point injects the Keychain
   adapter.
4. Write the Keychain value before committing provider metadata. If SQLite
   fails, remove or restore the Keychain value. Delete follows the inverse
   operation and restores the credential if the metadata transaction fails.
5. Return a safe provider summary with `hasCredential: true`. Never return the
   opaque Keychain reference or credential value to the renderer.
6. Keep all provider IPC inputs strict and schema-validated. Sensitive header
   names cannot use static values and must reference secure storage.
7. Record provider creates, updates, and deletes in append-only audit rows with
   a correlation ID. Audit snapshots contain only renderer-safe summaries.

## Consequences

- Provider configuration fails rather than silently downgrading when Keychain
  is unavailable.
- Credential updates can be rolled back without exposing values outside the
  core process.
- A renderer compromise can request only fixed provider operations and cannot
  enumerate stored credential references or retrieve secret values.
- Packaging must include the platform-specific native Keychain binding.
- Provider connection tests and real model calls remain Phase 2 work.
