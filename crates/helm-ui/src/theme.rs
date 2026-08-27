use iced::{theme::Palette, Theme};

use crate::tokens::{ACCENT, BG, DANGER, TEXT, WARNING};

pub fn helm_palette() -> Palette {
    Palette {
        background: BG,
        text: TEXT,
        primary: ACCENT,
        success: ACCENT,
        warning: WARNING,
        danger: DANGER,
    }
}

pub fn helm_theme() -> Theme {
    Theme::custom("BuilderHelm", helm_palette())
}
