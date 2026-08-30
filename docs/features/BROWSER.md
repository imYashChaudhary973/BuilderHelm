# Browser

Status: working on macOS. The preview panel opens a mapped local port in a
sandboxed `WebContentsView`, drives it by ref, grabs and annotates elements,
marks up screenshots, and stores proof on HEAD next to Git. Cart/checkout/send
prompt. Land refuses if the reviewed head moved. WebMCP declared tools are not
in this product.

## Goal

Preview and verify local web applications, capture evidence, and send selected
UI context to the correct agent.

## Toolbar

Back · Forward · Reload · address field · Import · Grab · Annotate · Draw ·
DevTools · Open in default browser · ⋯

- The address field takes a URL or a search phrase. Host-shaped input navigates;
  anything else is encoded onto the configured search engine. Focus selects the
  URL, Enter navigates, Escape restores the current one.
- Import lists localhost origins seen in Space and Swarm pane output.
- Grab captures one element: role, accessible name, a CSS locator, its rect, the
  redacted page URL, and a cropped screenshot. Never markup, field values, or
  password contents.
- Annotate adds a note to an element, pins it on the page, and stores the note,
  geometry, and capture against the revision.
- Draw captures the page and opens a canvas editor: pen, colour, width, undo,
  clear, save, cancel. The live view is hidden, not reloaded, so closing the
  editor returns the same document at the same scroll offset.
- DevTools opens the previewed page's own inspector, detached.
- ⋯ holds the profile list, New Profile, Import Cookies, Viewport Size, and
  Browser Settings. These are native menus: the embedded page composites above
  renderer DOM, so an HTML popover anchored in the toolbar would be unclickable.
- Below roughly 520px of panel width the toolbar wraps instead of clipping.

## Viewports and zoom

Desktop fills the panel. Tablet and phone letterbox to their preset and scale
so CSS still reports 768px / 390px — a phone preview reports 390px, not the
panel width. The zoom preference multiplies on top.

## Profiles, cookies, and links

- Each profile owns a persistent Electron partition, so cookies and cache are
  isolated. Switching profiles recreates the view before navigating.
- Cookie import is a main-process file picker over one documented JSON export,
  bounded by file size and item count, validated per cookie, and confirmed
  against a domain and count summary. Cookie values never cross IPC, and there
  is no export path.
- Link routing decides whether http(s) links from the terminal, markdown, and
  the editor open here or in the system browser; ⇧⌘-click always uses the system
  browser. Terminal link actions offer both destinations per click.

## Security

- Separate sandboxed web contents per profile, with no Node integration or
  privileged preload.
- http/https only. No `file://`, `javascript:`, or passwords in the URL.
- Page content is untrusted input. Injected scripts run in an isolated world and
  return role, name, locator, and geometry only.
- Permission requests are denied. Cookies, authorization headers, local files,
  and the DevTools protocol are never exposed to an agent.
- Whole-desktop computer-use remains permissioned in the main process and has no
  entry point in this toolbar.

## Acceptance

A local app opens from a mapped port. Snapshot, screenshot, annotation, and
markup hang off the revision. Submit and desktop actions wait. Land stops if the
reviewed head moved.
