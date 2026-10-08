# Accounts and usage

## Goal

Run the coding CLIs already installed on the host under whichever of the
person's own logins they choose, and show the usage each provider officially
exposes. BuilderHelm never signs in to a vendor itself and never copies
credentials.

## Providers and logins

Settings → Usage lists Claude, Codex, Grok, and OpenCode. Each login is a
home folder the CLI is pointed at through its own variable:

| Provider | Variable            | Multiple logins |
| -------- | ------------------- | --------------- |
| Claude   | `CLAUDE_CONFIG_DIR` | yes             |
| Codex    | `CODEX_HOME`        | yes             |
| Grok     | `GROK_HOME`         | yes             |
| OpenCode | none                | no (see below)  |

A home is one of three kinds:

- **system**: the CLI's default folder (`~/.claude`, `~/.codex`, ...).
- **managed**: created by **Add login**, under BuilderHelm's data folder. The
  login runs in Terminal.app with the CLI's own command; the folder is deleted
  when the login is removed or never completes.
- **attached**: a folder the person already signed in with, such as
  `~/.claude-work`, chosen with **Attach folder**. Main opens the picker, so
  the renderer never names a path. The folder must already hold a login and
  may not be the home folder, a parent of it, the system folder, or inside
  BuilderHelm's data folder. Removing it only forgets it; it is never deleted.

Any non-system login can be renamed. A chosen name is kept; generic names
(`Claude 2`) are replaced by the login email once it appears.

The active login per provider applies to terminals and to runs that select
nothing. An agent profile can pin a login (`accountRef`, e.g. `claude:<id>`)
from its **Login** field; a pinned login that was removed falls back to the
active one. Running processes keep the environment they started with.

OpenCode signs in to many model providers itself (`opencode auth login`) and
has no single folder variable to isolate, so it has only the system login and
no subscription windows.

## Limits

- Claude: the statusLine hook. BuilderHelm installs it in managed homes; in
  `~/.claude` and attached folders only after the person opts in. It stashes
  any existing statusLine and restores it on opt-out or removal, and never
  touches a statusLine it did not write.
- Codex: `codex app-server` `account/rateLimits/read` on Refresh.
- Grok: the CLI's own billing log.

See [usage.md](usage.md) for which numbers are shown and which stay unknown.

## Boundaries

- Do not scrape secrets, browser sessions, or consumer tokens.
- Do not copy `auth.json` or refresh tokens into SQLite or logs; read only
  allowlisted identity fields such as the email.
- Name conflicting credential paths without reading their contents.
- Do not claim usage data a provider does not expose.
