# Terminal

Status: xterm.js and node-pty working; sustained-output optimization remains.

## Decision

BuilderHelm uses xterm.js for terminal emulation and rendering and node-pty for
local terminal processes. The experience is Ghostty-inspired, but Ghostty is not
embedded and is not a runtime dependency.

```text
shell or agent -> node-pty -> bounded events -> xterm.js -> React pane
```

## V1 scope

- Full-color interactive terminal input and output.
- Resize, focus, copy, search, links, theme, font, and bounded scrollback.
- Snapshot/reconnect support without replaying unbounded output.
- Multiple visible panes with predictable CPU and memory use.
- Optional WebGL rendering only after multi-pane measurement and fallback handling.

## Performance rules

- Batch output rather than IPC every tiny chunk.
- Apply backpressure and cap pending bytes.
- Keep one bounded output representation; avoid repeated whole-buffer concatenation.
- Do not run blocking terminal parsing in Electron main.
- Handle context loss if WebGL is enabled.
- Prefer a fast non-login shell when an agent does not require interactive startup files.

## Acceptance

The 12-pane benchmark records spawn, first byte, ready, warm round trip,
throughput, memory growth, resize, cleanup, and orphan-process count. User-visible
correctness includes Unicode, color, cursor, scrollback, resize reflow, and paste.
