//! `browser-sidebar.tsx` (253 lines) — **cut for v1**.
//!
//! The Electron panel drove a `BrowserView` (localhost preview, recents,
//! stage-clipped bounds) over the single `browser.command` IPC method. P5-3
//! decided **cut**: no `wry` window, no embedded view. This placeholder keeps
//! the tab reachable so the surface is visibly unported, not silently gone.

use iced::widget::{column, container};
use iced::{Element, Fill};

use crate::routes::common::{body, card, eyebrow, h2};
use crate::tokens::WARNING;

pub fn view<'a, M: 'a>() -> Element<'a, M> {
    container(card(
        column![
            eyebrow("Browser"),
            h2("Cut for v1"),
            body(
                "The Electron BrowserView had no iced equivalent. The localhost \
                 preview panel is recorded as a known unported surface (P5-3, \
                 decided at the Gate 3 retro). Revisit after cutover.",
            ),
            container(
                iced::widget::text("Unported surface · P5-3")
                    .size(11.0)
                    .color(WARNING)
            )
            .padding([6, 10]),
        ]
        .spacing(10),
    ))
    .padding(12)
    .width(Fill)
    .height(Fill)
    .center_y(Fill)
    .into()
}
