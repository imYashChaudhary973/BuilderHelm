//! `components/coming-soon.tsx`. Used by the agent / code / chat stubs.
//!
//! `SignalField` is deliberately absent: P4-2 dropped it (permanent rAF spin).

use iced::border::Radius;
use iced::widget::{column, container, row, text, Space};
use iced::{Border, Element};

use super::common::{h1, stage};
use crate::tokens::{ACCENT, TEXT, TEXT_2};

pub fn view<'a, M: 'a>(_title_id: &'static str) -> Element<'a, M> {
    stage(
        column![
            brand(),
            h1("Your agents.\nYou at the helm."),
            text("Coming soon").size(15).color(TEXT_2),
        ]
        .spacing(16)
        .align_x(iced::Alignment::Center),
    )
}

fn brand<'a, M: 'a>() -> Element<'a, M> {
    row![
        container(Space::new().width(56).height(56)).style(|_| container::Style {
            background: Some(ACCENT.into()),
            border: Border {
                radius: Radius::new(14.0),
                ..Border::default()
            },
            ..container::Style::default()
        }),
        text("BuilderHelm").size(20).color(TEXT),
    ]
    .spacing(12)
    .align_y(iced::Alignment::Center)
    .into()
}
