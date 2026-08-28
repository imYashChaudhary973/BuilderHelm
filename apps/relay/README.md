# Relay

Planned optional TypeScript/Node.js service for connecting authenticated mobile
clients to hosts that cannot accept a direct connection.

The relay carries encrypted, bounded frames. It does not store repositories,
provider credentials, raw terminal history, or execute agent commands. Direct
local/private-network connections are implemented before this service.
