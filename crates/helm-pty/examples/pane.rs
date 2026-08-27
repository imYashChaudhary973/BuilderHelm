//! P0-8 spike: one pane — portable-pty + alacritty_terminal + iced.
//!
//! `cargo run -p helm-pty --example pane`

use std::io::{Read, Write};
use std::sync::mpsc;
use std::thread;

use helm_pty::Parser;
use iced::widget::{column, container, text};
use iced::{window, Color, Element, Fill, Font, Size, Subscription, Task};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

const COLS: usize = 80;
const ROWS: usize = 24;
const CELL_W: f32 = 7.2;
const CELL_H: f32 = 16.0;

struct State {
    parser: Parser,
    rx: mpsc::Receiver<Vec<u8>>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Debug, Clone)]
enum Message {
    Tick,
    Resized(Size),
}

fn boot() -> State {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: ROWS as u16,
            cols: COLS as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("open pty");
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.arg("-f");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    pair.slave.spawn_command(cmd).expect("spawn shell");
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let mut writer = pair.master.take_writer().expect("writer");
    writer
        .write_all(
            "printf '\\e[31mRED\\e[0m \\e[38;2;182;212;117mTRUECOLOR\\e[0m 日本語 🚀\\n'\n"
                .as_bytes(),
        )
        .ok();
    let (tx, rx) = mpsc::channel();
    std::mem::forget(writer);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    State {
        parser: Parser::new(COLS, ROWS, 1000),
        rx,
        master: pair.master,
    }
}

fn update(state: &mut State, message: Message) -> Task<Message> {
    match message {
        Message::Tick => {
            while let Ok(bytes) = state.rx.try_recv() {
                state.parser.feed(&bytes);
            }
        }
        Message::Resized(size) => {
            let cols = ((size.width / CELL_W).floor() as usize).max(8);
            let rows = ((size.height / CELL_H).floor() as usize).max(4);
            state.parser.resize(cols, rows);
            let _ = state.master.resize(PtySize {
                rows: rows as u16,
                cols: cols as u16,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }
    Task::none()
}

fn subscription(_state: &State) -> Subscription<Message> {
    Subscription::batch([
        window::frames().map(|_| Message::Tick),
        window::resize_events().map(|(_, size)| Message::Resized(size)),
    ])
}

fn view(state: &State) -> Element<'_, Message> {
    let snap = state.parser.snapshot();
    let lines = snap.lines.into_iter().map(|line| {
        text(line)
            .size(13)
            .font(Font::MONOSPACE)
            .color(Color::from_rgb(0.93, 0.94, 0.89))
            .into()
    });
    container(column(lines).spacing(0))
        .width(Fill)
        .height(Fill)
        .padding(8)
        .style(|_| container::Style {
            background: Some(Color::from_rgb(0.03, 0.04, 0.03).into()),
            ..container::Style::default()
        })
        .into()
}

fn main() -> iced::Result {
    iced::application(boot, update, view)
        .title("P0-8 terminal pane")
        .subscription(subscription)
        .window_size(Size::new(COLS as f32 * CELL_W, ROWS as f32 * CELL_H + 16.0))
        .run()
}
