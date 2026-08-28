# BuilderHelm End User License Agreement

**Status: unreviewed draft. Must be reviewed by a qualified lawyer in the
governing jurisdiction before BuilderHelm accepts payment.** Fields marked
`[DECIDE: ...]` are commercial or jurisdictional facts the owner must supply;
they are not drafting gaps.

Version 0.1 (draft) · Last updated: 2026-08-28

---

## 1. Agreement

This End User License Agreement ("Agreement") is a binding contract between
`[DECIDE: legal entity name, e.g. "Yash Chaudhary, sole proprietor" or a
registered company name]` of `[DECIDE: registered address]` ("we", "us") and the
person or organisation that installs or uses BuilderHelm ("you").

You accept this Agreement by installing, activating, or using BuilderHelm. If
you do not accept it, do not install or use the software. If you accept it on
behalf of an organisation, you confirm you are authorised to bind that
organisation.

## 2. Definitions

- **Software** — the BuilderHelm desktop application, its updates, and its documentation.
- **Subscription** — a time-limited right to use the Software, billed periodically.
- **Seat** — one named individual authorised to use the Software. Seats are not concurrent slots and may not be shared or rotated between people.
- **Agent** — a third-party coding CLI or model provider that you install, configure, or authenticate, and that the Software launches on your instruction.
- **Your Content** — repositories, files, commands, prompts, credentials, notes, and other data you supply or that Agents produce on your machine.

## 3. Licence grant

Subject to payment and to this Agreement, we grant you a non-exclusive,
non-transferable, revocable licence to install and use the Software on devices
you own or control, for the number of Seats you have purchased, for your
internal business or personal development purposes.

This is a licence, not a sale. We retain all right, title, and interest in the
Software.

## 4. Restrictions

You must not:

1. redistribute, resell, sublicense, rent, lease, or host the Software for third parties;
2. reverse engineer, decompile, or disassemble the Software, except where that right cannot lawfully be excluded;
3. remove, obscure, or alter any proprietary notice, licence check, or attribution document;
4. circumvent Seat limits, licence validation, or subscription expiry;
5. use the Software to build, train, or benchmark a competing product;
6. use the Software unlawfully, or to access systems or data you are not authorised to access.

## 5. Subscription, billing, and cancellation

Subscriptions renew automatically for the same period until cancelled. You may
cancel at any time; cancellation takes effect at the end of the current billing
period, and access continues until then.

Payment is processed by `[DECIDE: payment provider, e.g. Paddle, Lemon Squeezy,
Stripe]`. Where that provider acts as merchant of record, its purchase terms also
apply to the transaction.

Refunds: `[DECIDE: refund window and conditions. Consumers in the EU and UK have
a statutory withdrawal right of at least 14 days that cannot be excluded; a
common approach is to offer 14 days unconditionally.]`

We may change prices for future billing periods with at least 30 days' notice.
If we do, you may cancel before the change takes effect.

If payment fails or a Subscription lapses, the Software may stop functioning or
reduce to a read-only state.

## 6. Agents, model providers, and their terms

BuilderHelm does not include a model and does not provide agent capabilities of
its own. It launches Agents that you have installed and authenticated.

You are solely responsible for:

1. holding valid licences, subscriptions, and API credentials for every Agent you use;
2. complying with each Agent's own terms of service and acceptable use policy;
3. any charges, rate limits, or account action arising from your use of an Agent.

Sending Your Content to a model provider sends it under **that provider's**
terms and privacy practices, not ours. We are not a party to that relationship
and do not control it.

## 7. How the Software operates, and what you accept

You acknowledge the following characteristics of the Software, which are
intentional and material to this Agreement:

1. **Agents execute real commands.** The Software runs Agent processes on your machine with your operating-system permissions. Those processes can create, modify, and delete files, run tests, change Git state, and make network requests.
2. **Git worktrees are not a security sandbox.** They isolate ordinary edits and branches. They do not prevent a process from reading your filesystem, altering shared repository configuration, or using credentials available to your user account.
3. **Optional reduced-oversight modes exist.** The Software offers modes that reduce or skip per-action approval. Enabling them is your decision and increases the risk of unintended changes.
4. **Automated output is unverified.** Code, commits, diffs, test results, and answers produced by Agents may be wrong, insecure, or incomplete. You are responsible for reviewing them before relying on them or shipping them.

You are responsible for maintaining independent, tested backups and version
control of anything you value before allowing an Agent to operate on it.

## 8. Your Content

You retain all rights in Your Content. We claim no ownership of it.

The Software is local-first: Your Content is stored on your device, and
credentials are held in your operating system's keychain. We do not operate a
server that receives Your Content. See the
[Privacy Policy](PRIVACY.md) for detail.

## 9. Open-source components

The Software incorporates third-party open-source components, each licensed
under its own terms. Those terms apply to the components only and grant no
rights in the Software. Attribution is distributed with the Software in
`THIRD_PARTY_NOTICES.txt` and `LICENSES.chromium.html`, reachable from the Help
menu. A complete component list is available on request.

## 10. Feedback

If you send us suggestions or feedback, we may use them without restriction or
obligation to you. This does not give us any rights in Your Content.

## 11. Warranty disclaimer

To the fullest extent permitted by law, the Software is provided "as is" and
"as available", without warranty of any kind, whether express, implied, or
statutory, including implied warranties of merchantability, fitness for a
particular purpose, accuracy, and non-infringement.

We do not warrant that the Software will be uninterrupted or error-free, that it
will detect or prevent unintended Agent behaviour, or that any result produced
by an Agent will be correct, secure, or fit for your purpose.

Nothing in this section limits rights you have as a consumer that cannot
lawfully be excluded.

## 12. Limitation of liability

To the fullest extent permitted by law:

1. We are not liable for indirect, incidental, special, consequential, punitive, or exemplary damages, nor for lost profits, lost revenue, lost goodwill, lost or corrupted data or source code, business interruption, or the cost of substitute services, however caused and on any theory of liability.
2. Our total aggregate liability arising out of or relating to this Agreement or the Software is limited to the greater of (a) the fees you actually paid to us in the twelve months immediately before the event giving rise to the claim, or (b) `[DECIDE: floor amount, commonly USD 100]`.

These limits apply even if a remedy fails of its essential purpose and even if
we were advised of the possibility of the damage.

**Exclusions.** Nothing in this Agreement excludes or limits liability that
cannot lawfully be excluded, including liability for death or personal injury
caused by negligence, for fraud or fraudulent misrepresentation, for gross
negligence or wilful misconduct where such exclusion is prohibited, or for any
mandatory statutory consumer right.

You acknowledge that these limits are a reasonable allocation of risk, that they
reflect the subscription price, and that we would not provide the Software on
this pricing without them.

## 13. Indemnity

You will indemnify and hold us harmless against third-party claims, losses, and
reasonable costs arising from: your breach of this Agreement; your use of the
Software or any Agent in violation of law or of a third party's rights; or
changes an Agent made to systems, repositories, or data at your direction.

This section does not apply to consumers where prohibited by law.

## 14. Term, suspension, and termination

This Agreement runs while your Subscription is active. Either party may
terminate it: you by cancelling and uninstalling; we on written notice if you
materially breach it and do not cure the breach within 14 days of notice.

We may suspend access immediately where necessary to comply with law or to stop
active misuse.

On termination, your licence ends and you must stop using and uninstall the
Software. Sections 4, 9, 11, 12, 13, 15, and 16 survive.

## 15. Updates and changes

We may release updates that change, add, or remove features. We may change this
Agreement for future Subscription periods by giving reasonable notice; continuing
to use the Software after the change takes effect means you accept it. If you do
not accept it, cancel before it takes effect.

## 16. Governing law and disputes

This Agreement is governed by the laws of
`[DECIDE: governing law, e.g. India; or a US state such as Delaware]`, excluding
its conflict-of-laws rules and the UN Convention on Contracts for the
International Sale of Goods.

The courts of `[DECIDE: exclusive forum, e.g. the courts of Bengaluru, India]`
have exclusive jurisdiction, and both parties submit to that jurisdiction.

Before filing, the parties will attempt in good faith to resolve any dispute
informally for 30 days after written notice.

`[DECIDE: whether to add binding arbitration and a class-action waiver. These
are effective in some jurisdictions and unenforceable against consumers in
others.]`

**Consumer carve-out.** If you are a consumer, this section does not deprive you
of the protection of mandatory law in your country of residence, nor of the right
to bring proceedings in your local courts where that right cannot be excluded.

## 17. Export and sanctions

You confirm you are not located in, and will not use the Software in, a country
or by a party subject to applicable trade sanctions or export restrictions.

## 18. General

This Agreement is the entire agreement between us about the Software and
supersedes earlier discussions. If a provision is unenforceable, it is modified
to the minimum extent needed, or severed, and the rest remains in force. Our
failure to enforce a provision is not a waiver. You may not assign this
Agreement without our written consent; we may assign it as part of a merger,
acquisition, or sale of assets.

## 19. Contact

`[DECIDE: legal contact email, e.g. legal@builderhelm.app]`
