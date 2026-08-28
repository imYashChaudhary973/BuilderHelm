# BuilderHelm Privacy Policy

**Status: unreviewed draft. Must be reviewed by a qualified lawyer before
BuilderHelm accepts payment.** Fields marked `[DECIDE: ...]` are facts the owner
must supply. This document describes the application as verified in the
repository on 2026-08-28; **it must be re-checked whenever data handling
changes**, and especially if licence activation is added.

Version 0.1 (draft) · Last updated: 2026-08-28

---

## 1. Summary

BuilderHelm is a local-first desktop application. It runs on your machine and
stores your work on your machine.

- We operate **no server** that receives your projects, code, prompts, or credentials.
- The application contains **no analytics, telemetry, crash reporting, or usage tracking**.
- The application performs **no update check or licence phone-home** in the version this document describes.
- Your provider credentials are stored in your operating system's keychain and are never transmitted to us.

The only personal data we process is what you give us when you buy a
subscription or contact us. That is handled by our payment provider and email
provider, described in section 5.

## 2. Who we are

`[DECIDE: legal entity name]`, `[DECIDE: registered address]`, referred to as
"we" or "us". This policy covers the BuilderHelm desktop application and
`[DECIDE: website domain]`.

For data-protection purposes we are the controller of the data described in
section 5. For everything stored on your device, described in section 3, you are
the controller and we have no access.

## 3. What stays on your device

The application stores the following locally, in your user data directory and in
your operating system keychain:

| Data                                                             | Where                                                                      | Notes                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Projects, tasks, boards, chats, notes, runs, approvals, receipts | local SQLite database                                                      | never transmitted to us                                    |
| Model provider API keys                                          | operating system keychain                                                  | never written to the database, logs, or the user interface |
| Repository paths, Git state, worktrees                           | your filesystem                                                            | never transmitted to us                                    |
| Memory or vault indexes built from your Markdown files           | local SQLite database                                                      | your files remain the source of truth                      |
| Diagnostic logs                                                  | local, structured, with tokens, credentials, and sensitive values redacted | not uploaded                                               |

We cannot read any of this. There is no mechanism in the application that sends
it to us.

## 4. What leaves your device, and to whom

The application makes outbound network requests **only** in these cases, all of
which you initiate or configure:

1. **Model providers you configure.** When you use a built-in AI feature, the application sends your request to the provider endpoint you configured, using the credential you supplied. Defaults are `api.openai.com` and `api.anthropic.com`; you may configure others, including a local server such as Ollama, in which case nothing leaves your machine.
2. **Agent CLIs you install.** The application launches third-party coding agents on your instruction. Those programs make their own network requests under their own terms, which we neither control nor observe.
3. **The preview browser.** If you open the built-in browser, it loads the address you request, in a separate sandboxed context.

**Important:** when a request goes to a model provider or an agent, its contents
— which may include your source code, file contents, and prompts — are handled
under **that provider's** terms and privacy policy, not ours. Review the terms of
each provider and agent you enable. We are not a party to that relationship.

## 5. What we process when you buy or contact us

This is the only personal data we handle.

| Purpose                        | Data                                                                       | Legal basis (GDPR)                                          | Processor                    |
| ------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| Taking payment, invoicing, tax | name, email, billing country, payment-method metadata, transaction records | performance of a contract; legal obligation for tax records | `[DECIDE: payment provider]` |
| Support and service email      | your email address and the contents of your message                        | performance of a contract; legitimate interests             | `[DECIDE: email provider]`   |
| Website hosting                | server logs, which may include IP address and user agent                   | legitimate interests in security and availability           | `[DECIDE: hosting provider]` |

We do not sell personal data, do not share it for advertising, and do not use it
for automated decision-making or profiling.

Card details are handled by the payment provider. We never receive or store full
payment card numbers.

## 6. Licence activation

`[DECIDE: The version of the application described here contains no licence
activation or subscription enforcement. Selling subscriptions will require one,
and that mechanism will process personal data — typically an email address or
licence key, a device identifier, and an IP address — on a server. When it is
added, this section must be rewritten to state exactly what is sent, how often,
how long it is retained, and on what legal basis. Do not ship activation while
this section still says "none".]`

## 7. Retention

- Data on your device stays until you delete it, or you uninstall the application and remove its user data directory and keychain entries.
- Purchase and tax records are retained for the period required by law in our jurisdiction: `[DECIDE: retention period, commonly 6–8 years]`.
- Support email is retained for `[DECIDE: period, e.g. 24 months]` after the matter is closed.

## 8. International transfers

Our payment, email, and hosting providers may process data outside your country.
Where that happens from the UK or EEA, transfers rely on `[DECIDE: transfer
mechanism, typically Standard Contractual Clauses or an adequacy decision]`.

## 9. Your rights

Depending on where you live, you may have the right to access, correct, delete,
port, or restrict processing of your personal data, to object to processing based
on legitimate interests, and to withdraw consent.

Because your project data never reaches us, these rights apply to the purchase
and support data in section 5. For data on your device, you already have direct
control: delete the database, remove the keychain entries, or uninstall.

To exercise a right, contact us at `[DECIDE: privacy contact email]`. We respond
within one month. If you are in the UK or EEA you may also complain to your
supervisory authority; `[DECIDE: name the authority for the jurisdiction, or
state that users should contact their local authority]`.

## 10. Security

- Renderers are sandboxed with context isolation, no Node integration, and a restrictive content security policy.
- Every inter-process request is validated at runtime against a schema.
- Credentials are stored in the operating system keychain, never in the database, logs, or the interface.
- Logs redact tokens, credentials, and sensitive values.
- Agent commands use fixed executables with argument arrays rather than shell strings.

No system is perfectly secure. Note in particular that agents run with your own
operating-system permissions, and that Git worktrees isolate ordinary edits but
are not a security sandbox.

## 11. Children

BuilderHelm is a developer tool and is not directed at children. We do not
knowingly collect personal data from anyone under `[DECIDE: age threshold for the
jurisdiction, commonly 16 in the EEA and 13 elsewhere]`.

## 12. Changes

We will update this policy when our data handling changes, and will change the
version and date above. Material changes affecting the data in section 5 will be
notified by email or in the application before taking effect.

## 13. Contact

`[DECIDE: privacy contact email]`
