# Account login — implementation plan

Status: IN PROGRESS — schema and licence function are live; website and desktop
authored on `feat/auth`. Live Google/Apple sign-in still needs you.
Branches: `feat/auth` at `BuilderHelm-worktrees/auth` (app) · `feat/auth` in
`~/Developer/BuilderHelm Webpage` (site).

## Data boundary — the rule this feature must not break

BuilderHelm has no centralised application database and this feature does not
introduce one. Three planes, and they never mix:

| Plane          | Where                                                                                     | Holds                                                                                | Added by this work                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Device**     | the user's machine — local SQLite + macOS Keychain                                        | chats, agent memory, settings, provider credentials, swarm ledger, boards, worktrees | a session token in Keychain (`builderhelm.session`) and a cached profile row in the existing `settings` table. Nothing else |
| **Identity**   | the website's Supabase project (`cdtvxtnomtmwibkcjiwy`), already live for the waitlist    | account row only: id, email, name, avatar, `plan`                                    | the `profiles` table and its RLS                                                                                            |
| **Agent tool** | whatever Supabase project a _user's_ agent talks to over MCP during a vibe-coding session | that user's own project data                                                         | nothing — out of scope entirely                                                                                             |

Rules that follow, and that a reviewer should hold us to:

1. **No user application data leaves the device.** Not chats, not memory, not
   settings, not credentials. The account exists to answer two questions — who
   is this, and what have they paid for — and nothing more.
2. **The desktop app never takes a Supabase dependency.** No
   `@supabase/supabase-js` in `apps/` or `packages/`. Session refresh is one
   plain `fetch` from the main process to
   `https://cdtvxtnomtmwibkcjiwy.supabase.co/auth/v1/token?grant_type=refresh_token`.
   Making the boundary a dependency rule keeps it enforceable instead of
   aspirational.
3. **The identity project is never an MCP target.** Our project ref and anon key
   must not be handed to an agent as a Supabase MCP server, and conversely a
   user's MCP Supabase project has nothing to do with their BuilderHelm
   account. Same vendor, unrelated purposes — the confusion is the risk.
4. **Entitlement is cached, and that is a deliberate tradeoff.** `plan` is read
   at sign-in and stored locally; a downgrade or revocation takes effect on the
   next successful verification, not instantly. That is the price of an app that
   launches offline, and it is the right price for a local-first tool.

### On MCP, as the code stands today

Worth stating plainly so the plan does not record something that is not there:
BuilderHelm has **no MCP client or server of its own**. The only MCP in the tree
is `server_mcp`, a boolean _capability flag_ on model records
(`packages/db/src/migrations/0002-provider-settings.ts:48`), and a Claude-CLI
status string parsed in `apps/desktop/test/startup-ack.test.ts:75`. MCP happens
**inside the agent CLIs** BuilderHelm launches — the agent's own config, the
user's own servers. So Supabase-over-MCP is a workflow BuilderHelm enables, not
a subsystem it ships, and this auth work neither depends on it nor changes it.

## The flow

```
app (signed out)                website                        app
──────────────────              ─────────────────              ──────────────
orbit login screen
  Sign in  ─────────────────▶  /signin
                               Google / Apple / email
                               ─── provider round trip ───▶
                               session established
                                 ▼ top-level redirect
                               http://127.0.0.1:<port>/return#…  ──▶  loopback
                                                                       verify state
                                                                       store in Keychain
                                                                       push to renderer
                               "Signed in — return to BuilderHelm"     shell unlocks
```

The site is also the account area: `/account` (home, plan, downloads) and its
settings tabs, mirroring what the app can't host.

## Why loopback, not a `builderhelm://` deep link

No URL scheme is registered today (`apps/desktop/package.json:66-76` has no
`protocols`, no `setAsDefaultProtocolClient`, no `open-url`, no single-instance
lock), and the app ships unsigned (`identity: null`, `target: ["dir"]`), which
makes LaunchServices scheme registration unreliable. Meanwhile the repo already
runs a hardened loopback server — `apps/desktop/src/main/quota-ingest.ts`:
ephemeral port via `listen(0, '127.0.0.1')`, per-launch
`randomBytes(24)` bearer token, method+path allowlist, 64 KiB body cap,
`close()` on `before-quit`. The auth handoff copies that shape. A deep link can
be added later as a second path once signing exists.

**No new backend.** The site is static Cloudflare Pages with no Pages Functions
and no Edge Functions today; Supabase issues the session in the browser and the
browser hands it to the loopback. Nothing needing a service-role key is
introduced in v1.

### Handoff mechanics (the security-critical part)

1. App mints `state` (32 bytes) and starts a **one-shot** loopback server.
2. App opens `https://builderhelm.com/signin?return=http://127.0.0.1:<port>/return&state=<state>`
   in the system browser (`shell.openExternal`).
3. `/signin` **validates `return` against a strict allowlist** —
   `http://127.0.0.1:<1024-65535>/return` or `http://localhost:<port>/return`,
   nothing else. Without this the page is an open redirector that leaks
   sessions; it is the single most important check on the web side.
4. `return` + `state` are stashed in `sessionStorage` before the provider
   redirect so they survive the Google/Apple round trip, then restored.
5. On success the page does a **top-level redirect** to
   `…/return#state=…&access_token=…&refresh_token=…&expires_at=…`. A fragment,
   not a query: it never reaches a server log or the request line. Top-level
   navigation to loopback avoids the CORS and mixed-content problems a
   cross-origin `fetch` to `127.0.0.1` hits in Safari.
6. Loopback `GET /return` serves a small palette-matched page whose only job is
   to read `location.hash` and `POST` it back same-origin.
7. Loopback `POST /return` compares `state` in constant time, stores the
   session, pushes state to the renderer, answers "Signed in — you can close
   this tab", and **closes the server**. Single use, 5-minute deadline, then it
   gives up and the app offers to open the page again.

## Desktop changes

| Layer    | File                                            | Work                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| protocol | `packages/protocol/src/auth.ts` (new)           | `AuthSession` (email, name, avatarUrl, plan, expiresAt), `AuthState` (`signed-out` \| `waiting` \| `signed-in`), request/response schemas, channels `builderhelm:auth:{state,begin,cancel,signOut,event}`                                              |
| core     | `packages/core/src/auth/auth-service.ts` (new)  | Owns the session: writes the token bundle to Keychain under one ref, caches the non-secret profile in the `settings` table (no migration needed), exposes `state()`, `apply(session)`, `signOut()`. No Electron import, same shape as `NoSleepService` |
| main     | `apps/desktop/src/main/auth-handoff.ts` (new)   | The loopback server above, modelled on `quota-ingest.ts`                                                                                                                                                                                               |
| main     | `apps/desktop/src/main/ipc.ts`                  | 4 handlers + push channel, `removeHandler` pairs in the disposer                                                                                                                                                                                       |
| main     | `apps/desktop/src/main/keyring-secret-store.ts` | **Required:** add `/^builderhelm\.session$/` to `validSecretRefs` — the allowlist is exact-match and every `set` throws `VALIDATION_FAILED` without it                                                                                                 |
| preload  | `apps/desktop/src/preload/index.ts`             | `window.builderHelm.auth.*` + `onChange`                                                                                                                                                                                                               |
| renderer | `components/login-screen.tsx` (new)             | The orbit screen, below                                                                                                                                                                                                                                |
| renderer | `App.tsx`                                       | Gate as an early return beside `SplashScreen`, matching the existing precedent at `App.tsx:64-72`                                                                                                                                                      |
| renderer | `routes/settings/accounts.tsx`                  | A BuilderHelm-account row above the CLI providers: email, plan, Manage account (opens the site), Sign out                                                                                                                                              |

All network calls stay in main — the renderer's production CSP is
`connect-src 'self'` (`security.ts:41-44`), and the shell window cannot
navigate off-origin (`will-navigate` clamp + `setWindowOpenHandler` deny), which
is exactly why sign-in goes to the system browser.

### The login screen (our palette, not a copy)

Centre column on `--bg #080a07`: a slow **orbit ring of the agent marks we
already ship** (`AgentGlyph` — claude, codex, grok, gemini, copilot, kimi, …)
around the BuilderHelm logo, one lit at a time in `--accent #b6d475`; wordmark;
`Your agents. You at the helm.`; then `Sign in` (`--accent-bright` fill, the
house `0 4px 0` press shadow) and `Create account` (bordered secondary);
`Terms · Privacy` and the version in Geist Mono 10px uppercase.

Motion: 32s rotation, 140–200ms `--ease` transitions on the buttons, a 900ms
fade-in on mount. `prefers-reduced-motion` drops the orbit to a static ring —
the app already has `splashEnabled()` for exactly this decision.

States: `signed-out` → the screen; `waiting` → the ring keeps turning with
"Waiting for the browser…", a `Cancel`, and an `Open the page again` link (the
accounts feature already learned that a fixed timeout reports finished logins as
failures); `signed-in` → the screen unmounts and the shell renders.

## Website changes

Every page costs three files plus one line: `*.html`, `src/entries/*.tsx`, and
an entry in `vite.config.ts` `rollupOptions.input` — omitting the last silently
drops the page from `dist`.

| Page       | Files                                     | Content                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/signin`  | `signin.html`, `src/entries/signin.tsx`   | Continue with Google · Continue with Apple · OR · email + password, forgot-password link, terms line. `noindex`. When `?return=` is present: the sub-head reads "You'll be sent back to BuilderHelm"                      |
| `/account` | `account.html`, `src/entries/account.tsx` | Signed-in home + left sub-nav switching **client-side** (Account · Downloads · Plan). One page, no nested paths — a nested `/account/billing` would 404 into `public/404.html`, since no `_redirects` SPA fallback exists |
| shared     | `src/lib/supabase.ts` (new)               | Extracts the client that is currently instantiated ad hoc inside `waitlist.tsx:7-12`; `/signin` and `/account` both import it                                                                                             |
| chrome     | `src/components/site-chrome.tsx`          | A `Sign in` link beside the existing `.nav-cta`, and an account affordance when a session exists. **This file is one of your three uncommitted files — the one real collision point**                                     |
| styles     | `src/styles.css`                          | New `.auth-*` / `.account-*` block placed before the media queries, reusing `.page-hero`, `.page-section`, `.button`/`.button-primary                                                                                     | secondary`, and the `.price-card`recipe. No new tokens:`--bg #080a07`, `--surface #0d100a`, `--accent #b6d475`, `--accent-bright #d3ef9c`, `--ease`. Responsive and reduced-motion rules go in the two trailing blocks |

Design language is already fixed and gets reused verbatim: Geist + Geist Mono,
10px uppercase letter-spaced eyebrows, 10px button radius, 14px card radius,
`min(100% - 56px, 880px)` text column, global `focus-visible` in
`--accent-bright`, and the existing blanket reduced-motion block.

## Supabase

- **Providers** (dashboard, needs you): enable Google, Apple, and email.
  Prerequisites I cannot create for you — a Google OAuth client ID/secret, and
  an Apple Service ID + key (Apple requires a paid developer account). Redirect
  URL to register: `https://builderhelm.com/signin`.
- **Schema** (new `supabase/auth.sql`, following the hand-applied convention of
  `supabase/waitlist.sql:2` since there is no migrations directory):
  `public.profiles` — `id uuid pk references auth.users on delete cascade`,
  `email`, `full_name`, `avatar_url`, `plan text default 'free'`,
  `created_at`. RLS on, two policies: a user may `select` and `update` only
  `id = auth.uid()`. Plus a `handle_new_user` trigger on `auth.users` insert.
- Only the anon key is used client-side, which is correct and already the
  documented rule in `.env.example`.

## Sequence

| #   | Phase                                                                                                              | Needs your credentials? |
| --- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 1   | Supabase schema: `profiles`, `devices`, RLS, `handle_new_user` trigger                                             | no                      |
| 2   | Ed25519 keypair; `licence` Edge Function (JWT verify → slot check → sign); secrets set                             | no                      |
| 3   | Website: shared client, `/signin`, return-URL allowlist + tests of the validator                                   | no                      |
| 4   | Website: `/account` — home, plan, device list with revoke                                                          | no                      |
| 5   | App: `auth` protocol module, `AuthService`, licence verify with the embedded public key, Keychain allowlist        | no                      |
| 6   | App: loopback handoff, IPC, teardown; tests for state mismatch, replay, timeout, tampered licence, expired licence | no                      |
| 7   | App: login screen, hard gate, settings row                                                                         | no                      |
| 8   | Verify: full live sign-in, slot exhaustion on Plus, revoke, offline launch, tamper attempt; `pnpm verify` + smoke  | **yes** — Google/Apple  |

Only step 8 is blocked on the provider credentials; email/password covers
everything before it.

## Decisions — settled 2026-09-03

1. **The app requires an account**, hard gate, no skip.
2. **Three tiers exist; per-tier feature limits come later.** v1 carries the
   tier on the licence and gates one thing: device slots.
3. **Device slots: Plus (\$20) = 2 devices; Pro and Ultra = unlimited.** Two
   covers laptop plus desktop while still blocking team sharing, and avoids the
   "I bought a new Mac" support ticket a limit of one generates. This is the
   decision that forces a server.
4. **A lapsed subscription is a full lock** to the sign-in screen with a renew
   link. No read-only mode.
5. **Billing is deferred**; `plan` is set manually until Stripe lands.
6. **One domain: `builderhelm.com/account`.**
7. **Stack: Supabase for identity, plus two bolt-ons.** Evaluated against AWS
   Cognito and rejected it: Cognito ships no database (our device slots need
   relational rows with row-level policies), the same outcome would take five
   or six AWS services instead of one project and one function, and user pools
   cannot export password hashes — migrating off would force every customer to
   reset their password. AWS is genuinely cheaper on the invoice at low volume;
   Supabase is cheaper in the hours of the one person building this. The
   licence design is vendor-portable either way, so this is not a one-way door.
   - **Cloudflare Turnstile** on sign-in, sign-up, and password reset. Supabase
     verifies it server-side natively — set the secret under Authentication →
     Bot and Abuse Protection, pass `options.captchaToken` from the page. The
     site is already on Cloudflare, so this costs one widget and ~20 lines.
   - **A real transactional sender** before launch. Supabase's built-in mailer
     is rate-limited and sends from Supabase's domain, which is wrong for
     password resets on paid software. SendGrid works; Resend and Postmark have
     better DX. Point Authentication → Emails → SMTP at it on `builderhelm.com`.
   - PostHog and Sentry are complementary, not part of this feature. If they
     ever go into the **desktop** app they must be opt-in, events-only, and
     must never carry prompts, file paths, repo names, or code — telemetry
     inside a local-first tool is a product decision, not an SDK default.

## Infrastructure the identity plane requires

Verified on this machine, 2026-09-03:

| Thing                  | State                                                                                                                                 | Needed for                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Supabase CLI           | not installed, but `npx supabase@latest` works (2.116.0) — this is how the project was linked on Aug 25 (`supabase/.temp/cli-latest`) | `functions deploy`, `secrets set` |
| CLI auth               | **already logged in** — `projects list` returns the project                                                                           | any CLI call                      |
| Docker                 | not installed, and **not needed** — only `supabase start` (the local stack) requires it; deploy bundles remotely                      | —                                 |
| `supabase/config.toml` | still missing; deploy uses `--project-ref`                                                                                            | optional                          |
| Project status         | **`ACTIVE_HEALTHY` as of 2026-09-03**                                                                                                 | identity plane                    |

### Auto-pause is a launch blocker, not a nuisance

The project was restored to `ACTIVE_HEALTHY` on 2026-09-03. Free Supabase
projects still pause after about a week of inactivity, and a paused project
serves no auth and no functions.

Combine that with two decisions already made — **full lock** on failure, and a
**7-day licence `exp`** — and the failure mode is severe: if the identity
project pauses for a week, every customer's licence expires with no way to
refresh, and the whole paid user base is locked out of software they paid for.

So before launch the identity project must be on a plan that does **not**
auto-pause (Supabase Pro, \$25/mo at time of writing). That is a real cost of
charging for the app, and it belongs in the plan rather than in an incident.

Two things follow for the design:

1. **`exp` is the whole safety margin.** 7 days is the buffer against a
   Supabase outage; a longer window trades enforcement for resilience. Revisit
   the number once there is real uptime data, not before.
2. **We do not soften the lock when the server is unreachable.** Tempting, but
   it hands anyone a bypass: block the domain in `/etc/hosts` and the app is
   free forever. Server availability is our problem to solve with money and
   monitoring, not with a client-side exception.

## Anti-bypass architecture

### The honest ceiling, stated first

Code that runs on the user's machine can always be patched by someone
determined enough. No desktop licensing scheme survives a motivated attacker
with a debugger, and anyone claiming otherwise is selling something. What a good
design buys is a different, achievable goal:

- **Casual bypass becomes impossible.** No config edit, no clock change, no
  copied file, no DB tweak, no proxy grants entitlement.
- **Sharing one subscription across a team is blocked**, because slots are
  counted server-side.
- **Bypass requires patching a signed binary**, which is a deliberate act, not
  an accident — and which code signing plus notarisation makes visible.

We optimise for that, and we do **not** spend effort on obfuscation, anti-debug
traps, or jailbreak detection: high cost, trivially defeated, and they punish
legitimate users first.

### The design: a short-lived signed licence

The app never decides its own entitlement, and never trusts a value it can
write. It holds a **licence** it cannot forge:

```
sign-in ──▶ Supabase session (access + refresh token, in Keychain)
                 │
                 ▼  POST /functions/v1/licence   (Authorization: user's access token)
          Edge Function (holds the Ed25519 private key)
                 │   • identifies the user from the verified JWT — not from the request body
                 │   • claims or matches a device slot for device_hash
                 │   • refuses when the tier's slots are full
                 ▼
          licence = base64url(payload) + "." + Ed25519 signature
                    { sub, plan, device_id, iat, exp }
                 │
                 ▼
          app verifies with an EMBEDDED PUBLIC KEY, then gates
```

Why each piece is the way it is:

- **Signed, not fetched-and-trusted.** A cached licence in the local DB is
  useless to tamper with: change one byte of `plan` and the Ed25519 signature
  fails. The app carries only the **public** key, so there is no secret in the
  binary to extract.
- **`exp` is the offline policy, and the server owns it.** This replaces the
  hand-rolled grace window from the earlier draft: the licence simply carries an
  expiry (start at 7 days), so "how long may this run offline" becomes a server
  decision, expressed in a value the client cannot extend. Launch verifies the
  signature and `exp` locally — no network needed — and re-fetches in the
  background when online.
- **Identity comes from the verified JWT, never the body.** The function reads
  `sub` from the caller's Supabase access token. A client cannot ask for someone
  else's licence.
- **Slots are counted where the client cannot reach.** `devices` rows are
  written by the function under the service-role key; RLS gives the user
  read-and-revoke on their own rows and nothing else. Self-granting a slot is
  not a client-side operation at all.
- **Clock tampering is bounded.** Rolling the Mac's clock back can extend one
  licence to its `exp` at most; it cannot mint a new one, because minting needs
  the server. Optionally compare `exp` against the last-seen server date and
  refuse a clock that has moved backwards.
- **Revocation works** on the next verification: delete the device row or set
  `plan`, and the next licence request is refused. Bounded by `exp`, which is
  exactly the tradeoff a local-first tool should make.

### Device identity

`device_hash = sha256(IOPlatformUUID + app salt)`, read on macOS from
`ioreg -rd1 -c IOPlatformExpertDevice`. Hardware-derived, so it survives a
reinstall and is not editable in a settings pane; hashed with a salt so we
never store or transmit the raw hardware UUID. Sent with a human label
(`hostname`) so the account page can show "MacBook Pro — last seen 2h ago".

### New infrastructure this requires

One Supabase **Edge Function** (`supabase/functions/licence/`). This is the
first server-side code in either repo, and it is deliberately the only one:

- Runtime: Deno on Supabase, co-located with auth and the database, so the
  caller's JWT is verified natively and the DB needs no network hop.
- Secrets: the Ed25519 **private key** and the service-role key, set with
  `supabase secrets set` — never in either repo, never in a `VITE_` variable.
- The matching **public key** is committed in the app source. Rotation means
  shipping an app update, so the app accepts a small key set (current +
  previous) rather than exactly one.

### Schema

```sql
profiles (id uuid pk → auth.users, email, full_name, avatar_url,
          plan text default 'none', plan_renews_at timestamptz, created_at)
devices  (id uuid pk, user_id uuid → auth.users, device_hash text,
          label text, created_at, last_seen_at, revoked_at,
          unique (user_id, device_hash))
```

RLS: a user may `select` their own `profiles` row and `select`/`update
(revoked_at)` their own `devices` rows. **No client-side insert or update on
`plan` or on device rows** — those are the function's job. Slot limits live in
the function, not the database, so changing them is a deploy and not a
migration.

### What the user sees

The account page lists devices with a **Revoke** button, because a capped tier
without a way to free a slot generates support tickets on day one. Revoking
takes effect for that device at its next licence refresh.

## Out of scope for v1

Stripe, credits metering, invoices, tax IDs, team accounts, `builderhelm://`
deep links, Windows/Linux Keychain equivalents (storage is darwin-only by
construction today), and password reset email templating beyond Supabase's
default.
