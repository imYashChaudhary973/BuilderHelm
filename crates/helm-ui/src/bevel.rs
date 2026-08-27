use iced::border::Radius;
use iced::widget::{container, stack, Space};
use iced::{Border, Color, Element, Fill, Shadow};

use crate::tokens::{
    outer_drop, ShadowLayer, ACCENT, BEVEL_3D, BEVEL_3D_PRESSED, BEVEL_INSET, RADIUS_S,
    SHADOW_CARD, SHADOW_FLOAT,
};

fn radius(v: f32) -> Radius {
    Radius::new(v)
}

fn fill(color: Color, r: f32) -> container::Style {
    container::Style {
        background: Some(color.into()),
        border: Border {
            radius: radius(r),
            ..Border::default()
        },
        ..container::Style::default()
    }
}

fn inset_bar(color: Color, r: Radius) -> container::Style {
    container::Style {
        background: Some(color.into()),
        border: Border {
            radius: r,
            ..Border::default()
        },
        ..container::Style::default()
    }
}

/// Recessed well: `--bevel-inset` as stacked quads (P0-7).
pub fn bevel_inset<'a, Message: 'a>(width: f32, height: f32, r: f32) -> Element<'a, Message> {
    let well = container(Space::new().width(Fill).height(Fill))
        .width(width)
        .height(height)
        .style(move |_| {
            fill(
                Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.06,
                },
                r,
            )
        });
    let top = BEVEL_INSET[0];
    let bottom = BEVEL_INSET[1];
    let inset_top = container(Space::new().width(Fill).height(top.blur.min(height)))
        .width(width)
        .height(top.blur.clamp(1.0, 2.0))
        .style(move |_| {
            inset_bar(
                top.color,
                Radius {
                    top_left: r,
                    top_right: r,
                    bottom_right: 0.0,
                    bottom_left: 0.0,
                },
            )
        });
    let inset_bottom = container(Space::new().width(Fill).height(1.0))
        .width(width)
        .style(move |_| {
            inset_bar(
                bottom.color,
                Radius {
                    top_left: 0.0,
                    top_right: 0.0,
                    bottom_right: r,
                    bottom_left: r,
                },
            )
        });
    stack![
        well,
        inset_top,
        container(inset_bottom)
            .width(width)
            .height(height)
            .align_y(iced::Alignment::End),
    ]
    .width(width)
    .height(height)
    .into()
}

/// Raised chrome: `--bevel-3d` outer drop + inner highlight/shade.
pub fn bevel_3d_style(pressed: bool) -> container::Style {
    let layers: &[ShadowLayer] = if pressed { BEVEL_3D_PRESSED } else { BEVEL_3D };
    let drop = layers
        .iter()
        .copied()
        .find(|layer| !layer.inset)
        .unwrap_or(SHADOW_FLOAT);
    container::Style {
        background: Some(ACCENT.into()),
        border: Border {
            radius: radius(RADIUS_S),
            color: Color {
                r: ACCENT.r,
                g: ACCENT.g,
                b: ACCENT.b,
                a: 0.55,
            },
            width: 1.0,
        },
        shadow: outer_drop(drop),
        ..container::Style::default()
    }
}

pub fn shadow_float() -> Shadow {
    outer_drop(SHADOW_FLOAT)
}

pub fn shadow_card_drop() -> Shadow {
    outer_drop(SHADOW_CARD[1])
}

pub fn card_style() -> container::Style {
    container::Style {
        background: Some(crate::tokens::PANEL.into()),
        border: Border {
            radius: radius(RADIUS_S),
            color: crate::tokens::LINE,
            width: 1.0,
        },
        shadow: shadow_card_drop(),
        ..container::Style::default()
    }
}
