//! `git-sidebar.tsx` (244 lines).
//!
//! The `editor.git` / `gitStage` / `gitCommit` calls are host-side; this port
//! runs the same state machine over local state. Every gate is preserved:
//! commit needs staged changes *and* a non-empty trimmed message, and staging
//! flips exactly the rows the TSX flips.

use iced::widget::{column, container, row, text, text_input};
use iced::{Element, Fill, Font, Task};

use crate::routes::common::{error_banner, primary_button, text_button};
use crate::tokens::{ACCENT, ACCENT_DIM, ACCENT_LINE, BG_1, LINE, TEXT, TEXT_2, TEXT_3};

/// `EditorGitChange.code` — M / A / D / R.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    Modified,
    Added,
    Deleted,
    Renamed,
}

impl Code {
    pub fn label(self) -> &'static str {
        match self {
            Code::Modified => "M",
            Code::Added => "A",
            Code::Deleted => "D",
            Code::Renamed => "R",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub code: Code,
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    Changes,
    History,
}

/// `fileName`.
pub fn file_name(path: &str) -> &str {
    path.split('/')
        .rfind(|part| !part.is_empty())
        .unwrap_or(path)
}

/// `dirLabel`.
pub fn dir_label(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() > 1 {
        parts[..parts.len() - 1].join("/")
    } else {
        String::new()
    }
}

pub struct State {
    pub has_repo: bool,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    pub commits: Vec<Commit>,
    pub view: View,
    pub picked: Option<String>,
    pub message: String,
    pub error: Option<String>,
    next_commit: u32,
}

impl Default for State {
    fn default() -> Self {
        Self {
            has_repo: true,
            branch: "feat/swarm-v2".into(),
            ahead: 2,
            behind: 0,
            changes: vec![
                Change {
                    path: "crates/helm-ui/src/lib.rs".into(),
                    code: Code::Modified,
                    staged: true,
                },
                Change {
                    path: "crates/helm-ui/src/terminal.rs".into(),
                    code: Code::Added,
                    staged: true,
                },
                Change {
                    path: "crates/helm-ui/src/shell.rs".into(),
                    code: Code::Modified,
                    staged: false,
                },
                Change {
                    path: "docs/STATUS.md".into(),
                    code: Code::Modified,
                    staged: false,
                },
                Change {
                    path: "apps/desktop/main.ts".into(),
                    code: Code::Deleted,
                    staged: false,
                },
            ],
            commits: vec![
                Commit {
                    sha: "9f2c41aabbccddeeff00112233445566778899aa".into(),
                    short_sha: "9f2c41a".into(),
                    subject: "P4-3 terminal pane widget".into(),
                },
                Commit {
                    sha: "3d7b92ccddeeff00112233445566778899aabbcc".into(),
                    short_sha: "3d7b92c".into(),
                    subject: "P4-2 app shell in iced".into(),
                },
            ],
            view: View::Changes,
            picked: None,
            message: String::new(),
            error: None,
            next_commit: 7,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    View(View),
    Pick(String),
    Stage(String, bool),
    StageAll,
    Message(String),
    Commit,
}

impl State {
    pub fn staged(&self) -> Vec<&Change> {
        self.changes.iter().filter(|c| c.staged).collect()
    }

    pub fn work(&self) -> Vec<&Change> {
        self.changes.iter().filter(|c| !c.staged).collect()
    }

    /// `disabled={busy || staged.length === 0 || message.trim().length === 0}`.
    pub fn can_commit(&self) -> bool {
        !self.staged().is_empty() && !self.message.trim().is_empty()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::View(view) => self.view = view,
            Message::Pick(path) => self.picked = Some(path),
            Message::Stage(path, staged) => {
                // `gitStage({ path, staged })` — flip exactly this row.
                match self
                    .changes
                    .iter_mut()
                    .find(|change| change.path == path && change.staged != staged)
                {
                    Some(change) => change.staged = staged,
                    None => self.error = Some("Stage failed".into()),
                }
            }
            Message::StageAll => {
                // `gitStage({ path: undefined, staged: true })` — every work row.
                for change in &mut self.changes {
                    change.staged = true;
                }
            }
            Message::Message(value) => self.message = value,
            Message::Commit => {
                if !self.can_commit() {
                    return Task::none();
                }
                let subject = self.message.trim().to_string();
                let sha = format!(
                    "{:040x}",
                    u64::from(self.next_commit).wrapping_mul(0x9e37_79b9)
                        + self.commits.len() as u64
                );
                self.next_commit += 1;
                self.commits.insert(
                    0,
                    Commit {
                        short_sha: sha[..7].to_string(),
                        sha,
                        subject,
                    },
                );
                self.changes.retain(|change| !change.staged);
                self.message.clear();
                self.error = None;
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        if !self.has_repo {
            return empty_side("This folder is not a git repository.");
        }
        let top = row![
            text(self.branch.clone())
                .size(13.0)
                .font(Font::MONOSPACE)
                .color(TEXT),
            text(format!("↑{}", self.ahead)).size(11.0).color(TEXT_2),
            text(format!("↓{}", self.behind)).size(11.0).color(TEXT_2),
            iced::widget::Space::new().width(Fill),
        ]
        .spacing(6)
        .align_y(iced::Alignment::Center);

        let views = row![
            iced::widget::button(
                row![
                    text("Changes").size(12.0),
                    text(self.changes.len().to_string()).size(12.0),
                ]
                .spacing(4),
            )
            .padding([4, 8])
            .on_press(Message::View(View::Changes))
            .style(seg(self.view == View::Changes)),
            iced::widget::button(text("History").size(12.0))
                .padding([4, 8])
                .on_press(Message::View(View::History))
                .style(seg(self.view == View::History)),
        ]
        .spacing(4);

        let mut cell: Vec<Element<'_, Message>> = vec![top.into(), views.into()];
        if let Some(error) = &self.error {
            cell.push(error_banner(error.clone()));
        }
        cell.push(match self.view {
            View::Changes => self.changes_view(),
            View::History => self.history_view(),
        });
        cell.push(self.commit_bar());
        cell.push(
            text(if self.picked.is_none() {
                "Select a file to inspect it.".to_string()
            } else {
                file_name(self.picked.as_deref().unwrap_or_default()).to_string()
            })
            .size(11.0)
            .color(TEXT_3)
            .into(),
        );
        container(column(cell).spacing(8))
            .width(Fill)
            .height(Fill)
            .padding(8)
            .into()
    }

    fn changes_view(&self) -> Element<'_, Message> {
        let staged = self.staged();
        let work = self.work();
        column![
            section(
                "Staged",
                staged.len(),
                staged.iter().map(|c| change_row(c, self)),
            ),
            section(
                "Changes",
                work.len(),
                work.iter().map(|c| change_row(c, self)),
            ),
            maybe_stage_all(!work.is_empty()),
        ]
        .spacing(8)
        .into()
    }

    fn history_view(&self) -> Element<'_, Message> {
        if self.commits.is_empty() {
            return empty_side("No commits yet.");
        }
        column(self.commits.iter().map(|commit| {
            let row: Element<'_, Message> = row![
                text(commit.short_sha.clone())
                    .size(11.0)
                    .font(Font::MONOSPACE)
                    .color(ACCENT),
                text(commit.subject.clone()).size(12.0).color(TEXT_2),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center)
            .into();
            row
        }))
        .spacing(6)
        .into()
    }

    fn commit_bar(&self) -> Element<'_, Message> {
        row![
            text_input("Commit message", &self.message)
                .on_input(Message::Message)
                .on_submit(Message::Commit)
                .padding(6),
            primary_button("Commit", self.can_commit().then_some(Message::Commit)),
        ]
        .spacing(6)
        .align_y(iced::Alignment::Center)
        .into()
    }
}

fn empty_side<'a, M: 'a>(message: &str) -> Element<'a, M> {
    container(text(message.to_string()).size(12.0).color(TEXT_3))
        .width(Fill)
        .height(Fill)
        .padding(16)
        .into()
}

fn seg(
    on: bool,
) -> impl Fn(&iced::Theme, iced::widget::button::Status) -> iced::widget::button::Style {
    move |_, status| {
        let hovered = matches!(status, iced::widget::button::Status::Hovered);
        iced::widget::button::Style {
            background: if on || hovered {
                Some(ACCENT_DIM.into())
            } else {
                None
            },
            text_color: if on || hovered { ACCENT } else { TEXT_2 },
            border: iced::Border {
                color: if on { ACCENT_LINE } else { LINE },
                width: 1.0,
                radius: iced::border::Radius::new(6.0),
            },
            shadow: iced::Shadow::default(),
            snap: true,
        }
    }
}

fn section<'a>(
    label: &str,
    count: usize,
    rows: impl Iterator<Item = Element<'a, Message>>,
) -> Element<'a, Message> {
    let mut cell: Vec<Element<'a, Message>> = vec![row![
        text(label.to_string()).size(11.0).color(TEXT_3),
        text(count.to_string()).size(11.0).color(TEXT_3),
    ]
    .spacing(6)
    .align_y(iced::Alignment::Center)
    .into()];
    if count == 0 {
        cell.push(
            text(if label == "Staged" {
                "No staged changes"
            } else {
                "Working tree clean"
            })
            .size(11.0)
            .color(TEXT_3)
            .into(),
        );
    } else {
        cell.push(column(rows).spacing(2).into());
    }
    container(column(cell).spacing(4))
        .width(Fill)
        .padding(8)
        .style(|_| container::Style {
            background: Some(BG_1.into()),
            border: iced::Border {
                color: LINE,
                width: 1.0,
                radius: iced::border::Radius::new(8.0),
            },
            ..container::Style::default()
        })
        .into()
}

/// One `gitChanges` row: pick + stage/unstage action.
fn change_row<'a>(change: &'a Change, _state: &State) -> Element<'a, Message> {
    let path = change.path.clone();
    let staged = change.staged;
    row![
        iced::widget::button(
            row![
                text(change.code.label())
                    .size(10.0)
                    .color(if staged { ACCENT } else { TEXT_3 }),
                column![
                    text(file_name(&change.path).to_string())
                        .size(11.0)
                        .color(TEXT_2),
                    text(dir_label(&change.path)).size(10.0).color(TEXT_3),
                ]
                .spacing(1),
            ]
            .spacing(6)
            .align_y(iced::Alignment::Center),
        )
        .padding([3, 6])
        .on_press(Message::Pick(path.clone()))
        .style(|_, status| {
            let hovered = matches!(status, iced::widget::button::Status::Hovered);
            iced::widget::button::Style {
                background: if hovered {
                    Some(ACCENT_DIM.into())
                } else {
                    None
                },
                text_color: TEXT_2,
                border: iced::Border {
                    color: LINE,
                    width: 1.0,
                    radius: iced::border::Radius::new(5.0),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        }),
        iced::widget::Space::new().width(Fill),
        iced::widget::button(
            text(if staged { "−" } else { "+" })
                .size(12.0)
                .color(TEXT_2)
        )
        .padding([3, 8])
        .on_press(Message::Stage(path, !staged))
        .style(|_, status| {
            let hovered = matches!(status, iced::widget::button::Status::Hovered);
            iced::widget::button::Style {
                background: if hovered {
                    Some(ACCENT_DIM.into())
                } else {
                    None
                },
                text_color: if hovered { ACCENT } else { TEXT_2 },
                border: iced::Border {
                    color: if hovered { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: iced::border::Radius::new(5.0),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        }),
    ]
    .spacing(4)
    .align_y(iced::Alignment::Center)
    .into()
}

fn maybe_stage_all(show: bool) -> Element<'static, Message> {
    if show {
        text_button("Stage all", Some(Message::StageAll))
    } else {
        column([]).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_needs_staged_and_a_message() {
        let mut state = State::default();
        assert!(!state.can_commit(), "message empty");
        let _ = state.update(Message::Message("  ".into()));
        assert!(!state.can_commit(), "whitespace message");
        let _ = state.update(Message::Message("Port sidebars".into()));
        assert!(state.can_commit());

        let mut bare = State::default();
        bare.changes.clear();
        let _ = bare.update(Message::Message("Port sidebars".into()));
        assert!(!bare.can_commit(), "nothing staged");
    }

    #[test]
    fn commit_consumes_staged_and_records_history() {
        let mut state = State::default();
        let staged_before = state.staged().len();
        let commits_before = state.commits.len();
        let _ = state.update(Message::Message("Port sidebars".into()));
        let _ = state.update(Message::Commit);
        assert_eq!(state.commits.len(), commits_before + 1);
        assert_eq!(state.commits[0].subject, "Port sidebars");
        assert_eq!(state.commits[0].short_sha.len(), 7);
        assert!(
            state.changes.iter().all(|change| !change.staged),
            "committed rows leave the change list"
        );
        assert_eq!(state.changes.len(), 3, "work rows survive: {staged_before}");
        assert!(state.message.is_empty(), "message clears");
        assert!(!state.can_commit(), "no re-commit after clear");
    }

    #[test]
    fn stage_flips_exactly_one_row() {
        let mut state = State::default();
        let shell = "crates/helm-ui/src/shell.rs".to_string();
        assert!(state
            .changes
            .iter()
            .find(|c| c.path == shell)
            .is_some_and(|c| !c.staged));
        let _ = state.update(Message::Stage(shell.clone(), true));
        assert!(state
            .changes
            .iter()
            .find(|c| c.path == shell)
            .is_some_and(|c| c.staged));
        let _ = state.update(Message::Stage(shell, false));
        assert_eq!(state.staged().len(), 2, "only the one row flipped back");
    }

    #[test]
    fn stage_all_stages_every_work_row() {
        let mut state = State::default();
        let _ = state.update(Message::StageAll);
        assert_eq!(state.work().len(), 0);
        assert_eq!(state.staged().len(), state.changes.len());
    }

    #[test]
    fn views_switch_and_picked_names_the_file() {
        let mut state = State::default();
        let _ = state.update(Message::View(View::History));
        assert_eq!(state.view, View::History);
        let _ = state.update(Message::Pick("crates/helm-ui/src/lib.rs".into()));
        assert_eq!(state.picked.as_deref(), Some("crates/helm-ui/src/lib.rs"));
        assert_eq!(file_name(state.picked.as_deref().unwrap()), "lib.rs");
        assert_eq!(dir_label("crates/helm-ui/src/lib.rs"), "crates/helm-ui/src");
        assert_eq!(dir_label("lib.rs"), "");
    }

    #[test]
    fn no_repo_shows_the_empty_state() {
        let state = State {
            has_repo: false,
            ..State::default()
        };
        let _ = state.view();
    }
}
