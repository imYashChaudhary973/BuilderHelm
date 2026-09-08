# Relay

Status: specified, not implemented. Direct loopback / private-network pairing
is the supported path. Do not build this service until a host cannot accept a
direct connection and that demand is explicit.

## Endpoint identity

A relay is a named TCP/TLS listener with its own Ed25519 identity. Clients and
hosts pin that public key (or the TLS certificate fingerprint derived from it)
before sending any frame. A hostname without a pinned key is not an endpoint.

## End-to-end encryption

Pairing still happens between companion and host. The session key from pairing
never leaves those two parties. The relay forwards sealed `v=1` frames only.
It cannot open AES-GCM payloads, cannot see provider credentials, and must not
store repositories, tokens, or terminal history.

A relay that terminates TLS and re-encrypts toward the host is a man in the
middle, not this design.

## Traffic

Bounded frames. Duplicate `command.id` values are still ignored by the host.
Revoked sessions fail on the host; the relay has no authorization role.

## Non-goals

- User credential storage
- Shell, filesystem, or model execution
- Automatic fallback from LAN to relay
