//! `components/kanban-board.tsx` columns and cards. Shared by the Board route.
//!
//! HTML drag-and-drop has no `iced` counterpart, so the TSX `←` / `→` stage
//! buttons on every card are the whole move affordance here.

use iced::border::Radius;
use iced::widget::{button, container, row, scrollable, text, text_input, Column, Row, Space};
use iced::{Alignment, Border, Color, Element, Fill, Padding, Shadow};

use super::common::{SMALL, TINY};
use crate::tokens::{
    rgb, ACCENT, ACCENT_BRIGHT, ACCENT_DIM, BG_1, LINE, RADIUS_S, TEXT, TEXT_2, TEXT_3,
};

/// `.kanbanCol` background. CSS `#0c0d0c`.
const COLUMN_BG: Color = rgb(0x0c0d0c);
/// `.kanbanCol li` background. CSS `#121312`.
const CARD_BG: Color = rgb(0x121312);
/// `.kanbanCol ul` height. CSS lets the grid row stretch; the route body
/// scrolls vertically, so the card list carries its own scroll instead.
const LIST_HEIGHT: f32 = 360.0;

/// `KanbanColumn` from `@zero/protocol/kanban`. Variant order is `COLUMNS`
/// order, which is the stage order `neighbor()` walks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum KanbanColumn {
    #[default]
    Idea,
    Doing,
    Review,
    Shipped,
    Cancelled,
}

/// `COLUMNS` in `kanban-board.tsx`.
pub const COLUMNS: [KanbanColumn; 5] = [
    KanbanColumn::Idea,
    KanbanColumn::Doing,
    KanbanColumn::Review,
    KanbanColumn::Shipped,
    KanbanColumn::Cancelled,
];

impl KanbanColumn {
    /// The stage heading.
    pub fn label(self) -> &'static str {
        match self {
            Self::Idea => "To Do",
            Self::Doing => "In Progress",
            Self::Review => "In Review",
            Self::Shipped => "Complete",
            Self::Cancelled => "Cancelled",
        }
    }

    /// `.kanbanCol[data-column='…']` top border colour.
    pub fn accent(self) -> Color {
        match self {
            Self::Idea => rgb(0x8b9288),
            Self::Doing => ACCENT,
            Self::Review => rgb(0xc4a35a),
            Self::Shipped => rgb(0x72b869),
            Self::Cancelled => rgb(0xc45a5a),
        }
    }

    /// `neighbor(id, delta)` — `None` past either end of `COLUMNS`.
    pub fn neighbor(self, delta: i32) -> Option<Self> {
        let index = COLUMNS.iter().position(|stage| *stage == self)? as i32 + delta;
        usize::try_from(index)
            .ok()
            .and_then(|index| COLUMNS.get(index).copied())
    }
}

/// `.kanbanCol` — accent rule, heading with the count badge and `+`, then the
/// card list. `compose` is the `.kanbanCompose` row when this stage is
/// composing; the `No tasks` empty state shows only while both are empty.
pub fn column<'a, M: 'a + Clone>(
    stage: KanbanColumn,
    add: M,
    cards: Vec<Element<'a, M>>,
    compose: Option<Element<'a, M>>,
) -> Element<'a, M> {
    let count = cards.len();
    let heading = row![
        row![dot(), text(stage.label()).size(SMALL).color(TEXT_2)]
            .spacing(7)
            .align_y(Alignment::Center),
        Space::new().width(Fill),
        row![count_badge(count), add_button(add)]
            .spacing(6)
            .align_y(Alignment::Center),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(Padding {
        top: 10.0,
        right: 11.0,
        bottom: 10.0,
        left: 11.0,
    });

    let mut items: Vec<Element<'a, M>> = Vec::with_capacity(count + 1);
    if count == 0 && compose.is_none() {
        items.push(empty());
    }
    items.extend(cards);
    if let Some(compose) = compose {
        items.push(compose);
    }

    let list = scrollable(
        Column::with_children(items)
            .spacing(8)
            .width(Fill)
            .padding(9),
    )
    .height(LIST_HEIGHT);

    container(
        Column::with_children(vec![rule(stage.accent()), divider(heading), list.into()])
            .width(Fill),
    )
    .width(Fill)
    .style(|_| container::Style {
        background: Some(COLUMN_BG.into()),
        border: Border {
            color: LINE,
            width: 1.0,
            radius: Radius::new(RADIUS_S),
        },
        ..container::Style::default()
    })
    .into()
}

/// `.kanbanCard` — the title (or rename field) plus the stage and delete
/// controls. `back` / `forward` are `None` at the ends of `COLUMNS`, exactly
/// where the TSX omits the button.
pub fn card<'a, M: 'a + Clone>(
    body: Element<'a, M>,
    back: Option<M>,
    forward: Option<M>,
    delete: M,
) -> Element<'a, M> {
    let mut controls: Vec<Element<'a, M>> = Vec::with_capacity(3);
    if let Some(back) = back {
        controls.push(card_button("←", back));
    }
    if let Some(forward) = forward {
        controls.push(card_button("→", forward));
    }
    controls.push(card_button("×", delete));

    container(
        row![
            container(body).width(Fill),
            Row::with_children(controls).spacing(4),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .padding(10)
    .width(Fill)
    .style(|_| container::Style {
        background: Some(CARD_BG.into()),
        border: Border {
            color: LINE,
            width: 1.0,
            radius: Radius::new(8.0),
        },
        ..container::Style::default()
    })
    .into()
}

/// `.kanbanCardTitle` — transparent inline button that opens the rename field.
pub fn card_title<'a, M: 'a + Clone>(title: &'a str, edit: M) -> Element<'a, M> {
    button(text(title).size(SMALL).color(TEXT))
        .padding(0)
        .on_press(edit)
        .style(|_, status| button::Style {
            background: None,
            text_color: if matches!(status, button::Status::Hovered | button::Status::Pressed) {
                ACCENT_BRIGHT
            } else {
                TEXT
            },
            border: Border::default(),
            shadow: Shadow::default(),
            snap: true,
        })
        .into()
}

/// `.kanbanCardEdit` — accent-outlined rename field. Enter commits; `esc`
/// replaces the TSX Escape key and blur handlers, which `iced` does not expose.
pub fn card_edit<'a, M: 'a + Clone>(
    value: &str,
    on_input: impl Fn(String) -> M + 'a,
    commit: M,
    cancel: M,
) -> Element<'a, M> {
    row![field("Task title", value, on_input, commit), escape(cancel)]
        .spacing(4)
        .align_y(Alignment::Center)
        .into()
}

/// `.kanbanCompose` — dashed row holding the new-task field for one stage.
pub fn compose_input<'a, M: 'a + Clone>(
    value: &str,
    on_input: impl Fn(String) -> M + 'a,
    submit: M,
    cancel: M,
) -> Element<'a, M> {
    container(
        row![field("Task title", value, on_input, submit), escape(cancel)]
            .spacing(4)
            .align_y(Alignment::Center),
    )
    .padding(6)
    .width(Fill)
    .style(|_| container::Style {
        background: None,
        border: Border {
            color: LINE,
            width: 1.0,
            radius: Radius::new(8.0),
        },
        ..container::Style::default()
    })
    .into()
}

/// `.kanbanCardEdit` / `.kanbanCompose input` — one CSS rule, one field.
fn field<'a, M: 'a + Clone>(
    placeholder: &str,
    value: &str,
    on_input: impl Fn(String) -> M + 'a,
    submit: M,
) -> Element<'a, M> {
    text_input(placeholder, value)
        .size(SMALL)
        .padding(Padding {
            top: 4.0,
            right: 6.0,
            bottom: 4.0,
            left: 6.0,
        })
        .width(Fill)
        .on_input(on_input)
        .on_submit(submit)
        .style(|_, _| text_input::Style {
            background: COLUMN_BG.into(),
            border: Border {
                color: ACCENT,
                width: 1.0,
                radius: Radius::new(6.0),
            },
            icon: TEXT_3,
            placeholder: TEXT_3,
            value: TEXT,
            selection: ACCENT_DIM,
        })
        .into()
}

/// Escape hatch for the two fields the TSX cancels with the Escape key.
fn escape<'a, M: 'a + Clone>(cancel: M) -> Element<'a, M> {
    small_button(text("esc").size(TINY), 30.0, 22.0, cancel)
}

/// `.kanbanCol li button` — 24px square control.
fn card_button<'a, M: 'a + Clone>(glyph: &'a str, msg: M) -> Element<'a, M> {
    small_button(text(glyph).size(SMALL), 24.0, 24.0, msg)
}

/// `.kanbanCol header button` — 18px square `+`.
fn add_button<'a, M: 'a + Clone>(msg: M) -> Element<'a, M> {
    small_button(text("+").size(SMALL), 18.0, 18.0, msg)
}

fn small_button<'a, M: 'a + Clone>(
    label: iced::widget::Text<'a>,
    width: f32,
    height: f32,
    msg: M,
) -> Element<'a, M> {
    button(container(label).center_x(Fill).center_y(Fill))
        .padding(0)
        .width(width)
        .height(height)
        .on_press(msg)
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(
                    if hover {
                        ACCENT_DIM
                    } else {
                        Color::TRANSPARENT
                    }
                    .into(),
                ),
                text_color: if hover { ACCENT_BRIGHT } else { TEXT_2 },
                border: Border {
                    color: if hover { ACCENT } else { LINE },
                    width: 1.0,
                    radius: Radius::new(6.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.kanbanCol header > span:first-child::before` — 6px stage dot.
fn dot<'a, M: 'a>() -> Element<'a, M> {
    container(Space::new().width(6).height(6))
        .style(|_| container::Style {
            background: Some(TEXT_2.into()),
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: Radius::new(999.0),
            },
            ..container::Style::default()
        })
        .into()
}

/// `.kanbanCol header strong` — count badge.
fn count_badge<'a, M: 'a>(count: usize) -> Element<'a, M> {
    container(text(count.to_string()).size(10.0).color(TEXT_3))
        .width(18)
        .height(18)
        .center_x(Fill)
        .center_y(Fill)
        .style(|_| container::Style {
            background: Some(BG_1.into()),
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: Radius::new(999.0),
            },
            ..container::Style::default()
        })
        .into()
}

/// `.kanbanEmpty`.
fn empty<'a, M: 'a>() -> Element<'a, M> {
    container(text("No tasks").size(TINY).color(TEXT_3))
        .width(Fill)
        .padding(10)
        .center_x(Fill)
        .into()
}

/// `.kanbanCol[data-column]` top border.
fn rule<'a, M: 'a>(color: Color) -> Element<'a, M> {
    container(Space::new().width(Fill).height(3))
        .width(Fill)
        .style(move |_| container::Style {
            background: Some(color.into()),
            ..container::Style::default()
        })
        .into()
}

/// `.kanbanCol header` bottom border.
fn divider<'a, M: 'a>(content: impl Into<Element<'a, M>>) -> Element<'a, M> {
    Column::with_children(vec![
        content.into(),
        container(Space::new().width(Fill).height(1))
            .width(Fill)
            .style(|_| container::Style {
                background: Some(LINE.into()),
                ..container::Style::default()
            })
            .into(),
    ])
    .width(Fill)
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbor_walks_columns_and_stops_at_both_ends() {
        assert_eq!(KanbanColumn::Idea.neighbor(-1), None);
        assert_eq!(KanbanColumn::Idea.neighbor(1), Some(KanbanColumn::Doing));
        assert_eq!(KanbanColumn::Cancelled.neighbor(1), None);
        assert_eq!(
            KanbanColumn::Cancelled.neighbor(-1),
            Some(KanbanColumn::Shipped)
        );
        assert_eq!(COLUMNS.map(KanbanColumn::label)[2], "In Review");
    }
}
