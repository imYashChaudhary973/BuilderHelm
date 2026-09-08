# Release and platform support

Status: macOS arm64 packaged dir is the only exercised distribution. Signing,
notarization, auto-update, Windows installers, and Linux packages are labeled
here, not implied by `pnpm build`.

## macOS (9.1)

- Package: `pnpm dist` → unsigned `dist/mac-arm64/BuilderHelm.app` (`--publish never`, `identity: null`).
- Smoke: unpackaged `pnpm smoke:desktop`; packaged `pnpm smoke:packaged` after `pnpm dist`.
- Native modules (`node-pty`, Keychain, sherpa) unpack from asar. Attribution is in `Contents/Resources/THIRD_PARTY_NOTICES.txt`.
- Microphone permission string is declared. Other TCC prompts appear when the OS requires them.
- Crash recovery: Swarm interrupted runs are reconciled at startup; dirty worktrees are kept.
- Signing/notarization: uses the publisher's Apple credentials and an explicit release approval. This tree does not sign.
- Updates: none. The Settings toggle stays off until a signed channel exists.

## Windows (9.2)

Code covers ConPTY-friendly shells (`ComSpec`), case-insensitive `Path`, `PATHEXT`, drive-letter roots, argument-array spawn (`windowsHide`, no shell), process-tree `taskkill /T`, and Windows Credential Manager via `@napi-rs/keyring`.

**Not exercised on this host:** NSIS/Squirrel installers, a packaged `.exe` smoke, real ConPTY, or Credential Manager.

## Linux (9.3)

Code covers `/bin/bash` fallback, `X_OK` discovery, `DISPLAY` / `WAYLAND_DISPLAY` passthrough, `chmod 0755` on the PTY helper, and libsecret through `@napi-rs/keyring`.

**Not exercised on this host:** AppImage/deb, Wayland/X11 windowing, or a live Secret Service.

## Performance (9.4)

Swarm advertised builder cap stays **2** (hard max 4). Raise it only after a measured 1/2/4/8-run session. Cancellation of 1/2/4/8 owned processes is fixture-tested. Terminal backpressure was already measured on macOS at 1–12 panes.

## Release operations (9.5)

- Attribution: `pnpm notices` / CI licence check. No telemetry (`pnpm check:telemetry`).
- Supported runtimes: [runtime-matrix.md](runtime-matrix.md).
- Before migrations, the host copies `builderhelm.sqlite` (+ WAL/SHM) to `builderhelm.sqlite.bak`.
- Downgrade: restore the `.bak` over the live file. There is no reverse-migration.
- Diagnostics: Settings → General → Export diagnostics. Redacted JSON only (platform, schema, cap, recent logs). No database dump, no Keychain.

## Real-agent packaged checks

Codex ACP was verified in the running desktop, not in the packaged unsigned app. Packaged real-agent click-through remains unexercised.
