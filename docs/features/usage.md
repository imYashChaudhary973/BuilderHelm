# Usage kinds

Four numbers, never mixed:

| Kind                     | Meaning                                     | When unknown                       |
| ------------------------ | ------------------------------------------- | ---------------------------------- |
| Reported tokens          | What the runtime said it used on a run      | Stay blank (`—` / "Not reported")  |
| Subscription quota       | Session/weekly windows on Usage             | Null windows, no fake 0%           |
| Actual API charges       | Provider invoice / billed USD               | Stay unknown — we do not invent it |
| Estimated API-equivalent | Hypothetical API cost of a subscription run | Stay unknown                       |

The Usage page shows **subscription quota only**, per login. Each login's
windows are stored under its account ref (`claude:<id>`), and each provider
shows a pooled card per window: the mean of what each reporting login has
left, the share of the pool the soonest reset returns, and one segment per
login. A login that has not reported shows "No data" and is left out of the
pool, never counted as full. A window whose reset time has passed reads as
fresh (0% used, reset unknown) until the login reports again.

Chat shows reported tokens when the agent emits `usage.updated`. Swarm shows
tokens/cost only when the adapter parsed a positive report — never a coerced
`$0.00`.

## Sources

- **Claude:** the statusLine hook only. Each installed command carries its
  login's ref (`"<script>" claude:<id>`), so a report lands on that login.
  It fires only while an interactive Claude Code session runs in that
  login, so an idle login keeps its last figures. BuilderHelm does not read
  Claude's OAuth token: on macOS it lives in the Keychain, and the former
  reader fell back to `~/.claude`'s token, which attributed one account's
  limits to another.
- **Codex:** `codex app-server --stdio` `account/rateLimits/read`, run once
  per signed-in login with that login's `CODEX_HOME` on Refresh. No
  `auth.json` read.
- **Grok:** each login's CLI billing log, not a token.

No automatic paid fallback when a subscription is exhausted (the silent
cross-runtime planner fallback was removed in 2.2).
