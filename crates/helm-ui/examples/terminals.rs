//! Twelve terminal panes on the P3-2 emulator. Header chrome from terminal-pane.tsx.
//!
//! `cargo run -p helm-ui --example terminals`

use helm_pty::{Parser, Snapshot};
use helm_ui::{helm_theme, terminal_pane, PaneMessage, PaneStatus, TerminalPane, CELL_H, CELL_W};
use iced::widget::{column, container, row};
use iced::{window, Element, Fill, Size, Subscription, Task};

const PANES: usize = 12;
const COLS: usize = 80;
const ROWS: usize = 24;

struct State {
    parsers: Vec<Parser>,
    snaps: Vec<Snapshot>,
    panes: Vec<TerminalPane>,
    n: u64,
}

fn boot() -> State {
    let parsers: Vec<_> = (0..PANES).map(|_| Parser::new(COLS, ROWS, 1000)).collect();
    let snaps = parsers.iter().map(Parser::snapshot).collect();
    let panes = (0..PANES)
        .map(|i| TerminalPane {
            title: format!("pane-{i}"),
            branch: Some(format!("feat/p4-3-{i}")),
            status: PaneStatus::Running,
            focused: i == 0,
            maximized: false,
            landing: false,
            confirm_land: false,
            show_land: i == 0,
            show_split: true,
        })
        .collect();
    State {
        parsers,
        snaps,
        panes,
        n: 0,
    }
}

#[derive(Debug, Clone)]
enum Message {
    Tick,
    Pane(usize, PaneMessage),
}

fn update(state: &mut State, message: Message) -> Task<Message> {
    match message {
        Message::Tick => {
            state.n += 1;
            let line = format!(
                "\x1b[32m{:>6}\x1b[0m \x1b[38;2;182;212;117mstream\x1b[0m pane-load 日本語 🚀\r\n",
                state.n
            );
            for parser in &mut state.parsers {
                parser.feed(line.as_bytes());
            }
            state.snaps = state.parsers.iter().map(Parser::snapshot).collect();
        }
        Message::Pane(i, PaneMessage::Close) => {
            if let Some(pane) = state.panes.get_mut(i) {
                pane.status = PaneStatus::Exited;
            }
        }
        Message::Pane(i, PaneMessage::Maximize) => {
            if let Some(pane) = state.panes.get_mut(i) {
                pane.maximized = !pane.maximized;
            }
        }
        Message::Pane(i, PaneMessage::Focus) => {
            for (j, pane) in state.panes.iter_mut().enumerate() {
                pane.focused = i == j;
            }
        }
        Message::Pane(i, PaneMessage::Land) => {
            if let Some(pane) = state.panes.get_mut(i) {
                pane.confirm_land = !pane.confirm_land;
            }
        }
        Message::Pane(_, _) => {}
    }
    Task::none()
}

fn subscription(_state: &State) -> Subscription<Message> {
    window::frames().map(|_| Message::Tick)
}

fn view(state: &State) -> Element<'_, Message> {
    let grid = column![
        row![
            cell(state, 0),
            cell(state, 1),
            cell(state, 2),
            cell(state, 3)
        ]
        .spacing(8)
        .height(Fill),
        row![
            cell(state, 4),
            cell(state, 5),
            cell(state, 6),
            cell(state, 7)
        ]
        .spacing(8)
        .height(Fill),
        row![
            cell(state, 8),
            cell(state, 9),
            cell(state, 10),
            cell(state, 11)
        ]
        .spacing(8)
        .height(Fill),
    ]
    .spacing(8);
    container(grid).padding(8).width(Fill).height(Fill).into()
}

fn cell(state: &State, i: usize) -> Element<'_, Message> {
    terminal_pane(&state.panes[i], &state.snaps[i]).map(move |msg| Message::Pane(i, msg))
}

fn theme(_state: &State) -> iced::Theme {
    helm_theme()
}

fn main() -> iced::Result {
    iced::application(boot, update, view)
        .theme(theme)
        .subscription(subscription)
        .title("BuilderHelm terminals")
        .window_size(Size::new(
            4.0 * (COLS as f32 * CELL_W + 24.0),
            3.0 * (ROWS as f32 * CELL_H + 48.0),
        ))
        .run()
}
