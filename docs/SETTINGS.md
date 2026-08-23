# Settings

Intended settings information architecture. Nothing here is a shipping
promise except what [STATUS](STATUS.md) already implements (provider
credentials in Keychain).

Pricing, plan names, and credit amounts are **not confirmed**.

## Live today

Provider credentials. Keychain-backed. Fail closed on macOS.

## Intended later

| Section | Job |
| --- | --- |
| Account | Sign in on this device |
| Billing | Plan and credits. Do not collect payment until wired |
| Appearance | Dark/light, accent, zoom, terminal theme |
| Shortcuts | Rebindable. Seed list in [UX](UX.md) |
| Notifications | Per role |
| Mobile | Phone companion. Desktop stays the engine. QR pair on LAN |
| Agents & AI | Detected CLIs, Swarm guardrails |
| AI accounts | Link existing provider accounts. Secrets still in Keychain |
| MCP | Tools agents may call, same permission engine |
| Skills | Push/pull skill packs |
| Autocomplete | Local terminal suggestions |
| Assistant | Bridge voice. Credits. Not in the Space slice |
| System | API keys for programmatic access |
| About | Version and updates |

The mobile app is a pairing companion, not a second BuilderHelm. See [STACK](STACK.md).
