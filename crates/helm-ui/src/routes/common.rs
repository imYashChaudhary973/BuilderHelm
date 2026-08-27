//! Shared route vocabulary. One definition per `styles.css` primitive so the
//! 12 routes do not each invent a card.

use iced::border::Radius;
use iced::gradient::Linear;
use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Border, Color, Element, Fill, Padding, Radians, Shadow, Vector};

use crate::tokens::{
    rgba, ACCENT, ACCENT_BRIGHT, ACCENT_DIM, ACCENT_LINE, BG, BG_1, DANGER, DANGER_DIM, GLASS,
    LINE, LINE_STRONG, PANEL, RADIUS_M, RADIUS_S, TEXT, TEXT_2, TEXT_3,
};

pub const H1: f32 = 34.0;
pub const H2: f32 = 22.0;
pub const H3: f32 = 16.0;
pub const BODY: f32 = 13.0;
pub const SMALL: f32 = 12.0;
pub const TINY: f32 = 11.0;

/// `.primaryButton` ink. CSS `#11150b`.
pub const ON_ACCENT: Color = crate::tokens::rgb(0x11150b);

pub fn eyebrow<'a, M: 'a>(label: &str) -> Element<'a, M> {
    text(label.to_uppercase())
        .size(TINY)
        .color(ACCENT)
        .font(iced::font::Font {
            weight: iced::font::Weight::Semibold,
            ..iced::font::Font::DEFAULT
        })
        .into()
}

pub fn h1<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    text(value)
        .size(H1)
        .color(TEXT)
        .font(iced::font::Font {
            weight: iced::font::Weight::Bold,
            ..iced::font::Font::DEFAULT
        })
        .into()
}

pub fn h2<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    text(value)
        .size(H2)
        .color(TEXT)
        .font(iced::font::Font {
            weight: iced::font::Weight::Semibold,
            ..iced::font::Font::DEFAULT
        })
        .into()
}

pub fn h3<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    text(value)
        .size(H3)
        .color(TEXT)
        .font(iced::font::Font {
            weight: iced::font::Weight::Semibold,
            ..iced::font::Font::DEFAULT
        })
        .into()
}

/// `.lede` — 8px top margin, `--text-2`, 560px cap.
pub fn lede<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    container(text(value).size(BODY).color(TEXT_2))
        .max_width(560)
        .into()
}

pub fn body<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    text(value).size(BODY).color(TEXT_2).into()
}

pub fn dim<'a, M: 'a>(value: impl text::IntoFragment<'a>) -> Element<'a, M> {
    text(value).size(SMALL).color(TEXT_3).into()
}

/// `.sectionHeading` — title left, pill badge right.
pub fn section_heading<'a, M: 'a>(title: &'a str, badge: Option<String>) -> Element<'a, M> {
    let mut items: Vec<Element<'a, M>> = vec![h3(title), Space::new().width(Fill).into()];
    if let Some(badge) = badge {
        items.push(pill(badge));
    }
    row(items)
        .spacing(16)
        .align_y(iced::Alignment::Center)
        .into()
}

/// `.sectionHeading > span` — glass pill.
pub fn pill<'a, M: 'a>(label: impl text::IntoFragment<'a>) -> Element<'a, M> {
    container(text(label).size(SMALL).color(TEXT_2))
        .padding(Padding {
            top: 4.0,
            right: 10.0,
            bottom: 4.0,
            left: 10.0,
        })
        .style(|_| container::Style {
            background: Some(GLASS.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(999.0),
            },
            ..container::Style::default()
        })
        .into()
}

fn btn_base() -> Padding {
    Padding {
        top: 9.0,
        right: 16.0,
        bottom: 9.0,
        left: 16.0,
    }
}

/// `.primaryButton` — accent gradient, dark ink, lime glow.
pub fn primary_button<'a, M: 'a + Clone>(label: &'a str, msg: Option<M>) -> Element<'a, M> {
    let enabled = msg.is_some();
    button(text(label).size(BODY).color(ON_ACCENT))
        .padding(btn_base())
        .on_press_maybe(msg)
        .style(move |_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            let fill = Linear::new(Radians(std::f32::consts::PI))
                .add_stop(0.0, ACCENT_BRIGHT)
                .add_stop(1.0, ACCENT);
            button::Style {
                background: Some(fill.into()),
                text_color: ON_ACCENT.scale_alpha(if enabled { 1.0 } else { 0.55 }),
                border: Border {
                    color: rgba(255, 255, 255, 0.22),
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: Shadow {
                    color: rgba(182, 212, 117, if hover { 0.55 } else { 0.45 }),
                    offset: Vector::new(0.0, if hover { 16.0 } else { 10.0 }),
                    blur_radius: if hover { 34.0 } else { 28.0 },
                },
                snap: true,
            }
        })
        .into()
}

/// `.secondaryButton` — glass, `--text`, card shadow.
pub fn secondary_button<'a, M: 'a + Clone>(label: &'a str, msg: Option<M>) -> Element<'a, M> {
    button(text(label).size(BODY))
        .padding(btn_base())
        .on_press_maybe(msg)
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { LINE } else { GLASS }.into()),
                text_color: TEXT,
                border: Border {
                    color: if hover { LINE_STRONG } else { LINE },
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: crate::bevel::shadow_card_drop(),
                snap: true,
            }
        })
        .into()
}

/// `.stopButton` — danger outline.
pub fn stop_button<'a, M: 'a + Clone>(label: &'a str, msg: Option<M>) -> Element<'a, M> {
    button(text(label).size(BODY))
        .padding(btn_base())
        .on_press_maybe(msg)
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { DANGER_DIM } else { GLASS }.into()),
                text_color: DANGER,
                border: Border {
                    color: rgba(255, 143, 115, 0.35),
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.dangerButton` — solid danger.
pub fn danger_button<'a, M: 'a + Clone>(label: &'a str, msg: Option<M>) -> Element<'a, M> {
    button(text(label).size(BODY).color(crate::tokens::rgb(0x1a0f0a)))
        .padding(btn_base())
        .on_press_maybe(msg)
        .style(|_, _| button::Style {
            background: Some(DANGER.into()),
            text_color: crate::tokens::rgb(0x1a0f0a),
            border: Border {
                color: rgba(255, 255, 255, 0.18),
                width: 1.0,
                radius: Radius::new(RADIUS_S),
            },
            shadow: Shadow::default(),
            snap: true,
        })
        .into()
}

/// `.textButton` — glass, no emphasis.
pub fn text_button<'a, M: 'a + Clone>(label: &'a str, msg: Option<M>) -> Element<'a, M> {
    button(text(label).size(SMALL))
        .padding(Padding {
            top: 6.0,
            right: 10.0,
            bottom: 6.0,
            left: 10.0,
        })
        .on_press_maybe(msg)
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { LINE } else { GLASS }.into()),
                text_color: if hover { TEXT } else { TEXT_2 },
                border: Border {
                    color: LINE,
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.chip` / `.countBtn` / `.segmentBtn` — pill toggle.
pub fn chip<'a, M: 'a + Clone>(label: &'a str, active: bool, msg: Option<M>) -> Element<'a, M> {
    let enabled = msg.is_some();
    button(text(label).size(BODY))
        .padding(Padding {
            top: 6.0,
            right: 12.0,
            bottom: 6.0,
            left: 12.0,
        })
        .on_press_maybe(msg)
        .style(move |_, status| {
            let hover = enabled && matches!(status, button::Status::Hovered);
            button::Style {
                background: Some(if active { ACCENT_DIM } else { BG_1 }.into()),
                text_color: if active || hover {
                    ACCENT_BRIGHT
                } else {
                    TEXT_2
                }
                .scale_alpha(if enabled { 1.0 } else { 0.4 }),
                border: Border {
                    color: if active || hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(999.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.card` equivalent — panel + line + card shadow.
pub fn card<'a, M: 'a>(content: impl Into<Element<'a, M>>) -> Element<'a, M> {
    container(content)
        .padding(16)
        .width(Fill)
        .style(|_| container::Style {
            background: Some(PANEL.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            shadow: crate::bevel::shadow_card_drop(),
            ..container::Style::default()
        })
        .into()
}

/// `.errorBanner`.
pub fn error_banner<'a, M: 'a>(message: impl text::IntoFragment<'a>) -> Element<'a, M> {
    container(text(message).size(BODY).color(crate::tokens::rgb(0xffece7)))
        .padding(Padding {
            top: 12.0,
            right: 16.0,
            bottom: 12.0,
            left: 16.0,
        })
        .width(Fill)
        .style(|_| container::Style {
            background: Some(DANGER_DIM.into()),
            border: Border {
                color: rgba(255, 143, 115, 0.3),
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            ..container::Style::default()
        })
        .into()
}

/// `.successBanner`.
pub fn success_banner<'a, M: 'a>(message: impl text::IntoFragment<'a>) -> Element<'a, M> {
    container(text(message).size(BODY).color(crate::tokens::rgb(0xf4ffe0)))
        .padding(Padding {
            top: 12.0,
            right: 16.0,
            bottom: 12.0,
            left: 16.0,
        })
        .width(Fill)
        .style(|_| container::Style {
            background: Some(ACCENT_DIM.into()),
            border: Border {
                color: ACCENT_LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            ..container::Style::default()
        })
        .into()
}

/// `.emptyState` — dashed glass, centred.
pub fn empty_state<'a, M: 'a>(message: impl text::IntoFragment<'a>) -> Element<'a, M> {
    container(text(message).size(BODY).color(TEXT_2))
        .padding(32)
        .width(Fill)
        .center_x(Fill)
        .style(|_| container::Style {
            background: Some(GLASS.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            ..container::Style::default()
        })
        .into()
}

/// Route body: `--bg`, 24px pad, scrolls. `.boardPage` / `.spaceStage` host.
pub fn page<'a, M: 'a>(content: impl Into<Element<'a, M>>) -> Element<'a, M> {
    container(scrollable(container(content).padding(24).width(Fill)).height(Fill))
        .width(Fill)
        .height(Fill)
        .style(|_| container::Style {
            background: Some(BG.into()),
            ..container::Style::default()
        })
        .into()
}

/// Centred hero stage — `.spaceStage` + `.spaceHome`.
pub fn stage<'a, M: 'a>(content: impl Into<Element<'a, M>>) -> Element<'a, M> {
    container(content)
        .width(Fill)
        .height(Fill)
        .center_x(Fill)
        .center_y(Fill)
        .padding(24)
        .style(|_| container::Style {
            background: Some(BG.into()),
            ..container::Style::default()
        })
        .into()
}

/// Vertical rhythm used by every route body.
pub fn stack_16<'a, M: 'a>(children: Vec<Element<'a, M>>) -> Element<'a, M> {
    column(children).spacing(16).width(Fill).into()
}
