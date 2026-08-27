use iced::border::Radius;
use iced::widget::{button, column, container, row, text, Space};
use iced::{Border, Color, Element, Fill, Padding};

use crate::icons::{glyph, Kind};
use crate::shell::Message;
use crate::tokens::{rgba, ACCENT, BG, BG_1, DANGER, LINE, TEXT, TEXT_2, TEXT_3};

pub const RAIL_EXPANDED: f32 = 236.0;
pub const RAIL_COLLAPSED: f32 = 52.0;

pub const SPACE_COLORS: &[Color] = &[
    ACCENT,
    crate::tokens::rgb(0x7ec8e3),
    crate::tokens::WARNING,
    crate::tokens::DANGER,
    crate::tokens::rgb(0xc4b5fd),
    crate::tokens::rgb(0xf9a8d4),
    crate::tokens::rgb(0x86efac),
    crate::tokens::rgb(0x93c5fd),
];

#[derive(Clone, Debug)]
pub struct SpaceRow {
    pub id: u64,
    pub label: String,
    pub color: Color,
    pub panes: u32,
}

pub fn rail_width(collapsed: bool) -> f32 {
    if collapsed {
        RAIL_COLLAPSED
    } else {
        RAIL_EXPANDED
    }
}

pub fn view(spaces: &[SpaceRow], active: u64, collapsed: bool) -> Element<'_, Message> {
    let add = icon_tile(
        Kind::Plus,
        TEXT_2,
        collapsed,
        Message::NewSpace,
        "New Space",
    );
    let head: Element<'_, Message> = if collapsed {
        container(add)
            .center_x(Fill)
            .padding(Padding {
                top: 0.0,
                right: 0.0,
                bottom: 10.0,
                left: 0.0,
            })
            .into()
    } else {
        row![
            text("WORKSPACES").size(11).color(TEXT_2),
            text(spaces.len().to_string()).size(11).color(TEXT_3),
            Space::new().width(Fill),
            add,
        ]
        .spacing(4)
        .align_y(iced::Alignment::Center)
        .into()
    };

    let rows = spaces.iter().map(|space| {
        let on = space.id == active;
        if collapsed {
            collapsed_tile(space, on)
        } else {
            expanded_row(space, on)
        }
    });

    container(column![head, column(rows).spacing(2)].spacing(8))
        .width(rail_width(collapsed))
        .height(Fill)
        .padding(if collapsed {
            Padding {
                top: 12.0,
                right: 6.0,
                bottom: 12.0,
                left: 6.0,
            }
        } else {
            Padding {
                top: 12.0,
                right: 10.0,
                bottom: 12.0,
                left: 10.0,
            }
        })
        .style(|_| container::Style {
            background: Some(BG.into()),
            border: Border {
                color: LINE,
                width: 0.0,
                radius: Radius::new(0.0),
            },
            ..container::Style::default()
        })
        .into()
}

fn collapsed_tile(space: &SpaceRow, on: bool) -> Element<'_, Message> {
    let id = space.id;
    let tile = button(
        container(glyph(Kind::Term, 20.0, space.color))
            .width(36)
            .height(36)
            .center_x(36)
            .center_y(36),
    )
    .padding(0)
    .style(move |_, status| tile_style(space.color, on, status))
    .on_press(Message::ActivateSpace(id));

    let badge = container(text(space.panes.to_string()).size(9).color(BG))
        .padding(Padding::from([1, 4]))
        .style(move |_| container::Style {
            background: Some(space.color.into()),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        });

    iced::widget::stack![
        tile,
        container(badge)
            .width(36)
            .height(36)
            .align_x(iced::alignment::Horizontal::Right)
            .align_y(iced::alignment::Vertical::Top),
    ]
    .width(36)
    .height(36)
    .into()
}

fn expanded_row(space: &SpaceRow, on: bool) -> Element<'_, Message> {
    let id = space.id;
    let glyph_tile = container(glyph(Kind::Term, 15.0, space.color))
        .width(26)
        .height(26)
        .center_x(26)
        .center_y(26)
        .style(move |_| container::Style {
            background: Some(mix(space.color, BG_1, 0.22).into()),
            border: Border {
                color: space.color,
                width: 1.0,
                radius: Radius::new(7.0),
            },
            ..container::Style::default()
        });
    let count = container(text(space.panes.to_string()).size(10).color(TEXT_2))
        .width(22)
        .height(22)
        .center_x(22)
        .center_y(22);
    let body = button(
        row![
            glyph_tile,
            text(space.label.clone())
                .size(13)
                .color(if on { TEXT } else { TEXT_2 }),
            Space::new().width(Fill),
            count,
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center),
    )
    .padding([6, 8])
    .width(Fill)
    .style(move |_, status| row_style(space.color, on, status))
    .on_press(Message::ActivateSpace(id));

    let mut children: Vec<Element<'_, Message>> = vec![body.into()];
    if on {
        children.push(
            button(glyph(Kind::Close, 14.0, TEXT_3))
                .padding(4)
                .style(|_, status| close_style(status))
                .on_press(Message::CloseSpace(id))
                .into(),
        );
    }
    container(row(children).align_y(iced::Alignment::Center).spacing(2))
        .style(move |_| {
            if on {
                container::Style {
                    background: Some(mix(space.color, Color::TRANSPARENT, 0.10).into()),
                    border: Border {
                        color: mix(space.color, Color::TRANSPARENT, 0.45),
                        width: 1.0,
                        radius: Radius::new(10.0),
                    },
                    ..container::Style::default()
                }
            } else {
                container::Style::default()
            }
        })
        .into()
}

fn icon_tile<'a>(
    kind: Kind,
    color: Color,
    collapsed: bool,
    msg: Message,
    _title: &str,
) -> Element<'a, Message> {
    let size = if collapsed { 36.0 } else { 26.0 };
    button(glyph(kind, if collapsed { 18.0 } else { 14.0 }, color))
        .width(size)
        .height(size)
        .on_press(msg)
        .style(move |_, status| {
            let hovered = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(rgba(255, 255, 255, if hovered { 0.05 } else { 0.02 }).into()),
                text_color: color,
                border: Border {
                    color: rgba(255, 255, 255, if hovered { 0.32 } else { 0.12 }),
                    width: 1.0,
                    radius: Radius::new(8.0),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        })
        .into()
}

fn tile_style(tile: Color, on: bool, status: button::Status) -> button::Style {
    let hovered = matches!(status, button::Status::Hovered | button::Status::Pressed);
    button::Style {
        background: Some(mix(tile, BG_1, if on || hovered { 0.22 } else { 0.08 }).into()),
        text_color: TEXT,
        border: Border {
            color: if on || hovered {
                tile
            } else {
                rgba(255, 255, 255, 0.10)
            },
            width: 1.0,
            radius: Radius::new(10.0),
        },
        shadow: iced::Shadow::default(),
        snap: true,
    }
}

fn row_style(_tile: Color, on: bool, status: button::Status) -> button::Style {
    let hovered = matches!(status, button::Status::Hovered);
    button::Style {
        background: if hovered && !on {
            Some(rgba(255, 255, 255, 0.04).into())
        } else {
            None
        },
        text_color: if on { TEXT } else { TEXT_2 },
        border: Border::default(),
        shadow: iced::Shadow::default(),
        snap: true,
    }
}

fn close_style(status: button::Status) -> button::Style {
    let hovered = matches!(status, button::Status::Hovered | button::Status::Pressed);
    button::Style {
        background: Some(rgba(255, 255, 255, if hovered { 0.06 } else { 0.0 }).into()),
        text_color: if hovered { DANGER } else { TEXT_3 },
        border: Border {
            radius: Radius::new(6.0),
            ..Border::default()
        },
        shadow: iced::Shadow::default(),
        snap: true,
    }
}

fn mix(a: Color, b: Color, t: f32) -> Color {
    Color {
        r: a.r * t + b.r * (1.0 - t),
        g: a.g * t + b.g * (1.0 - t),
        b: a.b * t + b.b * (1.0 - t),
        a: a.a * t + b.a * (1.0 - t),
    }
}
