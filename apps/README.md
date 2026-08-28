# Applications

Applications are deployable BuilderHelm surfaces. Shared domain and protocol
logic belongs in `packages/`, not copied between apps.

| Application | Status           | Purpose                                                      |
| ----------- | ---------------- | ------------------------------------------------------------ |
| `desktop`   | Working on macOS | Electron host and primary React UI                           |
| `mobile`    | Planned          | React Native iOS/Android remote-control client               |
| `relay`     | Planned          | Optional encrypted connection relay; never an execution host |
| `cli`       | Planned          | BuilderHelm host/controller command-line client              |
