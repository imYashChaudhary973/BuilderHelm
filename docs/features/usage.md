# Usage kinds

Four numbers, never mixed:

| Kind                     | Meaning                                     | When unknown                       |
| ------------------------ | ------------------------------------------- | ---------------------------------- |
| Reported tokens          | What the runtime said it used on a run      | Stay blank (`—` / "Not reported")  |
| Subscription quota       | Session/weekly windows on Usage             | Null windows, no fake 0%           |
| Actual API charges       | Provider invoice / billed USD               | Stay unknown — we do not invent it |
| Estimated API-equivalent | Hypothetical API cost of a subscription run | Stay unknown                       |

The Usage page shows **subscription quota only**. Chat shows reported tokens
when the agent emits `usage.updated`. Swarm shows tokens/cost only when the
adapter parsed a positive report — never a coerced `$0.00`.

## OAuth-token quota reader (assessed)

`packages/core/src/accounts/claude-oauth-usage.ts` reads
`claudeAiOauth.accessToken` from `.credentials.json` in memory and GETs
Anthropic's OAuth usage endpoint. It never logs or persists the token, never
copies it into BuilderHelm storage, and never rotates accounts to dodge
quota. The snapshot labels that source `oauth`. Prefer the in-session
statusLine (`source: statusline`) when it has fired. Do not add more
token-reading quota scrapers.

Codex quota uses `codex app-server --stdio` `account/rateLimits/read` — no
auth.json read. Grok quota reads the CLI billing log, not a token.

No automatic paid fallback when a subscription is exhausted (the silent
cross-runtime planner fallback was removed in 2.2).
