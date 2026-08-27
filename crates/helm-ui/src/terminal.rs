use helm_pty::Snapshot;
use iced::border::Radius;
use iced::widget::{button, column, container, row, text, Space};
use iced::widget::{rich_text, span};
use iced::{Border, Color, Element, Fill, Font, Padding};

use crate::tokens::{
    ACCENT, ACCENT_BRIGHT, ACCENT_DIM, ACCENT_LINE, DANGER, GLASS, GLASS_STRONG, LINE, TEXT,
    TEXT_2, TEXT_3, WARNING,
};

pub const CELL_W: f32 = 7.2;
pub const CELL_H: f32 = 16.0;
pub const TERM_BG: Color = crate::tokens::rgb(0x0b0d12);
const HEADER_H: f32 = 32.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Clone, Debug)]
pub struct TerminalPane {
    pub title: String,
    pub branch: Option<String>,
    pub status: PaneStatus,
    pub focused: bool,
    pub maximized: bool,
    pub landing: bool,
    pub confirm_land: bool,
    pub show_land: bool,
    pub show_split: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaneMessage {
    Land,
    Maximize,
    Split,
    Close,
    Copy,
    Focus,
}

pub fn viewport_range(snap: &Snapshot) -> (usize, usize) {
    let start = snap.viewport_y.min(snap.lines.len());
    let end = (start + snap.rows).min(snap.lines.len());
    (start, end)
}

pub fn fg_color(code: i32) -> Color {
    if code < 0 {
        return TEXT;
    }
    if code > 255 {
        let r = ((code >> 16) & 0xff) as u8;
        let g = ((code >> 8) & 0xff) as u8;
        let b = (code & 0xff) as u8;
        return crate::tokens::rgba(r, g, b, 1.0);
    }
    indexed(code as u8)
}

fn indexed(n: u8) -> Color {
    match n {
        0 => crate::tokens::rgb(0x1a1a1a),
        1 | 9 => crate::tokens::rgb(0xff5555),
        2 | 10 => ACCENT,
        3 | 11 => WARNING,
        4 | 12 => crate::tokens::rgb(0x7ec8e3),
        5 | 13 => crate::tokens::rgb(0xc4b5fd),
        6 | 14 => crate::tokens::rgb(0x7dd3fc),
        7 | 15 => TEXT,
        n if n < 232 => {
            let n = n - 16;
            let r = n / 36;
            let g = (n / 6) % 6;
            let b = n % 6;
            let step = |v: u8| if v == 0 { 0 } else { 55 + 40 * v };
            crate::tokens::rgba(step(r), step(g), step(b), 1.0)
        }
        n => {
            let v = 8 + 10 * (n - 232);
            crate::tokens::rgba(v, v, v, 1.0)
        }
    }
}

pub fn terminal_pane<'a>(pane: &'a TerminalPane, snap: &'a Snapshot) -> Element<'a, PaneMessage> {
    let border = if pane.focused { ACCENT_LINE } else { LINE };
    iced::widget::mouse_area(
        container(column![header(pane), body(snap)].width(Fill).height(Fill))
            .width(Fill)
            .height(Fill)
            .style(move |_| container::Style {
                background: Some(TERM_BG.into()),
                border: Border {
                    color: border,
                    width: 1.0,
                    radius: Radius::new(14.0),
                },
                ..container::Style::default()
            }),
    )
    .on_press(PaneMessage::Focus)
    .into()
}

fn header(pane: &TerminalPane) -> Element<'_, PaneMessage> {
    let status = pane.status;
    let dot = container(Space::new().width(9).height(9)).style(move |_| {
        let color = match status {
            PaneStatus::Starting => WARNING,
            PaneStatus::Running => ACCENT,
            PaneStatus::Exited => TEXT_3,
            PaneStatus::Failed => DANGER,
        };
        container::Style {
            background: Some(color.into()),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        }
    });
    let mut items: Vec<Element<'_, PaneMessage>> = vec![
        dot.into(),
        text(pane.title.clone())
            .size(12)
            .font(Font::MONOSPACE)
            .color(TEXT_2)
            .into(),
        Space::new().width(Fill).into(),
    ];
    if let Some(branch) = &pane.branch {
        items.push(
            container(
                text(branch.clone())
                    .size(11)
                    .font(Font::MONOSPACE)
                    .color(TEXT_2),
            )
            .padding(Padding {
                top: 1.0,
                right: 7.0,
                bottom: 1.0,
                left: 7.0,
            })
            .style(|_| container::Style {
                background: Some(GLASS.into()),
                border: Border {
                    color: LINE,
                    width: 1.0,
                    radius: Radius::new(99.0),
                },
                ..container::Style::default()
            })
            .into(),
        );
    }
    if pane.show_land {
        let label = if pane.confirm_land { "Confirm" } else { "Land" };
        items.push(header_btn(label, Some(PaneMessage::Land), !pane.landing));
    }
    items.push(header_btn(
        if pane.maximized { "▣" } else { "□" },
        Some(PaneMessage::Maximize),
        true,
    ));
    items.push(header_btn("⧉", Some(PaneMessage::Copy), true));
    if pane.show_split {
        items.push(header_btn("+", Some(PaneMessage::Split), true));
    }
    items.push(header_btn("×", Some(PaneMessage::Close), true));
    container(row(items).spacing(8).align_y(iced::Alignment::Center))
        .padding(Padding {
            top: 7.0,
            right: 10.0,
            bottom: 7.0,
            left: 10.0,
        })
        .width(Fill)
        .height(HEADER_H)
        .style(|_| container::Style {
            background: Some(GLASS_STRONG.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(0.0),
            },
            ..container::Style::default()
        })
        .into()
}

fn header_btn<'a>(
    label: &'a str,
    msg: Option<PaneMessage>,
    enabled: bool,
) -> Element<'a, PaneMessage> {
    button(text(label).size(12).color(TEXT_2))
        .padding(4)
        .on_press_maybe(enabled.then_some(msg).flatten())
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: if hover { Some(ACCENT_DIM.into()) } else { None },
                text_color: if hover { ACCENT_BRIGHT } else { TEXT_2 },
                border: Border {
                    color: if hover {
                        ACCENT_LINE
                    } else {
                        Color::TRANSPARENT
                    },
                    width: 1.0,
                    radius: Radius::new(7.0),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        })
        .into()
}

fn body(snap: &Snapshot) -> Element<'_, PaneMessage> {
    let (start, end) = viewport_range(snap);
    let rows = (start..end).map(|i| {
        let view_row = i - start;
        let line = snap.lines.get(i).map(String::as_str).unwrap_or("");
        let widths = snap.width.get(view_row).map(Vec::as_slice).unwrap_or(&[]);
        let fgs = snap.fg.get(view_row).map(Vec::as_slice).unwrap_or(&[]);
        let cursor = (snap.cursor_y == view_row as i32).then_some(snap.cursor_x);
        row_line(line, widths, fgs, cursor)
    });
    container(column(rows).spacing(0))
        .width(Fill)
        .height(Fill)
        .padding(4)
        .into()
}

fn row_line<'a>(
    line: &'a str,
    widths: &'a [u8],
    fgs: &'a [i32],
    cursor: Option<usize>,
) -> Element<'a, PaneMessage> {
    let mut spans: Vec<iced::widget::text::Span<'a, ()>> = Vec::new();
    let mut chars = line.chars();
    let mut run = String::new();
    let mut run_fg = TEXT;
    let mut run_cursor = false;
    let flush = |run: &mut String,
                 fg: Color,
                 on_cursor: bool,
                 spans: &mut Vec<iced::widget::text::Span<'a, ()>>| {
        if run.is_empty() {
            return;
        }
        let mut s: iced::widget::text::Span<'a, ()> =
            span(std::mem::take(run)).color(fg).font(Font::MONOSPACE);
        if on_cursor {
            s = s.background(TEXT).color(TERM_BG);
        }
        spans.push(s);
    };
    for (x, width) in widths.iter().copied().enumerate() {
        if width == 0 {
            continue;
        }
        let Some(ch) = chars.next() else { break };
        let fg = fgs.get(x).copied().map(fg_color).unwrap_or(TEXT);
        let on_cursor = cursor == Some(x);
        if !run.is_empty() && (fg != run_fg || on_cursor != run_cursor) {
            flush(&mut run, run_fg, run_cursor, &mut spans);
        }
        if run.is_empty() {
            run_fg = fg;
            run_cursor = on_cursor;
        }
        run.push(ch);
        if on_cursor {
            flush(&mut run, run_fg, true, &mut spans);
        }
    }
    flush(&mut run, run_fg, run_cursor, &mut spans);
    if spans.is_empty() {
        spans.push(span(" ").font(Font::MONOSPACE).color(TEXT));
    }
    rich_text(spans).size(13).font(Font::MONOSPACE).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use helm_pty::Parser;

    #[test]
    fn viewport_is_screen_not_history() {
        let mut parser = Parser::new(40, 8, 200);
        for i in 0..80 {
            parser.feed(format!("line-{i}\r\n").as_bytes());
        }
        let snap = parser.snapshot();
        assert!(snap.history > 0 || snap.lines.len() > snap.rows);
        let (start, end) = viewport_range(&snap);
        assert_eq!(end - start, snap.rows.min(snap.lines.len()));
        assert!(end - start <= 8);
    }

    #[test]
    fn colours_match_ansi_and_truecolor() {
        let mut parser = Parser::new(40, 4, 0);
        parser.feed(b"\x1b[31mRED\x1b[0m \x1b[38;2;182;212;117mTRUE\x1b[0m\r\n");
        let snap = parser.snapshot();
        let fgs = &snap.fg[0];
        assert!(
            fgs.iter().any(|&c| c == 1 || c == 9),
            "red indexed: {fgs:?}"
        );
        assert!(
            fgs.contains(&((182 << 16) | (212 << 8) | 117)),
            "truecolor: {fgs:?}"
        );
        let tc = fg_color((182 << 16) | (212 << 8) | 117);
        assert!((tc.r - ACCENT.r).abs() < 0.01);
    }

    #[test]
    fn twelve_viewports_stay_bounded() {
        let mut parsers: Vec<_> = (0..12).map(|_| Parser::new(80, 24, 1000)).collect();
        let chunk = "\x1b[32mok\x1b[0m heavy line\r\n".repeat(200);
        for parser in &mut parsers {
            parser.feed(chunk.as_bytes());
        }
        let mut cells = 0;
        for parser in &parsers {
            let snap = parser.snapshot();
            let (start, end) = viewport_range(&snap);
            cells += end - start;
            assert!(end - start <= 24);
        }
        assert_eq!(cells, 12 * 24);
    }
}
