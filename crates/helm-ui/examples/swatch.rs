//! Token swatch. Compare hex labels to Electron `:root` in styles.css.
//! Bevel row matches `docs/spikes/p07-bevel.png`.
//!
//! `cargo run -p helm-ui --example swatch`

use helm_ui::{
    bevel_3d_style, bevel_inset, card_style, ease, helm_theme, shadow_float, ACCENT, ACCENT_BRIGHT,
    ACCENT_DIM, ACCENT_LINE, BEVEL_3D, BEVEL_3D_PRESSED, BEVEL_INSET, BG, BG_1, DANGER, DANGER_DIM,
    EASE_3D, EASE_OUT, FONT_MONO, FONT_SANS, GLASS, GLASS_STRONG, LINE, LINE_STRONG, PANEL,
    RADIUS_L, RADIUS_M, RADIUS_S, SHADOW_CARD, SHADOW_FLOAT, TEXT, TEXT_2, TEXT_3, WARNING,
};
use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Color, Element, Fill, Size, Theme};

fn chip<'a>(name: &'static str, css: &'static str, color: Color) -> Element<'a, ()> {
    row![
        container(Space::new().width(48).height(28)).style(move |_| container::Style {
            background: Some(color.into()),
            border: iced::Border {
                radius: iced::border::Radius::new(6.0),
                color: LINE_STRONG,
                width: 1.0,
            },
            ..container::Style::default()
        }),
        column![
            text(name).size(13).color(TEXT),
            text(css).size(11).color(TEXT_3),
        ]
        .spacing(2),
    ]
    .spacing(10)
    .align_y(iced::Alignment::Center)
    .into()
}

fn new() {}

fn update(_state: &mut (), _message: ()) {}

fn theme(_state: &()) -> Theme {
    helm_theme()
}

fn view(_state: &()) -> Element<'_, ()> {
    let colours = column![
        text("Colours").size(18).color(ACCENT_BRIGHT),
        chip("--bg", "#080a07", BG),
        chip("--bg-1", "#0d100a", BG_1),
        chip("--panel", "#11150d", PANEL),
        chip("--glass", "rgba(20,24,16,0.55)", GLASS),
        chip("--glass-strong", "rgba(26,30,20,0.78)", GLASS_STRONG),
        chip("--line", "rgba(255,255,255,0.07)", LINE),
        chip("--line-strong", "rgba(255,255,255,0.13)", LINE_STRONG),
        chip("--text", "#eef1e4", TEXT),
        chip("--text-2", "#a8b09c", TEXT_2),
        chip("--text-3", "#6f7767", TEXT_3),
        chip("--accent", "#b6d475", ACCENT),
        chip("--accent-bright", "#d3ef9c", ACCENT_BRIGHT),
        chip("--accent-dim", "rgba(182,212,117,0.12)", ACCENT_DIM),
        chip("--accent-line", "rgba(182,212,117,0.35)", ACCENT_LINE),
        chip("--danger", "#ff8f73", DANGER),
        chip("--danger-dim", "rgba(255,143,115,0.12)", DANGER_DIM),
        chip("--warning", "#f2c94c", WARNING),
    ]
    .spacing(8);

    let radii = column![
        text("Radii / spacing").size(18).color(ACCENT_BRIGHT),
        text(format!(
            "--radius-s {RADIUS_S}px · --radius-m {RADIUS_M}px · --radius-l {RADIUS_L}px"
        ))
        .color(TEXT_2)
        .size(13),
        text("--ease-out cubic-bezier(0.22, 1, 0.36, 1)")
            .color(TEXT_2)
            .size(13),
        text("--ease-3d cubic-bezier(0.32, 0.72, 0, 1)")
            .color(TEXT_2)
            .size(13),
        text(format!("--font-mono {FONT_MONO}"))
            .color(TEXT_3)
            .size(12),
        text(format!("font-sans {FONT_SANS}"))
            .color(TEXT_3)
            .size(12),
        text(format!(
            "ease-out@0.5={:.2} ease-3d@0.5={:.2}",
            ease(0.5, EASE_OUT),
            ease(0.5, EASE_3D)
        ))
        .color(TEXT_2)
        .size(13),
    ]
    .spacing(6);

    let bevels = column![
        text("Bevels (layered containers, P0-7)")
            .size(18)
            .color(ACCENT_BRIGHT),
        text(format!(
            "--bevel-3d {} layers · --bevel-3d-pressed {} · --bevel-inset {} · --shadow-card {} · --shadow-float drop",
            BEVEL_3D.len(),
            BEVEL_3D_PRESSED.len(),
            BEVEL_INSET.len(),
            SHADOW_CARD.len()
        ))
        .color(TEXT_2)
        .size(13),
        text("Compare to docs/spikes/p07-bevel.png and Electron styles.css :root")
            .color(TEXT_3)
            .size(12),
        row![
            column![
                text("inset well").size(12).color(TEXT_3),
                bevel_inset(220.0, 36.0, RADIUS_S),
            ]
            .spacing(6),
            column![
                text("raised").size(12).color(TEXT_3),
                container(Space::new().width(120).height(32)).style(|_| bevel_3d_style(false)),
            ]
            .spacing(6),
            column![
                text("pressed").size(12).color(TEXT_3),
                container(Space::new().width(120).height(32)).style(|_| bevel_3d_style(true)),
            ]
            .spacing(6),
            column![
                text("card / float").size(12).color(TEXT_3),
                container(Space::new().width(120).height(48)).style(|_| {
                    let mut style = card_style();
                    style.shadow = shadow_float();
                    let _ = SHADOW_FLOAT;
                    style
                }),
            ]
            .spacing(6),
        ]
        .spacing(16),
    ]
    .spacing(10);

    container(
        scrollable(
            column![colours, radii, bevels]
                .spacing(28)
                .padding(24)
                .width(Fill),
        )
        .width(Fill)
        .height(Fill),
    )
    .width(Fill)
    .height(Fill)
    .style(|_| container::Style {
        background: Some(BG.into()),
        ..container::Style::default()
    })
    .into()
}

fn main() -> iced::Result {
    iced::application(new, update, view)
        .theme(theme)
        .window_size(Size::new(720.0, 900.0))
        .run()
}
