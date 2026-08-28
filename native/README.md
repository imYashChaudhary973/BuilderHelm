# Native adapters

This directory is reserved for narrowly scoped operating-system integration
that cannot live in TypeScript or an existing maintained Node dependency.

It is not a second product core. Do not add Rust, a native UI, terminal
emulator, database implementation, orchestration engine, or duplicated domain
logic here. Every addition requires an ADR, platform matrix, packaging plan,
and fallback behavior.
