//! P4-5 tools-panel sidebars: `editor-sidebar.tsx`, `git-sidebar.tsx`,
//! `browser-sidebar.tsx`.
//!
//! The browser panel is **cut for v1** (P5-3, decided at the Gate 3 retro on
//! 2026-08-27): `browser.rs` is the recorded placeholder. `agent-mark.tsx`
//! needs per-agent SVG brand marks and is not ported — the `svg` iced feature
//! is not enabled; Space uses plain accent tiles instead.

pub mod browser;
pub mod editor;
pub mod git;
