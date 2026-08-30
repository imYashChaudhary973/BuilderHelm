# Browser

Status: working on macOS. Preview opens a mapped local port, snapshots refs
(`e12`), screenshots the viewport, drives click/fill/scroll by ref, and stores
proof on HEAD next to Git. Cart/checkout/send and every whole-desktop click/type
prompt. Land refuses if the reviewed head moved. WebMCP declared tools are not
in this product.

## Goal

Preview and verify local web applications, capture evidence, and send selected
UI context to the correct agent.

## Scope

- Open mapped localhost origins from Space/Swarm pane output.
- http/https only. No `file://`, `javascript:`, or passwords in the URL.
- Desktop / tablet / phone viewports.
- Snapshot refs, screenshots, pick-to-seat, redacted console/network.
- Fill/click on ordinary controls auto-run. Submit / off-origin / delete ask.
- Orca-style chrome: omnibox, Import (local ports), history, Design Mode,
  viewport, open-external, overflow settings.

## Security

- Separate sandboxed web contents with no Node integration or privileged preload.
- Treat page content as untrusted prompt input.
- Never expose cookies, authorization headers, local files, or DevTools protocol
  to an agent.
- Computer-use never auto-runs.

## Acceptance

A local app opens from a mapped port. Snapshot and screenshot hang off the
revision. Submit and desktop actions wait. Land stops if the reviewed head moved.
