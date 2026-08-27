use std::time::{Duration, Instant};

use iced::border::Radius;
use iced::widget::{button, column, container, row, stack, text, Space};
use iced::{
    window, Border, Color, Element, Fill, Padding, Shadow, Size, Subscription, Task, Vector,
};

use crate::icons::{glyph, Kind};
use crate::rail::{self, SpaceRow};
use crate::routes::{self, Route, Routes};
use crate::sidebars;
use crate::tokens::{
    ease, outer_drop, rgba, ACCENT, ACCENT_BRIGHT, ACCENT_LINE, BEVEL_3D, BEVEL_3D_PRESSED, BG,
    EASE_OUT, LINE, PANEL, SPACE_GAP, SPACE_PAD, TEXT, TEXT_2, TEXT_3,
};
pub const MODES: &[&str] = &["Space", "Swarm", "Board", "Memory", "Agent", "Code", "Chat"];
pub const TOPBAR_H: f32 = 36.0;
pub const TRAFFIC_INSET: f32 = 78.0;
pub const TRACK_W: f32 = 528.0;
pub const TRACK_H: f32 = 28.0;
const SLIDE_MS: f32 = 500.0;
const TOPBAR_BG: Color = crate::tokens::rgb(0x050505);
const SIDE_TABS: &[&str] = &["Browser", "Editor", "Git", "Skills"];

/// Window-centre of the segmented nav, ignoring the 78px traffic-light inset.
pub fn nav_origin_x(window_width: f32) -> f32 {
    ((window_width - TRACK_W) / 2.0).max(0.0)
}

fn n() -> f32 {
    MODES.len() as f32
}

fn pill_w() -> f32 {
    (TRACK_W - 2.0 * SPACE_PAD - (n() - 1.0) * SPACE_GAP) / n()
}

fn pill_x(index: f32) -> f32 {
    SPACE_PAD + index * (pill_w() + SPACE_GAP)
}

#[derive(Debug, Clone)]
pub enum Message {
    SelectMode(usize),
    ToggleRail,
    ToggleTools,
    OpenSettings,
    GoRoute(Route),
    Tick,
    Resized(Size),
    ActivateSpace(u64),
    CloseSpace(u64),
    NewSpace,
    SideTab(usize),
    Editor(sidebars::editor::Message),
    Git(sidebars::git::Message),
    Route(routes::Message),
}

pub struct Shell {
    pub route: Route,
    from: f32,
    to: f32,
    started: Instant,
    pub rail_collapsed: bool,
    pub tools_open: bool,
    pub window: Size,
    pub spaces: Vec<SpaceRow>,
    pub active: u64,
    next_id: u64,
    pub side_tab: usize,
    pub routes: Routes,
    pub editor: sidebars::editor::State,
    pub git: sidebars::git::State,
}

impl Default for Shell {
    fn default() -> Self {
        Self::new()
    }
}

impl Shell {
    pub fn new() -> Self {
        let spaces = vec![
            SpaceRow {
                id: 1,
                label: "main".into(),
                color: rail::SPACE_COLORS[0],
                panes: 3,
            },
            SpaceRow {
                id: 2,
                label: "axiom".into(),
                color: rail::SPACE_COLORS[1],
                panes: 1,
            },
            SpaceRow {
                id: 3,
                label: "notes".into(),
                color: rail::SPACE_COLORS[2],
                panes: 2,
            },
        ];
        Self {
            route: Route::Space,
            from: 0.0,
            to: 0.0,
            started: Instant::now() - Duration::from_secs(1),
            rail_collapsed: true,
            tools_open: false,
            window: Size::new(1280.0, 800.0),
            spaces,
            active: 1,
            next_id: 4,
            side_tab: 0,
            routes: Routes::default(),
            editor: sidebars::editor::State::default(),
            git: sidebars::git::State::default(),
        }
    }

    fn progress(&self) -> f32 {
        ease(
            self.started.elapsed().as_secs_f32() / (SLIDE_MS / 1000.0),
            EASE_OUT,
        )
    }

    fn index(&self) -> f32 {
        let t = self.progress();
        self.from + (self.to - self.from) * t
    }

    fn animating(&self) -> bool {
        self.progress() < 1.0
    }

    /// Slide the pill and switch surface. No-op when already there.
    fn go(&mut self, route: Route) {
        if self.route == route {
            return;
        }
        if let Some(index) = route.nav_index() {
            self.from = self.index();
            self.to = index as f32;
            self.started = Instant::now();
        }
        self.route = route;
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::SelectMode(i) => {
                if let Some(route) = Route::NAV.get(i).copied() {
                    self.go(route);
                }
            }
            Message::ToggleRail => self.rail_collapsed = !self.rail_collapsed,
            Message::ToggleTools => self.tools_open = !self.tools_open,
            Message::OpenSettings => self.go(Route::Settings),
            Message::GoRoute(route) => self.go(route),
            Message::Editor(m) => return self.editor.update(m).map(Message::Editor),
            Message::Git(m) => return self.git.update(m).map(Message::Git),
            Message::Tick => {}
            Message::Resized(size) => self.window = size,
            Message::ActivateSpace(id) => {
                self.active = id;
                self.go(Route::Space);
            }
            Message::CloseSpace(id) => {
                self.spaces.retain(|space| space.id != id);
                if self.active == id {
                    self.active = self.spaces.first().map(|s| s.id).unwrap_or(0);
                }
            }
            Message::NewSpace => {
                let color = rail::SPACE_COLORS[self.spaces.len() % rail::SPACE_COLORS.len()];
                let id = self.next_id;
                self.next_id += 1;
                self.spaces.push(SpaceRow {
                    id,
                    label: format!("space-{id}"),
                    color,
                    panes: 1,
                });
                self.active = id;
                self.go(Route::Space);
            }
            Message::SideTab(i) if i < 3 => self.side_tab = i,
            Message::SideTab(_) => {}
            Message::Route(m) => {
                let task = self.routes.update(m).map(Message::Route);
                if let Some(route) = self.routes.take_nav() {
                    self.go(route);
                }
                return task;
            }
        }
        Task::none()
    }

    pub fn subscription(&self) -> Subscription<Message> {
        let resize = window::resize_events().map(|(_, size)| Message::Resized(size));
        if self.animating() {
            Subscription::batch([resize, window::frames().map(|_| Message::Tick)])
        } else {
            resize
        }
    }

    pub fn view(&self) -> Element<'_, Message> {
        let body = row![
            rail::view(&self.spaces, self.active, self.rail_collapsed),
            content(self),
        ];
        let body: Element<'_, Message> = if self.tools_open {
            row![body, side_panel(self)].into()
        } else {
            body.into()
        };
        column![topbar(self), body].width(Fill).height(Fill).into()
    }
}

fn topbar(shell: &Shell) -> Element<'_, Message> {
    let start = row![
        icon_btn(Kind::Rail, !shell.rail_collapsed, Message::ToggleRail,),
        brand(),
    ]
    .spacing(10)
    .align_y(iced::Alignment::Center);

    let end = row![
        icon_btn(
            Kind::Gear,
            shell.route == Route::Settings,
            Message::OpenSettings,
        ),
        icon_btn(Kind::Panel, shell.tools_open, Message::ToggleTools),
    ]
    .spacing(10)
    .align_y(iced::Alignment::Center);

    let bar = row![start, Space::new().width(Fill), end]
        .padding(Padding {
            top: 0.0,
            right: 10.0,
            bottom: 0.0,
            left: TRAFFIC_INSET,
        })
        .align_y(iced::Alignment::Center)
        .height(TOPBAR_H)
        .width(Fill);

    let nav_left = nav_origin_x(shell.window.width);
    let nav = container(seg_nav(shell)).padding(Padding {
        top: (TOPBAR_H - TRACK_H) / 2.0,
        right: 0.0,
        bottom: 0.0,
        left: nav_left,
    });

    container(stack![bar, nav].width(Fill).height(TOPBAR_H))
        .width(Fill)
        .height(TOPBAR_H)
        .style(|_| container::Style {
            background: Some(TOPBAR_BG.into()),
            border: Border {
                color: rgba(255, 255, 255, 0.06),
                width: 1.0,
                radius: Radius::new(0.0),
            },
            ..container::Style::default()
        })
        .into()
}

fn brand() -> Element<'static, Message> {
    row![
        container(Space::new().width(16).height(16)).style(|_| container::Style {
            background: Some(ACCENT.into()),
            border: Border {
                radius: Radius::new(4.0),
                ..Border::default()
            },
            ..container::Style::default()
        }),
        text("BuilderHelm").size(13).color(TEXT),
    ]
    .spacing(6)
    .align_y(iced::Alignment::Center)
    .into()
}

fn icon_btn(kind: Kind, on: bool, msg: Message) -> Element<'static, Message> {
    let color = if on { ACCENT_BRIGHT } else { TEXT_3 };
    button(glyph(kind, 16.0, color))
        .width(24)
        .height(24)
        .padding(4)
        .on_press(msg)
        .style(move |_, status| {
            let pressed = matches!(status, button::Status::Pressed);
            let hovered = matches!(status, button::Status::Hovered);
            let bg = if on {
                Color {
                    r: ACCENT.r * 0.16 + 0.05 * 0.84,
                    g: ACCENT.g * 0.16 + 0.05 * 0.84,
                    b: ACCENT.b * 0.16 + 0.05 * 0.84,
                    a: 1.0,
                }
            } else if hovered {
                rgba(255, 255, 255, 0.09)
            } else {
                rgba(255, 255, 255, 0.05)
            };
            let drop = if pressed {
                BEVEL_3D_PRESSED.iter().copied().find(|l| !l.inset)
            } else {
                BEVEL_3D.iter().copied().find(|l| !l.inset)
            };
            button::Style {
                background: Some(bg.into()),
                text_color: if on || hovered { TEXT } else { TEXT_3 },
                border: Border {
                    radius: Radius::new(7.0),
                    ..Border::default()
                },
                shadow: drop.map(outer_drop).unwrap_or_default(),
                snap: true,
            }
        })
        .into()
}

fn seg_nav(shell: &Shell) -> Element<'_, Message> {
    let well = container(Space::new().width(TRACK_W).height(TRACK_H))
        .width(TRACK_W)
        .height(TRACK_H)
        .style(|_| container::Style {
            background: Some(rgba(255, 255, 255, 0.06).into()),
            border: Border {
                radius: Radius::new(11.0),
                color: rgba(255, 255, 255, 0.04),
                width: 1.0,
            },
            shadow: Shadow {
                color: rgba(0, 0, 0, 0.5),
                offset: Vector::new(0.0, 1.0),
                blur_radius: 2.0,
            },
            ..container::Style::default()
        });
    let inset_top = container(Space::new().width(Fill).height(2.0)).style(|_| container::Style {
        background: Some(rgba(0, 0, 0, 0.45).into()),
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
    let labels = {
        let items = MODES.iter().enumerate().map(|(i, label)| {
            let on = shell.route.nav_index() == Some(i);
            button(text(*label).size(12))
                .padding(Padding {
                    top: 4.0,
                    right: 11.0,
                    bottom: 4.0,
                    left: 11.0,
                })
                .style(move |_, status| {
                    let hovered =
                        matches!(status, button::Status::Hovered | button::Status::Pressed);
                    button::Style {
                        background: None,
                        text_color: if on {
                            ACCENT_BRIGHT
                        } else if hovered {
                            TEXT_2
                        } else {
                            TEXT_3
                        },
                        border: Border {
                            radius: Radius::new(8.0),
                            ..Border::default()
                        },
                        shadow: Shadow::default(),
                        snap: true,
                    }
                })
                .on_press(Message::SelectMode(i))
                .into()
        });
        container(
            row(items)
                .spacing(SPACE_GAP)
                .width(TRACK_W - 2.0 * SPACE_PAD),
        )
        .padding(SPACE_PAD)
        .width(TRACK_W)
        .height(TRACK_H)
    };
    let layers = if shell.route.nav_index().is_none() {
        stack![well, inset_top, labels]
    } else {
        stack![well, inset_top, pill(shell.index()), labels]
    };
    layers.width(TRACK_W).height(TRACK_H).into()
}

fn pill(index: f32) -> Element<'static, Message> {
    let body = container(
        Space::new()
            .width(pill_w())
            .height(TRACK_H - 2.0 * SPACE_PAD),
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
            radius: Radius::new(8.0),
            color: ACCENT_LINE,
            width: 1.0,
        },
        shadow: Shadow {
            color: rgba(0, 0, 0, 0.45),
            offset: Vector::new(0.0, 2.0),
            blur_radius: 4.0,
        },
        ..container::Style::default()
    });
    container(body)
        .padding(Padding {
            top: SPACE_PAD,
            right: 0.0,
            bottom: SPACE_PAD,
            left: pill_x(index),
        })
        .width(TRACK_W)
        .height(TRACK_H)
        .into()
}

fn content(shell: &Shell) -> Element<'_, Message> {
    container(shell.routes.view(shell.route).map(Message::Route))
        .width(Fill)
        .height(Fill)
        .style(|_| container::Style {
            background: Some(BG.into()),
            ..container::Style::default()
        })
        .into()
}

fn side_panel(shell: &Shell) -> Element<'_, Message> {
    let tab = shell.side_tab;
    let tabs = SIDE_TABS.iter().enumerate().map(|(i, label)| {
        let on = i == tab;
        let live = i < 3;
        button(text(*label).size(12))
            .padding([6, 8])
            .on_press_maybe(live.then_some(Message::SideTab(i)))
            .style(move |_, status| {
                let hovered = matches!(status, button::Status::Hovered);
                button::Style {
                    background: if on { Some(ACCENT.into()) } else { None },
                    text_color: if on {
                        BG
                    } else if hovered && live {
                        TEXT
                    } else {
                        TEXT_3
                    },
                    border: Border {
                        radius: Radius::new(99.0),
                        ..Border::default()
                    },
                    shadow: Shadow::default(),
                    snap: true,
                }
            })
            .into()
    });
    container(
        column![
            container(row(tabs).spacing(4))
                .padding(3)
                .style(|_| container::Style {
                    background: Some(crate::tokens::BG_1.into()),
                    border: Border {
                        color: LINE,
                        width: 1.0,
                        radius: Radius::new(99.0),
                    },
                    ..container::Style::default()
                }),
            // P4-5 sidebars. Browser is the recorded P5-3 cut placeholder.
            container(match tab {
                0 => sidebars::browser::view(),
                1 => shell.editor.view().map(Message::Editor),
                2 => shell.git.view().map(Message::Git),
                _ => container(text("Skills arrive post-v1.").size(12).color(TEXT_3))
                    .padding(16)
                    .width(Fill)
                    .into(),
            })
            .width(Fill)
            .height(Fill),
            // Utility routes: reachable in-app, not only via constructed links.
            column([
                dim("More"),
                link(
                    "Today",
                    shell.route == Route::Today,
                    Message::GoRoute(Route::Today)
                ),
                link(
                    "Projects",
                    shell.route == Route::Projects,
                    Message::GoRoute(Route::Projects),
                ),
                link(
                    "Actions",
                    shell.route == Route::Actions,
                    Message::GoRoute(Route::Actions),
                ),
                link(
                    "Routines",
                    shell.route == Route::Routines,
                    Message::GoRoute(Route::Routines),
                ),
                link(
                    "Plugins",
                    shell.route == Route::Plugins,
                    Message::GoRoute(Route::Plugins),
                ),
            ])
            .spacing(4),
        ]
        .spacing(10)
        .padding(10),
    )
    .width(360)
    .height(Fill)
    .style(|_| container::Style {
        background: Some(PANEL.into()),
        border: Border {
            color: LINE,
            width: 1.0,
            radius: Radius::new(0.0),
        },
        ..container::Style::default()
    })
    .into()
}

fn dim(label: &str) -> Element<'static, Message> {
    text(label.to_uppercase()).size(11.0).color(TEXT_3).into()
}

fn link(label: &str, active: bool, msg: Message) -> Element<'static, Message> {
    let label = label.to_string();
    let text_color = if active { ACCENT_BRIGHT } else { TEXT_2 };
    let border_color = if active {
        ACCENT_LINE
    } else {
        Color::TRANSPARENT
    };
    button(text(label).size(12).color(text_color))
        .padding([4, 8])
        .on_press(msg)
        .style(move |_, status| {
            let hovered = matches!(status, button::Status::Hovered);
            button::Style {
                background: if hovered {
                    Some(crate::tokens::ACCENT_DIM.into())
                } else {
                    None
                },
                text_color: if hovered { ACCENT_BRIGHT } else { text_color },
                border: Border {
                    color: if hovered { ACCENT_LINE } else { border_color },
                    width: 1.0,
                    radius: Radius::new(7.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

pub fn space_stepper<'a, Message: 'a>(
    step: u8,
    items: &'a [(u8, &'a str)],
) -> Element<'a, Message> {
    let nodes = items.iter().map(|(n, label)| {
        let on = *n == step;
        let done = *n < step;
        let mark = if done { "✓" } else { "" };
        let caption = if done {
            format!("{mark} {label}")
        } else {
            format!("{n} {label}")
        };
        text(caption)
            .size(12)
            .color(if on {
                ACCENT
            } else if done {
                TEXT_2
            } else {
                TEXT_3
            })
            .into()
    });
    row(nodes).spacing(16).into()
}

pub fn window_settings() -> window::Settings {
    // The `platform_specific` field is macOS-only. Gating the field instead of
    // mutating a `mut` binding keeps this warning-free on Linux and Windows,
    // where the cfg block would vanish and leave the `mut` unused.
    window::Settings {
        size: Size::new(1280.0, 800.0),
        min_size: Some(Size::new(900.0, 600.0)),
        #[cfg(target_os = "macos")]
        platform_specific: window::settings::PlatformSpecific {
            title_hidden: true,
            titlebar_transparent: true,
            fullsize_content_view: true,
        },
        ..window::Settings::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nav_is_window_centred_not_content_box() {
        let width = 1280.0;
        let centred = nav_origin_x(width);
        let content_centred = TRAFFIC_INSET + (width - TRAFFIC_INSET - 10.0 - TRACK_W) / 2.0;
        assert!((centred - (width - TRACK_W) / 2.0).abs() < f32::EPSILON);
        assert!((centred - content_centred).abs() > 1.0);
        assert_eq!(TRAFFIC_INSET, 78.0);
        assert_eq!(rail::rail_width(true), rail::RAIL_COLLAPSED);
        assert_eq!(rail::rail_width(false), rail::RAIL_EXPANDED);
        assert_eq!(MODES.len(), 7);
    }
}
