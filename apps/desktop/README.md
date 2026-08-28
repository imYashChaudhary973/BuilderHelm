# Desktop application

The desktop app is the BuilderHelm execution host and primary client.

```text
src/main/       privileged Electron lifecycle and adapters
src/preload/    narrow validated renderer bridge
src/renderer/   React/Vite product UI
test/           focused Electron and integration tests
```

The renderer is sandboxed and must not import filesystem, process, database, or
Electron main APIs. Terminal processes are owned by `node-pty`; xterm.js renders
their bounded event stream.
