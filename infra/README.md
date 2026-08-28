# Infrastructure

Deployable infrastructure belongs here only when BuilderHelm operates a real
service such as the optional relay. Local desktop development has no required
cloud dependency.

Infrastructure changes must document cost, environments, secrets, ownership,
rollback, observability, retention, and failure behavior. No production
resource is created from repository setup scripts.
