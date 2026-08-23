# Stack decision

Last decided: 2026-08-23. Revisit only if desktop PTY cannot ship on Windows/Linux,
or if the phone companion needs a shared native engine (it does not today).

## Decision

**TypeScript is the product language.** Desktop stays Electron. Phone pairing is a
separate TypeScript app that talks to the desktop over the existing protocol.
Do not rewrite Exeum in Rust.

## Why not rewrite

Exeum is a desktop harness: React chrome, xterm, node-pty, SQLite, typed IPC,
provider HTTP. That is already the product. A Rust rewrite buys memory safety
and cheaper PTY/Git later. It costs the current Space loop and every Electron
lesson just paid for.

Bun's 2026 Zig → Rust rewrite is real ([bun.com/blog/bun-in-rust](https://bun.com/blog/bun-in-rust)):
~535k lines, 11 days, ~$165k API spend, 64 agents, a language-independent test
suite with a million assertions. Bun is a runtime with that suite. Exeum is an
unfinished UI product. Same method here would rewrite the wrong thing, with
nothing like that test surface to catch "looks compiled, terminals still dead."

## Platforms

| Surface | Now | Later |
| --- | --- | --- |
| macOS desktop | Electron + TypeScript. Supported. | Same. |
| Windows / Linux desktop | Same repo. node-pty uses ConPTY on Windows. Not verified yet. | Same Electron binary. Fix PTY/env/rebuild per OS. Do not fork the UI. |
| iOS / Android | Not built. | Pairing companion only. Not a second Exeum. |

The phone is a remote: start/stop a Space, see status, maybe a read-only
terminal stream. PTY, Git, Keychain, and model keys stay on the desktop.
That is pairing, not a port.

## Phone stack

When pairing starts: **Expo / React Native in TypeScript**. Share
`packages/protocol` types over HTTPS/LAN. Do not put Electron, node-pty, or
the Keychain service on the phone.

Tauri 2 can target iOS and Android. Skip it for pairing. You would add Rust
plus Swift/Kotlin plugins to ship a viewer. React Native matches the language
already in this repo.

## When Rust is allowed

A small sidecar later, not a rewrite:

- PTY host if Electron + node-pty stays broken on Windows after a real attempt
- git / search if the JS process is the measured bottleneck

Talk to it over stdio or a socket. UI stays TypeScript. Do not start a Tauri
app until Electron cannot ship Windows/Linux.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Full Rust + Tauri rewrite | Rebuilds Space, xterm, IPC, Keychain. Months. |
| Flutter / Swift / Kotlin as the desktop | Second UI. No gain for a web-shaped harness. |
| One Tauri binary for desktop + phone | Phone does not need the desktop engine. |

## Rule

New code is TypeScript unless it is a named sidecar above. Do not add a second
desktop shell.
