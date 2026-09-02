# Accounts and usage

Status: in progress on `feat/usage-bar`.

## Goal

Show which installed CLI account is active and the usage information each
provider officially exposes, without extracting or copying private credentials.

## V1 scope

- Bottom status bar with Claude, Codex, and Grok 5-hour and weekly windows.
- Popover with compact/detailed density and a link to manage accounts.
- Isolated extra homes via `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `GROK_HOME`.
- Claude usage from statusLine JSON (opt-in hook on BuilderHelm-owned homes).
- Codex usage from `app-server` `account/rateLimits/read` on Refresh.
- Grok identity from the allowlisted `email` field only. Weekly % stays blank
  until a non-interactive stats command exists.

## Boundaries

- Do not scrape secrets, browser sessions, or consumer tokens.
- Do not copy `auth.json` or refresh tokens into SQLite or logs.
- Do not overwrite a user's existing Claude `statusLine` command.
- Do not claim usage data a provider does not expose.
- Account switching uses isolated config roots and never edits unknown
  credential files blindly.

## Acceptance

Every provider adapter declares supported capabilities, stale data is labelled,
and switching cannot leak one account's credentials to another workspace.
