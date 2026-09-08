# Mobile application

React Native companion for iOS and Android. It remotely observes and directs a
paired BuilderHelm host. It does not run coding CLIs, repositories, Git,
terminals, browsers, or provider credentials locally.

Protocol and session logic live in `src/`. Pairing uses the host's short-lived
code over loopback or a private network. There is no relay in this phase.
Metro / Xcode / Gradle are not wired; the companion is TypeScript source plus
host tests.

See `docs/features/MOBILE.md` and `docs/features/remote.md`.
