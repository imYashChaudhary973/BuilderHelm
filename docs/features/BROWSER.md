# Browser

Status: planned; the current sidebar is not a complete browser product.

## Goal

Preview and verify web applications, capture evidence, and send selected UI
context to the correct agent.

## V1 scope

- Open mapped localhost previews and approved HTTPS pages.
- Back, forward, reload, address, viewport presets, and tab state.
- Inspect console errors and relevant network failures.
- Click, type, fill, select, scroll, and capture screenshots.
- Select a visible element and produce bounded DOM, accessibility, style, and screenshot context.
- Attach verification evidence to a run or review.

## Security

- Separate sandboxed web contents with no Node integration or privileged preload.
- Allowlist navigation, permissions, downloads, new windows, and external links.
- Treat page content as untrusted prompt input.
- Never expose cookies, authorization headers, local files, or arbitrary DevTools protocol access to an agent.

## Acceptance

A local app can be opened, interacted with, inspected, screenshotted, and linked
to a run without granting the page or agent desktop privileges.
