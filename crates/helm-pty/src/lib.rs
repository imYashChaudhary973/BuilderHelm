mod manager;
mod spawn;

pub use manager::{
    BoardCreateInput, BoardPaneSpec, BoardPaneSummary, BoardPtyManager, BoardSessionSummary,
    SpawnArgs,
};
pub use spawn::{
    ensure_helper, probe_pty, spawn_argv_pty, spawn_attempts, spawn_helper_path, spawn_pty,
    terminal_env, LivePty,
};

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor};

#[derive(Clone, Copy)]
pub struct TermSize {
    pub cols: usize,
    pub rows: usize,
}

impl Dimensions for TermSize {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

pub struct Parser {
    term: Term<VoidListener>,
    vte: Processor,
    size: TermSize,
}

impl Parser {
    pub fn new(cols: usize, rows: usize, scrollback: usize) -> Self {
        let size = TermSize { cols, rows };
        let config = Config {
            scrolling_history: scrollback,
            ..Config::default()
        };
        Self {
            term: Term::new(config, &size, VoidListener),
            vte: Processor::new(),
            size,
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.vte.advance(&mut self.term, bytes);
    }

    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.size = TermSize { cols, rows };
        self.term.resize(self.size);
    }

    pub fn snapshot(&self) -> Snapshot {
        let grid = self.term.grid();
        let cols = grid.columns();
        let rows = grid.screen_lines();
        let history = grid.history_size();
        let display_offset = grid.display_offset();
        let top = grid.topmost_line().0;
        let bottom = grid.bottommost_line().0;
        let mut lines = Vec::with_capacity((bottom - top + 1) as usize);
        for y in top..=bottom {
            lines.push(line_text(&grid[Line(y)], cols));
        }
        let mut width = Vec::with_capacity(rows);
        let mut fg = Vec::with_capacity(rows);
        let view_top = -(display_offset as i32);
        for y in 0..rows {
            let row = &grid[Line(view_top + y as i32)];
            let mut widths = Vec::with_capacity(cols);
            let mut colors = Vec::with_capacity(cols);
            for x in 0..cols {
                let cell = &row[Column(x)];
                widths.push(cell_width(cell.flags));
                colors.push(cell_fg(cell.fg));
            }
            width.push(widths);
            fg.push(colors);
        }
        let cursor = grid.cursor.point;
        Snapshot {
            cols,
            rows,
            cursor_x: cursor.column.0,
            cursor_y: cursor.line.0,
            viewport_y: history.saturating_sub(display_offset),
            length: lines.len(),
            history,
            lines,
            width,
            fg,
        }
    }

    pub fn select(&mut self, start_col: usize, start_row: i32, end_col: usize, end_row: i32) {
        let start = self.viewport_point(start_col, start_row);
        let end = self.viewport_point(end_col, end_row);
        let mut selection = Selection::new(SelectionType::Simple, start, Side::Left);
        selection.update(end, Side::Right);
        self.term.selection = Some(selection);
    }

    pub fn selection_text(&self) -> Option<String> {
        self.term.selection_to_string()
    }

    fn viewport_point(&self, col: usize, row: i32) -> Point {
        let offset = self.term.grid().display_offset() as i32;
        Point::new(Line(row - offset), Column(col))
    }
}

fn line_text(
    row: &alacritty_terminal::grid::Row<alacritty_terminal::term::cell::Cell>,
    cols: usize,
) -> String {
    let mut line = String::new();
    for x in 0..cols {
        let cell = &row[Column(x)];
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
            continue;
        }
        line.push(cell.c);
    }
    line
}

fn cell_width(flags: Flags) -> u8 {
    if flags.contains(Flags::WIDE_CHAR) {
        2
    } else if flags.contains(Flags::WIDE_CHAR_SPACER) {
        0
    } else {
        1
    }
}

fn cell_fg(color: Color) -> i32 {
    match color {
        Color::Named(
            NamedColor::Foreground
            | NamedColor::Background
            | NamedColor::Cursor
            | NamedColor::BrightForeground
            | NamedColor::DimForeground,
        ) => -1,
        Color::Named(name) => name as i32,
        Color::Indexed(n) => i32::from(n),
        Color::Spec(rgb) => (i32::from(rgb.r) << 16) | (i32::from(rgb.g) << 8) | i32::from(rgb.b),
    }
}

pub struct Snapshot {
    pub cols: usize,
    pub rows: usize,
    pub cursor_x: usize,
    pub cursor_y: i32,
    pub viewport_y: usize,
    pub length: usize,
    pub history: usize,
    pub lines: Vec<String>,
    pub width: Vec<Vec<u8>>,
    pub fg: Vec<Vec<i32>>,
}

#[cfg(test)]
mod tests {
    use super::Parser;

    #[test]
    fn parses_cjk_and_color() {
        let mut parser = Parser::new(40, 8, 100);
        parser.feed(b"\x1b[31mRED\x1b[0m ");
        parser.feed("日本語 🚀\n".as_bytes());
        let snap = parser.snapshot();
        let joined: String = snap.lines.concat();
        assert!(joined.contains("RED"), "{joined:?}");
        assert!(joined.contains('日'), "{joined:?}");
        assert!(snap.width[0].contains(&2), "{:?}", snap.width[0]);
        assert!(snap.fg[0].contains(&1), "{:?}", snap.fg[0]);
    }

    #[test]
    fn copies_simple_selection() {
        let mut parser = Parser::new(20, 4, 10);
        parser.feed(b"hello\r\nworld\n");
        parser.select(0, 0, 4, 0);
        assert_eq!(parser.selection_text().as_deref(), Some("hello"));
    }
}
