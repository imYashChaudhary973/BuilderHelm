# Privacy Policy

**Publish-ready except for the fields listed in [README.md](README.md).** Have a
lawyer in your jurisdiction review this before you take payment.

Last updated: 28 August 2026

---

This policy explains what happens to your data when you use the BuilderHelm
desktop application or our website. BuilderHelm is provided by Yash Chaudhary
("we", "us", "our").

## 1. The short version

BuilderHelm runs on your computer and keeps your work on your computer.

- We do not run a server that receives your code, projects, prompts, or
  credentials.
- The application contains **no analytics, no telemetry, no crash reporting, and
  no usage tracking**.
- The application does not check for updates or call home.
- Your model provider API keys are stored in your operating system's keychain and
  are never sent to us.

The only personal data we handle is what you give us when you buy a subscription
or email us. That is described in section 4.

## 2. What stays on your computer

BuilderHelm stores the following locally, in its application data folder and in
your operating system keychain:

| What                                                             | Where                                                         | Notes                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Projects, tasks, boards, chats, notes, runs, approvals, receipts | local database                                                | never sent to us                                      |
| Model provider API keys                                          | operating system keychain                                     | never written to the database, logs, or the interface |
| Repository paths, Git state, worktrees                           | your file system                                              | never sent to us                                      |
| Indexes built from your own Markdown notes                       | local database                                                | your files stay the source of truth                   |
| Diagnostic logs                                                  | local, with tokens, credentials, and sensitive values removed | never uploaded                                        |

We have no access to any of this. There is no feature in the application that
sends it to us.

## 3. What leaves your computer

BuilderHelm makes network requests only in these cases, and only because you
asked it to:

1. **Model providers you configure.** When you use an AI feature, your request
   goes to the provider endpoint you configured, using the credential you
   supplied. The defaults are OpenAI and Anthropic. You can point it at a local
   server instead, in which case nothing leaves your machine.
2. **Coding agents you install.** BuilderHelm launches third-party agent
   programs when you tell it to. Those programs make their own network requests
   under their own terms. We do not observe or control them.
3. **The built-in browser.** If you use it, it loads the address you type, in a
   separate sandboxed view.

**Please note:** when a request goes to a model provider or an agent, its
contents — which can include your source code, file contents, and prompts — are
handled under **that company's** terms and privacy policy, not ours. We are not
part of that relationship. Please read the privacy policy of each provider and
agent you enable.

## 4. What we collect when you buy or contact us

This is the only personal data we hold.

| Why                                   | What                                                                      | Legal basis                                                              | Who processes it     |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| Taking payment, invoices, tax records | name, email, billing country, payment method details, transaction records | performing our contract with you; legal obligation to keep tax records   | our payment provider |
| Answering your emails                 | your email address and your message                                       | performing our contract; our legitimate interest in supporting customers | our email provider   |
| Running our website                   | server logs, which can include IP address and browser type                | our legitimate interest in security and keeping the site available       | our hosting provider |

The providers we use are named in [README.md](README.md).

We do not sell your personal data. We do not share it for advertising. We do not
use it for profiling or automated decision-making.

Card details are handled entirely by our payment provider. We never see or store
full card numbers.

## 5. Licence activation

The current version of BuilderHelm has no licence activation and does not contact
us to check your subscription.

If we add subscription enforcement in future, it will need to send limited
information to a server, such as your licence key or email address, a device
identifier, and your IP address. We will update this policy to say exactly what
is sent and how long it is kept **before** that feature ships.

## 6. How long we keep things

- Data on your computer stays until you delete it, or until you uninstall
  BuilderHelm and remove its application data folder and keychain entries.
- Purchase and tax records are kept for as long as tax law requires, currently
  eight years.
- Support emails are kept for 24 months after the matter is closed.

## 7. Where your data goes

Our payment, email, and hosting providers may process data outside your country.
Where data moves out of the UK or the European Economic Area, we rely on Standard
Contractual Clauses or an adequacy decision to protect it.

## 8. Your rights

Depending on where you live, you may have the right to see the personal data we
hold about you, correct it, delete it, receive a copy of it, restrict how we use
it, object to use based on legitimate interests, and withdraw consent.

Because your project data never reaches us, these rights apply to the purchase
and support data in section 4. For anything on your computer you already have
full control: delete the database, remove the keychain entries, or uninstall the
application.

To make a request, email the address in [README.md](README.md). We will reply
within one month. If you are in the UK or the European Economic Area and you are
unhappy with our response, you can complain to your local data protection
authority.

## 9. How we protect the application

- The interface runs sandboxed, with context isolation, no Node integration, and
  a restrictive content security policy.
- Every internal request is checked against a schema before it is acted on.
- Credentials live in the operating system keychain, never in the database, the
  logs, or the interface.
- Logs strip out tokens, credentials, and sensitive values.
- Agent commands use fixed programs with separate arguments, never assembled
  shell strings.

No software is perfectly secure. In particular, agents run with your own
operating system permissions, and Git worktrees separate ordinary edits but are
not a security sandbox.

## 10. Children

BuilderHelm is a developer tool and is not aimed at children. We do not knowingly
collect personal data from anyone under 16.

## 11. Changes to this policy

We will update this policy when our data handling changes, and we will change the
date at the top. If a change materially affects the data in section 4, we will
tell you by email or in the application before it takes effect.

## 12. Contact

See the contact address in [README.md](README.md).
