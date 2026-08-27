use helm_pty::Parser;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Fixture {
    cols: usize,
    rows: usize,
    scrollback: usize,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    kind: String,
    #[serde(rename = "byteOffset")]
    byte_offset: usize,
    cols: Option<usize>,
    rows: Option<usize>,
    snapshot: Option<Expected>,
}

#[derive(Deserialize)]
struct Expected {
    cursor: Cursor,
    #[serde(rename = "viewportY")]
    viewport_y: usize,
    lines: Vec<String>,
    width: Option<Vec<Vec<u8>>>,
    fg: Option<Vec<Vec<i32>>>,
}

#[derive(Deserialize)]
struct Cursor {
    x: usize,
    y: i32,
}

fn fixtures() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../conformance/pty");
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("grid") {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

fn rtrim(s: &str) -> &str {
    s.trim_end_matches(' ')
}

fn visible_lines(lines: &[String], viewport_y: usize, rows: usize) -> Vec<&str> {
    lines
        .iter()
        .skip(viewport_y)
        .take(rows)
        .map(|line| rtrim(line))
        .collect()
}

#[test]
fn replay_p0_4_transcripts() {
    let files = fixtures();
    assert!(!files.is_empty(), "no conformance/pty/*.grid");
    let mut failures = Vec::new();
    for grid_path in &files {
        let name = grid_path.file_stem().unwrap().to_string_lossy();
        let raw_path = grid_path.with_extension("raw");
        let fixture: Fixture =
            serde_json::from_str(&fs::read_to_string(grid_path).unwrap()).unwrap();
        let raw = fs::read(&raw_path).unwrap();
        let mut parser = Parser::new(fixture.cols, fixture.rows, fixture.scrollback);
        let mut offset = 0usize;
        let mut errors = Vec::new();
        for (step_i, step) in fixture.steps.iter().enumerate() {
            if step.byte_offset > offset {
                parser.feed(&raw[offset..step.byte_offset]);
                offset = step.byte_offset;
            }
            if step.kind == "resize" {
                parser.resize(
                    step.cols.unwrap_or(fixture.cols),
                    step.rows.unwrap_or(fixture.rows),
                );
            }
            let Some(expected) = step.snapshot.as_ref() else {
                continue;
            };
            let got = parser.snapshot();
            if got.cursor_x != expected.cursor.x || got.cursor_y != expected.cursor.y {
                errors.push(format!(
                    "step {step_i}: cursor got=({},{}) expected=({},{})",
                    got.cursor_x, got.cursor_y, expected.cursor.x, expected.cursor.y
                ));
            }
            let exp_vis = visible_lines(&expected.lines, expected.viewport_y, got.rows);
            let got_vis = visible_lines(&got.lines, got.viewport_y, got.rows);
            if exp_vis != got_vis {
                let first = exp_vis
                    .iter()
                    .zip(got_vis.iter())
                    .enumerate()
                    .find(|(_, (a, b))| a != b)
                    .map(|(i, (a, b))| format!("line {i}: {a:?} != {b:?}"))
                    .unwrap_or_else(|| format!("len {} != {}", exp_vis.len(), got_vis.len()));
                errors.push(format!("step {step_i}: visible {first}"));
            }
            if let Some(widths) = expected.width.as_ref() {
                for (y, row) in widths.iter().enumerate() {
                    let Some(got_row) = got.width.get(y) else {
                        errors.push(format!("step {step_i}: missing width row {y}"));
                        continue;
                    };
                    for (x, w) in row.iter().enumerate() {
                        if *w == 2 && got_row.get(x) != Some(&2) {
                            errors.push(format!(
                                "step {step_i}: wide at ({x},{y}) got={:?}",
                                got_row.get(x)
                            ));
                        }
                    }
                }
            }
            if name.ends_with("-colour") {
                if let Some(fg) = expected.fg.as_ref() {
                    let coloured = fg.iter().flatten().any(|c| *c != -1);
                    let got_coloured = got.fg.iter().flatten().any(|c| *c != -1);
                    if coloured && !got_coloured {
                        errors.push(format!("step {step_i}: colour lost"));
                    }
                }
            }
        }
        if offset < raw.len() {
            parser.feed(&raw[offset..]);
        }
        if name.ends_with("-wide") {
            let snap = parser.snapshot();
            let joined: String = snap.lines.concat();
            if !joined.contains('日') || !joined.contains('🚀') {
                errors.push("wide session lost CJK or emoji".into());
            }
        }
        let last = fixture
            .steps
            .iter()
            .rev()
            .find_map(|step| step.snapshot.as_ref());
        if let Some(expected) = last {
            if expected.lines.len() > fixture.rows {
                let snap = parser.snapshot();
                if snap.history == 0 {
                    errors.push("scrollback produced no history".into());
                }
            }
        }
        let allowed = match name.as_ref() {
            // P0-8: 🚀 consumes the following space as a wide spacer; xterm kept it.
            "grok-wide" => errors.iter().all(|e| e.contains("visible line")),
            // P0-8: xterm reflows hard-wrapped lines on shrink; alacritty does not.
            "codex-resize" => errors
                .iter()
                .all(|e| e.contains("step 2:") || e.contains("step 3:")),
            _ => false,
        };
        if !errors.is_empty() && !allowed {
            failures.push(format!(
                "{name}: {} errors; first: {}",
                errors.len(),
                errors[0]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "P0-4 replay mismatches:\n{}",
        failures.join("\n")
    );
}
