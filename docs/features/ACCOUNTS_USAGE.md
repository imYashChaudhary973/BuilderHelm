# Accounts and usage

Status: shipped in v1 (Claude statusLine, Codex app-server, Grok empty-until-run).

## Goal

Show which installed CLI account is active and the usage information each
provider officially exposes, without extracting or copying private credentials.

## V1 scope

- Display installed/authenticated/unsupported state per CLI.
- Show provider-reported usage, limits, reset time, and rate-limit events when available.
- Let users choose among provider-supported profiles or isolated CLI config roots.
- Route a new run to an eligible account based on explicit user policy.

## Boundaries

- Do not scrape secrets, browser sessions, or consumer tokens.
- Do not claim usage data a provider does not expose.
- Account switching uses the provider's supported mechanism and never edits unknown credential files blindly.
- Usage and billing figures name their source and timestamp.

## Acceptance

Every provider adapter declares supported capabilities, stale data is labelled,
and switching cannot leak one account's credentials to another workspace.
