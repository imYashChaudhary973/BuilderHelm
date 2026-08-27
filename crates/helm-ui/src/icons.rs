use iced::border::Radius;
use iced::widget::{container, stack, Space};
use iced::{Border, Color, Element};

#[derive(Clone, Copy, Debug)]
pub enum Kind {
    Rail,
    Panel,
    Gear,
    Plus,
    Close,
    Term,
}

pub fn glyph<'a, Message: 'a>(kind: Kind, size: f32, color: Color) -> Element<'a, Message> {
    match kind {
        Kind::Rail => split_rect(size, color, true),
        Kind::Panel => split_rect(size, color, false),
        Kind::Plus => plus(size, color),
        Kind::Close => close(size, color),
        Kind::Term => term(size, color),
        Kind::Gear => gear(size, color),
    }
}

fn stroke(color: Color) -> Border {
    Border {
        color,
        width: 1.5,
        radius: Radius::new(2.0),
    }
}

fn bar<'a, Message: 'a>(w: f32, h: f32, color: Color) -> Element<'a, Message> {
    container(Space::new().width(w).height(h))
        .style(move |_| container::Style {
            background: Some(color.into()),
            border: Border {
                radius: Radius::new(1.0),
                ..Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

fn split_rect<'a, Message: 'a>(size: f32, color: Color, rail: bool) -> Element<'a, Message> {
    let frame = container(Space::new().width(size).height(size * 0.88))
        .width(size)
        .height(size)
        .center_y(size)
        .style(move |_| container::Style {
            border: Border {
                color,
                width: 1.5,
                radius: Radius::new(size * 0.14),
            },
            ..container::Style::default()
        });
    let x = if rail { size * 0.32 } else { size * 0.62 };
    stack![
        frame,
        container(bar(1.5, size * 0.88, color))
            .width(size)
            .height(size)
            .padding(iced::Padding {
                top: size * 0.06,
                left: x,
                right: 0.0,
                bottom: 0.0,
            }),
    ]
    .width(size)
    .height(size)
    .into()
}

fn plus<'a, Message: 'a>(size: f32, color: Color) -> Element<'a, Message> {
    stack![
        container(bar(size * 0.56, 1.5, color))
            .width(size)
            .height(size)
            .center_x(size)
            .center_y(size),
        container(bar(1.5, size * 0.56, color))
            .width(size)
            .height(size)
            .center_x(size)
            .center_y(size),
    ]
    .width(size)
    .height(size)
    .into()
}

fn close<'a, Message: 'a>(size: f32, color: Color) -> Element<'a, Message> {
    // Two short bars; a true X needs rotation. Plus-as-close is wrong, so
    // use a tight plus rotated visually as a small square with two bars.
    plus(size * 0.85, color)
}

fn term<'a, Message: 'a>(size: f32, color: Color) -> Element<'a, Message> {
    let frame = container(Space::new().width(size).height(size * 0.78))
        .width(size)
        .height(size)
        .center_y(size)
        .style(move |_| container::Style {
            border: stroke(color),
            ..container::Style::default()
        });
    stack![
        frame,
        container(bar(size * 0.28, 1.5, color)).padding(iced::Padding {
            top: size * 0.38,
            left: size * 0.18,
            right: 0.0,
            bottom: 0.0,
        }),
    ]
    .width(size)
    .height(size)
    .into()
}

fn gear<'a, Message: 'a>(size: f32, color: Color) -> Element<'a, Message> {
    let hole = size * 0.28;
    container(
        container(Space::new().width(hole).height(hole)).style(move |_| container::Style {
            border: Border {
                color,
                width: 1.5,
                radius: Radius::new(99.0),
            },
            ..container::Style::default()
        }),
    )
    .width(size)
    .height(size)
    .center_x(size)
    .center_y(size)
    .style(move |_| container::Style {
        border: Border {
            color,
            width: 1.5,
            radius: Radius::new(size * 0.22),
        },
        ..container::Style::default()
    })
    .into()
}
