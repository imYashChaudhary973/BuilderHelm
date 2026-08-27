//! P0-7 spike: rebuild the topbar segmented mode toggle in iced 0.14.
//!
//! `cargo run -p helm-ui --example bevel`

use std::time::{Duration, Instant};

use iced::border::Radius;
use iced::widget::{button, column, container, row, stack, text};
use iced::window;
use iced::{Border, Color, Element, Fill, Padding, Shadow, Size, Subscription, Task, Vector};

const MODES: &[&str] = &["Space", "Swarm", "Board", "Memory", "Agent", "Code", "Chat"];
const TRACK_W: f32 = 528.0;
const TRACK_H: f32 = 28.0;
const PAD: f32 = 3.0;
const GAP: f32 = 4.0;
const SLIDE_MS: f32 = 500.0;

const BG: Color = Color::from_rgb(
    0x08 as f32 / 255.0,
    0x0a as f32 / 255.0,
    0x07 as f32 / 255.0,
);
const TEXT: Color = Color::from_rgb(
    0xee as f32 / 255.0,
    0xf1 as f32 / 255.0,
    0xe4 as f32 / 255.0,
);
const TEXT_2: Color = Color::from_rgb(
    0xa8 as f32 / 255.0,
    0xb0 as f32 / 255.0,
    0x9c as f32 / 255.0,
);
const TEXT_3: Color = Color::from_rgb(
    0x6f as f32 / 255.0,
    0x77 as f32 / 255.0,
    0x67 as f32 / 255.0,
);
const ACCENT: Color = Color::from_rgb(
    0xb6 as f32 / 255.0,
    0xd4 as f32 / 255.0,
    0x75 as f32 / 255.0,
);
const ACCENT_BRIGHT: Color = Color::from_rgb(
    0xd3 as f32 / 255.0,
    0xef as f32 / 255.0,
    0x9c as f32 / 255.0,
);
const ACCENT_LINE: Color = Color {
    r: 0xb6 as f32 / 255.0,
    g: 0xd4 as f32 / 255.0,
    b: 0x75 as f32 / 255.0,
    a: 0.35,
};

fn n() -> f32 {
    MODES.len() as f32
}

fn pill_w() -> f32 {
    (TRACK_W - 2.0 * PAD - (n() - 1.0) * GAP) / n()
}

fn pill_x(index: f32) -> f32 {
    PAD + index * (pill_w() + GAP)
}

/// CSS `cubic-bezier(0.22, 1, 0.36, 1)` — `--ease-out`.
fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    cubic_bezier(t, 0.22, 1.0, 0.36, 1.0)
}

fn cubic_bezier(t: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let mut x = t;
    for _ in 0..6 {
        let cx = 3.0 * x1;
        let bx = 3.0 * (x2 - x1) - cx;
        let ax = 1.0 - cx - bx;
        let dx = ((ax * x + bx) * x + cx) * x - t;
        let ddx = (3.0 * ax * x + 2.0 * bx) * x + cx;
        if ddx.abs() < 1e-6 {
            break;
        }
        x -= dx / ddx;
    }
    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;
    ((ay * x + by) * x + cy) * x
}

struct State {
    selected: usize,
    from: f32,
    to: f32,
    started: Instant,
}

impl Default for State {
    fn default() -> Self {
        Self {
            selected: 0,
            from: 0.0,
            to: 0.0,
            started: Instant::now() - Duration::from_secs(1),
        }
    }
}

impl State {
    fn progress(&self) -> f32 {
        ease_out(self.started.elapsed().as_secs_f32() / (SLIDE_MS / 1000.0))
    }

    fn index(&self) -> f32 {
        let t = self.progress();
        self.from + (self.to - self.from) * t
    }

    fn animating(&self) -> bool {
        self.progress() < 1.0
    }
}

#[derive(Debug, Clone, Copy)]
enum Message {
    Select(usize),
    Tick,
}

fn update(state: &mut State, message: Message) -> Task<Message> {
    match message {
        Message::Select(i) if i != state.selected => {
            state.from = state.index();
            state.to = i as f32;
            state.selected = i;
            state.started = Instant::now();
        }
        Message::Select(_) | Message::Tick => {}
    }
    Task::none()
}

fn subscription(state: &State) -> Subscription<Message> {
    if state.animating() {
        window::frames().map(|_| Message::Tick)
    } else {
        Subscription::none()
    }
}

fn radius(v: f32) -> Radius {
    Radius::new(v)
}

fn as_is_track() -> container::Style {
    container::Style {
        background: Some(
            Color {
                r: 1.0,
                g: 1.0,
                b: 1.0,
                a: 0.06,
            }
            .into(),
        ),
        border: Border {
            radius: radius(11.0),
            ..Border::default()
        },
        shadow: Shadow {
            color: Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.5,
            },
            offset: Vector::new(0.0, 1.0),
            blur_radius: 2.0,
        },
        ..container::Style::default()
    }
}

fn layered_track() -> Element<'static, Message> {
    let well = container(iced::widget::Space::new().width(Fill).height(Fill))
        .width(TRACK_W)
        .height(TRACK_H)
        .style(|_| container::Style {
            background: Some(
                Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.06,
                }
                .into(),
            ),
            border: Border {
                radius: radius(11.0),
                color: Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.04,
                },
                width: 1.0,
            },
            ..container::Style::default()
        });
    let inset_top = container(iced::widget::Space::new().width(Fill).height(2.0))
        .width(TRACK_W)
        .height(2.0)
        .style(|_| container::Style {
            background: Some(
                Color {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 0.45,
                }
                .into(),
            ),
            border: Border {
                radius: Radius {
                    top_left: 11.0,
                    top_right: 11.0,
                    bottom_right: 0.0,
                    bottom_left: 0.0,
                },
                ..Border::default()
            },
            ..container::Style::default()
        });
    let inset_bottom = container(iced::widget::Space::new().width(Fill).height(1.0))
        .width(TRACK_W)
        .style(|_| container::Style {
            background: Some(
                Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.05,
                }
                .into(),
            ),
            border: Border {
                radius: Radius {
                    top_left: 0.0,
                    top_right: 0.0,
                    bottom_right: 11.0,
                    bottom_left: 11.0,
                },
                ..Border::default()
            },
            ..container::Style::default()
        });
    stack![
        well,
        inset_top,
        container(inset_bottom)
            .width(TRACK_W)
            .height(TRACK_H)
            .align_y(iced::Alignment::End),
    ]
    .width(TRACK_W)
    .height(TRACK_H)
    .into()
}

fn pill(index: f32) -> Element<'static, Message> {
    let body = container(
        iced::widget::Space::new()
            .width(pill_w())
            .height(TRACK_H - 2.0 * PAD),
    )
    .style(|_| container::Style {
        background: Some(
            Color {
                r: ACCENT.r * 0.20 + 0.07 * 0.80,
                g: ACCENT.g * 0.20 + 0.07 * 0.80,
                b: ACCENT.b * 0.20 + 0.07 * 0.80,
                a: 1.0,
            }
            .into(),
        ),
        border: Border {
            radius: radius(8.0),
            color: ACCENT_LINE,
            width: 1.0,
        },
        shadow: Shadow {
            color: Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.45,
            },
            offset: Vector::new(0.0, 2.0),
            blur_radius: 4.0,
        },
        ..container::Style::default()
    });
    let highlight = container(iced::widget::Space::new().width(pill_w()).height(1.0)).style(|_| {
        container::Style {
            background: Some(
                Color {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0,
                    a: 0.16,
                }
                .into(),
            ),
            border: Border {
                radius: Radius {
                    top_left: 8.0,
                    top_right: 8.0,
                    bottom_right: 0.0,
                    bottom_left: 0.0,
                },
                ..Border::default()
            },
            ..container::Style::default()
        }
    });
    let shade = container(iced::widget::Space::new().width(pill_w()).height(2.0)).style(|_| {
        container::Style {
            background: Some(
                Color {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 0.35,
                }
                .into(),
            ),
            border: Border {
                radius: Radius {
                    top_left: 0.0,
                    top_right: 0.0,
                    bottom_right: 8.0,
                    bottom_left: 8.0,
                },
                ..Border::default()
            },
            ..container::Style::default()
        }
    });
    let stacked = stack![
        body,
        highlight,
        container(shade)
            .width(pill_w())
            .height(TRACK_H - 2.0 * PAD)
            .align_y(iced::Alignment::End),
    ]
    .width(pill_w())
    .height(TRACK_H - 2.0 * PAD);
    container(stacked)
        .padding(Padding {
            top: PAD,
            right: 0.0,
            bottom: PAD,
            left: pill_x(index),
        })
        .width(TRACK_W)
        .height(TRACK_H)
        .into()
}

fn labels(selected: usize) -> Element<'static, Message> {
    let items = MODES.iter().enumerate().map(|(i, label)| {
        let on = i == selected;
        button(text(*label).size(12))
            .padding(Padding {
                top: 4.0,
                right: 11.0,
                bottom: 4.0,
                left: 11.0,
            })
            .style(move |_, status| {
                let pressed = matches!(status, button::Status::Pressed);
                let hovered = matches!(status, button::Status::Hovered);
                button::Style {
                    background: None,
                    text_color: if on {
                        ACCENT_BRIGHT
                    } else if hovered || pressed {
                        TEXT_2
                    } else {
                        TEXT_3
                    },
                    border: Border {
                        radius: radius(8.0),
                        ..Border::default()
                    },
                    shadow: Shadow::default(),
                    snap: true,
                }
            })
            .on_press(Message::Select(i))
            .into()
    });
    container(row(items).spacing(GAP).width(TRACK_W - 2.0 * PAD))
        .padding(PAD)
        .width(TRACK_W)
        .height(TRACK_H)
        .into()
}

fn as_is_toggle(state: &State) -> Element<'_, Message> {
    let track = container(iced::widget::Space::new().width(TRACK_W).height(TRACK_H))
        .width(TRACK_W)
        .height(TRACK_H)
        .style(|_| as_is_track());
    stack![track, pill(state.index()), labels(state.selected)]
        .width(TRACK_W)
        .height(TRACK_H)
        .into()
}

fn layered_toggle(state: &State) -> Element<'_, Message> {
    stack![layered_track(), pill(state.index()), labels(state.selected)]
        .width(TRACK_W)
        .height(TRACK_H)
        .into()
}

fn view(state: &State) -> Element<'_, Message> {
    let caption = |s| text(s).size(13).color(TEXT_2);
    container(
        column![
            text("P0-7  iced bevel spike").size(20).color(TEXT),
            caption("Top: as-is (one Shadow). Bottom: layered containers."),
            caption("Click a mode — 500ms cubic-bezier(0.22, 1, 0.36, 1)."),
            caption("as-is"),
            as_is_toggle(state),
            caption("layered"),
            layered_toggle(state),
        ]
        .spacing(14),
    )
    .width(Fill)
    .height(Fill)
    .padding(36)
    .style(|_| container::Style {
        background: Some(BG.into()),
        text_color: Some(TEXT),
        ..container::Style::default()
    })
    .into()
}

fn main() -> iced::Result {
    iced::application(State::default, update, view)
        .title("P0-7 iced bevel")
        .subscription(subscription)
        .window_size(Size::new(640.0, 320.0))
        .run()
}
