# Legal documents

The two documents to publish on the BuilderHelm website:

| Document                 | Publish as           |
| ------------------------ | -------------------- |
| [TERMS.md](TERMS.md)     | Terms and Conditions |
| [PRIVACY.md](PRIVACY.md) | Privacy Policy       |

Both are distinct from [`LICENSE`](../../LICENSE), which governs this private
repository and its source code, not use of the shipped application.

Both are drafts. Have a lawyer in the governing jurisdiction review them before
taking payment, with particular attention to the liability cap in Terms section
11 and the consumer carve-outs.

## Fields to fill before publishing

Six facts are referenced by both documents and are not in them. Substitute the
real values, then delete this section.

| Field                       | Used in                         | Notes                                                                                                                                                 |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governing law               | Terms 15                        | The country, or country and state, whose law applies.                                                                                                 |
| Courts                      | Terms 15                        | The city and country whose courts hear disputes. Usually where you are based.                                                                         |
| Contact email               | Terms 18, Privacy 8, Privacy 12 | One address is fine for both legal and privacy contact.                                                                                               |
| Postal address              | Privacy 4                       | Data protection law expects a contact address for the data controller. Optional if you are a sole trader without a business address, but recommended. |
| Payment provider            | Terms 4, Privacy 4              | Name it. Paddle and Lemon Squeezy act as merchant of record and handle tax; Stripe does not.                                                          |
| Email and hosting providers | Privacy 4                       | Name whoever sends your email and hosts your site.                                                                                                    |

Everything else is decided and stated in the documents: 14-day no-questions
refund, USD 100 liability floor, eight-year tax retention, 24-month support
email retention, age 16, Standard Contractual Clauses for transfers, courts
rather than arbitration.

## Keeping the Privacy Policy true

The policy states that the application has no analytics, no telemetry, no crash
reporting, no update check, and no licence activation. That was verified against
the code and must stay true, or the document becomes a false statement to
customers and regulators.

Adding any of these requires updating the policy first:

- licence activation or subscription enforcement, which introduces a server, a
  device identifier, and an IP address;
- update checks or an auto-updater, which reveal version and platform;
- analytics, telemetry, or crash reporting;
- error reporting that uploads logs;
- the optional relay or remote-control feature, which carries user data off the
  device.

Section 5 of the policy already commits to updating it before activation ships.

## Where to surface them

- Linked in the website footer, and on the download and pricing pages.
- Accepted at purchase, ideally with a checkbox recording the version accepted.
- Reachable from the application's Help menu, next to the third-party notices.
