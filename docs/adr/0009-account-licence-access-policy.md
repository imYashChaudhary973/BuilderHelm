# ADR 0009: Account sign-in and licence gate access policy

- Status: Accepted
- Date: 2026-09-07

## Context

The desktop is gated behind a signed account licence (`feat/auth`, now part of
the modes stack). Repository rules require security- and permission-adjacent
changes to document their access policy and go through review. This file is
that policy: what the gate talks to, what it stores, what it sends, and how it
fails.

## Decision

**The gate talks to one identity backend, stores secrets in the OS keychain,
verifies licences locally, and sends nothing else anywhere.**

1. **Identity endpoints.** Sign-in opens the user's browser at
   `https://builderhelm.com/signin?return=<loopback>&state=<random>` and the
   account page at `https://builderhelm.com/account`. Token exchange and
   refresh go to the BuilderHelm Supabase identity instance
   (`/functions/v1/licence`, `/auth/v1/token`). No other endpoint is contacted
   by the gate.

2. **Handoff is loopback, state-checked, and deadline-bound.** The identity
   provider redirects to a local loopback page, which POSTs
   `{state, access_token, refresh_token, expires_at}` to a `127.0.0.1` server
   the app started for that one sign-in. `state` is compared with
   `timingSafeEqual`; the server lives for one exchange with a five-minute
   deadline and a 64 KiB body cap. A lost handoff resurfaces the pending
   sign-in link rather than guessing.

3. **Licences verify offline against pinned keys.** The licence is an EdDSA
   token; the app ships the public keys (`k1`, with room for rotation) and
   checks issuer, subject, expiry, plan (`plus|pro|ultra`), and device claim
   locally. Verification makes no network call. Any failure — tamper, unknown
   key, lapsed expiry, wrong plan — returns null and the app stays signed out.

4. **Device binding is a salted hash.** The device claim is a hash of the
   platform UUID with an app salt. The raw hardware identifier is never
   stored, sent, or logged.

5. **Tokens live only in the OS keychain.** Access and refresh tokens are
   stored through the platform secret store, never in SQLite, settings, or
   renderer storage. Profile name and avatar (display data) live in settings.
   Sign-out clears the bundle and profile.

6. **The account origin is overridable only in unpackaged dev builds.** A
   packaged app always talks to production; honoring the override there would
   let anyone point the gate at a page that phishes account passwords.

7. **No telemetry.** The gate records no analytics. `scripts/check-telemetry.mjs`
   fails the build if telemetry enters the tree.

8. **Agent CLIs are untouched.** ADR 0008 still governs agents: they
   authenticate with their own vendors in their own flows. The BuilderHelm
   licence gates the workspace, never model access.

## Consequences

- Reviewers of auth diffs read this file first; changes to endpoints, storage,
  or verification belong in a PR that updates it.
- A Supabase anon key ships in the binary. That key is public by design
  (client-side identity); it grants no data access without the user's own
  credentials.
- A lapsed licence signs the user out with the reason shown; the workspace
  services (terminals, editor, Git) do not run behind the gate, so an expired
  licence means no BuilderHelm session at all.
- Key rotation must add the new `kid` to `LICENCE_PUBLIC_KEYS` while keeping
  the old one until every issued licence has rotated.

## Replacement criteria

Replace this policy if account identity moves off Supabase, if licences stop
being locally verified EdDSA tokens, or if the product ever needs to send
usage or identity data beyond these endpoints. Any of those is a new ADR, not
an edit to this one.
