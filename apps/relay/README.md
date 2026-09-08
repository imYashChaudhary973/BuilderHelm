# Relay

Specified optional TypeScript/Node.js service for connecting authenticated
mobile clients to hosts that cannot accept a direct connection. Not implemented.

The relay would carry encrypted, bounded frames after both sides pin the
relay's Ed25519/TLS identity. It must not store repositories, provider
credentials, raw terminal history, or execute agent commands. Direct
local/private-network connections come first.

See `docs/features/relay.md`.
