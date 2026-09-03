# Provider setup — Google and Apple

Operational checklist. Do these in order; step 1 unblocks everything else.
Values below are ours, already filled in — copy them verbatim.

| Thing                                   | Value                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| Supabase project                        | `BuilderHelm`                                               |
| Project ref                             | `cdtvxtnomtmwibkcjiwy`                                      |
| **OAuth callback URL** (both providers) | `https://cdtvxtnomtmwibkcjiwy.supabase.co/auth/v1/callback` |
| Supabase auth domain                    | `cdtvxtnomtmwibkcjiwy.supabase.co`                          |
| Site URL                                | `https://builderhelm.com`                                   |

---

## 0. Supabase URL configuration (2 minutes, do this first)

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://builderhelm.com`
- **Redirect URLs** — add all four:
  - `https://builderhelm.com/signin`
  - `https://builderhelm.com/account`
  - `http://localhost:4173/signin` _(the site's dev/preview port)_
  - `http://localhost:4173/account`

Without these, a provider round trip lands on an "invalid redirect" error.

---

## 1. Google — OAuth client ID + secret

All in the **Google Auth Platform** console (the new home for what used to be
"OAuth consent screen" + "Credentials").

1. <https://console.cloud.google.com/> → create or select a project (name it
   `BuilderHelm`).
2. **Audience** (<https://console.cloud.google.com/auth/audience>) → User type
   **External**. While it is in _Testing_ only accounts you list can sign in, so
   add your own Google account as a test user. Click **Publish app** when you
   want anyone to sign in.
3. **Data Access** (<https://console.cloud.google.com/auth/scopes>) → confirm
   exactly these three, nothing more:
   - `openid` — **add this one manually**
   - `.../auth/userinfo.email` _(default)_
   - `.../auth/userinfo.profile` _(default)_

   Anything beyond these three can trigger Google app verification, which takes
   days. Three is all we need for email + name + avatar.

4. **Branding** (<https://console.cloud.google.com/auth/branding>) → app name
   `BuilderHelm`, logo, support email, and the two links Google requires:
   - Privacy policy: `https://builderhelm.com/privacy`
   - Terms of service: `https://builderhelm.com/terms`

   ⚠️ **Neither page exists on the site yet** — the repo has `index`, `about`,
   `contact`, `waitlist`, `thank-you` only. There is a `feat/legal-terms` branch
   in the app repo with Terms and Privacy content; those need publishing to the
   website before this step can be completed. Sign-in works without brand
   verification, but the consent screen will show `cdtvxtnomtmwibkcjiwy.supabase.co`
   instead of BuilderHelm until it is done.

5. **Clients** (<https://console.cloud.google.com/auth/clients>) → **Create
   client** → Application type **Web application**, name `BuilderHelm Web`:
   - **Authorized JavaScript origins**
     - `https://builderhelm.com`
     - `http://localhost:4173` _(remove before launch if you prefer)_
   - **Authorized redirect URIs** — this one is Supabase's, not ours:
     - `https://cdtvxtnomtmwibkcjiwy.supabase.co/auth/v1/callback`
6. **Create** → copy the **Client ID** and **Client Secret**.
7. Supabase → **Authentication → Providers → Google** → enable, paste both,
   **Save**.

Done. Total time ≈ 10 minutes, excluding the legal pages.

---

## 2. Apple — Services ID + signing key

Requires a **paid** Apple Developer membership ($99/yr). Five objects, in this
order: Team ID → App ID → Services ID → email source → Key.

1. <https://developer.apple.com/account> → note your **Team ID** (10
   characters, upper-right of the membership page). Keep it.
2. **Identifiers → App IDs → +** → type **App**:
   - Description: `BuilderHelm`
   - Bundle ID: **Explicit**, `com.builderhelm.app`
   - Capabilities: tick **Sign in with Apple**
   - Leave the server-to-server notification endpoint blank — Supabase does not
     support it.
   - Continue → Register.
3. **Identifiers → Services IDs → +** → type **Services IDs**:
   - Description: `BuilderHelm Web`
   - Identifier: `com.builderhelm.web` ← **this is the `client_id`** you give
     Supabase. Write it down.
   - Continue → Register.
4. Open the new Services ID → tick **Sign in with Apple** → **Configure**:
   - Primary App ID: `com.builderhelm.app` (from step 2)
   - **Domains and Subdomains**: `cdtvxtnomtmwibkcjiwy.supabase.co`
   - **Return URLs**: `https://cdtvxtnomtmwibkcjiwy.supabase.co/auth/v1/callback`
   - Next → Done → Continue → **Save**.

   Note both values are Supabase's domain, not `builderhelm.com`. Apple
   validates the domain that actually receives the POST, which is Supabase.

5. **Services → Sign in with Apple for Email Communication**
   (<https://developer.apple.com/account/resources/services/list>) → register
   `builderhelm.com` and add the SPF record Apple shows you. This is what lets
   Apple's private relay deliver mail to users who hide their address; skip it
   and those users never get our email.
6. **Keys → +**:
   - Key Name: `BuilderHelm Sign in with Apple`
   - Tick **Sign in with Apple** → **Configure** → Primary App ID
     `com.builderhelm.app` → Save
   - Continue → Register → **Download `AuthKey_XXXXXXXXXX.p8`**.

   ⚠️ **One download only.** Apple never shows it again. Store it in 1Password
   or the equivalent. Note the **Key ID** (the `XXXXXXXXXX`, 10 characters).

7. **Generate the client secret.** Apple does not hand you a secret — you sign a
   JWT with the `.p8`. Supabase publishes an in-browser generator on
   <https://supabase.com/docs/guides/auth/social-login/auth-apple> (§
   "Configuration") that keeps the key local. It needs:
   - Team ID (step 1)
   - Services ID `com.builderhelm.web` (step 3)
   - Key ID (step 6)
   - the `.p8` file contents

   Use Chrome or Firefox — the tool does not work in Safari.

8. Supabase → **Authentication → Providers → Apple** → enable:
   - **Client IDs**: `com.builderhelm.web` — the Services ID, listed **first**
   - **Secret Key**: the JWT from step 7
   - Save.

### ⚠️ Two Apple facts that will bite later

- **The secret expires in 6 months, maximum.** When it lapses, Apple sign-in
  starts failing with no warning from our side. Put a recurring calendar
  reminder now, and keep the `.p8` — regenerating needs it.
- **Apple's web flow never returns the user's name.** Only the first _native_
  sign-in does. So `profiles.full_name` will be empty for Apple users; the
  account UI falls back to the email, and we can ask for a name in the account
  settings later.

---

## 3. Email + password

Nothing external to buy. Supabase → **Authentication → Providers → Email** →
enable, and decide **Confirm email** on or off:

- **On** (recommended for paid software): the user must click a link before the
  account works. Cleaner list, no junk signups. Costs one extra step at signup.
- **Off**: instant access, but typos become permanently broken accounts.

While on Supabase's built-in mailer you get a low daily send cap and their
domain in the From line. Before launch, point **Authentication → Emails → SMTP**
at a real sender (Resend, Postmark, SES) on `builderhelm.com`.

---

## What to hand me when you are done

Nothing secret needs to reach me. Just confirm:

1. Google provider — enabled in Supabase ✅
2. Apple provider — enabled in Supabase ✅ (or "skip Apple for now")
3. Email provider — enabled, and whether **Confirm email** is on or off
4. The Services ID string you used, if it differs from `com.builderhelm.web`

The client secrets live only in the Supabase dashboard. The website only ever
uses the anon key it already has, and the desktop app never sees either.
