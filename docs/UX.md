# UX

Intended interface. [STATUS](STATUS.md) is what the code renders today.

## 1. Home

Centered, quiet. Small header. Name and logo in the middle.

1. Helm mark.
2. **BuilderHelm**
3. Tagline: **Your agents. You at the helm.**
4. Heading: **Choose how you want to work.**
5. Four mode cards, each with the promise from [PRODUCT](PRODUCT.md) and
   the shortcut on the right: Space ⌘T, Swarm ⌘S, Board ⌘B, Memory ⌘M.

Pressing Space starts the workspace wizard.

## 2. Space — set up your workspace

Heading: **Set up your workspace.**
Lede: Pick a folder to work in and choose how many terminals you want.

### Working folder

Where terminals start.

- Default: the signed-in macOS home directory (`/Users/<name>`).
- Browse / change folder.
- Path is visible and editable.

### How many terminals

Tap a tile. Allowed counts: **1, 2, 4, 6, 8, 10, 12**.

### Recents

Recent workspaces opened in this app (folder + layout). One click restores
folder and pane count.

### Presets

Saved folder + pane count + agent assignment.

### Footer

- Left: **Back** to the four-mode home.
- Right: **Open without AI** · **Next: Add AI agents**.

## 3. Space — add AI agents

Heading: **Add AI coding agents.**
Lede: Pick which agents launch in your terminals, or skip this step.

Catalog (detect on PATH): Claude, Codex, Grok, Gemini, Antigravity,
OpenCode, Cursor, Copilot, Oh My Pi, custom command.

## 4. Live Space

A grid of terminals. Click a pane, type, work.

Each pane is a PTY in the workspace folder, or in its own `exeum/*`
worktree when isolation is on. Land preview + merge stays on the pane.

## 5. App chrome (every mode)

### Top bar

Navigation: Space · Swarm · Board · Memory · Skills · Settings.

### Left rail

Stacked workspaces. Opening another Space piles it here. Click to switch.

### Right sidebar (not built)

| Panel | Job |
| ----- | --- |
| Browser | Preview localhost, docs, or any URL without leaving Exeum |
| Editor | Drag-and-drop a file or pick one from the tree |
| Git | Staged changes, history |
| Skills | Built-in and user skills |

## 6. Other modes (not Space)

**Swarm**, **Board** (Kanban), and **Memory** are not built. Today's
Obsidian retrieval is a seed for Memory, not that surface.

## 7. Shortcuts

Home cards use Space ⌘T, Swarm ⌘S, Board ⌘B, Memory ⌘M. Other defaults
stay unpainted until they are wired. Do not show unused keybindings.
