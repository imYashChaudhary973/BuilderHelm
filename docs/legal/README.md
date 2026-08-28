# Legal documents

Customer-facing terms for the commercial release. Both documents are **drafts
awaiting review by a qualified lawyer** and must not be published or relied on
until that review is complete.

| Document                 | Covers                                             |
| ------------------------ | -------------------------------------------------- |
| [EULA.md](EULA.md)       | the contract between BuilderHelm and a paying user |
| [PRIVACY.md](PRIVACY.md) | what data is processed, by whom, and where         |

These are distinct from [`LICENSE`](../../LICENSE), which governs this
repository and its source, not use of the shipped application.

## Before publishing

1. Resolve every `[DECIDE: ...]` field. They are commercial and jurisdictional
   facts, not drafting gaps.
2. Have a lawyer in the governing jurisdiction review both documents, with
   particular attention to the liability cap and the consumer carve-outs.
3. Re-verify the Privacy Policy against the code. It currently states that the
   application has no telemetry, no update check, and no licence activation.
   That is true of the audited version and must stay true, or the document
   becomes a false statement to regulators and customers.
4. Surface both documents where a user actually sees them: on the download page,
   at first run or install, and from the application's Help menu alongside the
   third-party notices.

## Keeping the Privacy Policy honest

Adding any of the following changes what must be disclosed, and requires a
matching update here:

- licence activation or subscription enforcement, which introduces a server, a
  device identifier, and an IP address;
- update checks or an auto-updater, which reveal version and platform;
- analytics, telemetry, or crash reporting of any kind;
- error reporting that uploads logs;
- an optional relay or remote-control feature, which carries user data off the
  device.

The application audited for version 0.1 of these documents had none of these.
