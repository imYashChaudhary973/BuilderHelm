//! `routes/projects.tsx` (262 lines).
//!
//! `ProjectStatus` / `TaskStatus` come from `super::today` so the two routes
//! cannot drift apart; the TSX shares them via `@zero/protocol`.

use iced::widget::{column, container, row, Space};
use iced::{Element, Fill, Task};

use super::common::{
    body, card, dim, empty_state, error_banner, eyebrow, h1, h2, h3, lede, page, pill,
    primary_button, section_heading, stack_16, text_button,
};
use super::today::{ProjectStatus, TaskStatus};
use super::Route;
use crate::tokens::{ACCENT, TEXT, TEXT_2};

/// `projectTimelineItemSchema.kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineKind {
    Commit,
    Task,
    Decision,
}

impl TimelineKind {
    fn label(self) -> &'static str {
        match self {
            TimelineKind::Commit => "commit",
            TimelineKind::Task => "task",
            TimelineKind::Decision => "decision",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TimelineItem {
    pub kind: TimelineKind,
    pub title: String,
    pub detail: Option<String>,
    pub occurred_at: String,
    pub state: Option<String>,
}

/// `projectRepositorySchema`.
#[derive(Clone, Debug)]
pub struct Repository {
    pub directory_name: String,
    pub branch: String,
    pub dirty_count: u32,
    pub ahead_count: u32,
    pub behind_count: u32,
}

#[derive(Clone, Debug)]
pub struct DetailTask {
    pub title: String,
    pub status: TaskStatus,
    pub priority: String,
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub title: String,
    pub created_at: String,
}

/// `projectDashboardSchema`.
#[derive(Clone, Debug)]
pub struct Dashboard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: ProjectStatus,
    pub repository: Option<Repository>,
    pub tasks: Vec<DetailTask>,
    pub decisions: Vec<Decision>,
    pub timeline: Vec<TimelineItem>,
}

pub struct State {
    pub projects: Vec<Dashboard>,
    pub selected: String,
    pub error: Option<String>,
    pub reading_git: bool,
}

impl Default for State {
    fn default() -> Self {
        let projects = vec![
            Dashboard {
                id: "helm".into(),
                name: "BuilderHelm".into(),
                description: Some("Local-first harness for building software.".into()),
                status: ProjectStatus::Active,
                repository: Some(Repository {
                    directory_name: "BuilderHelm".into(),
                    branch: "feat/swarm-v2".into(),
                    dirty_count: 3,
                    ahead_count: 2,
                    behind_count: 0,
                }),
                tasks: vec![
                    DetailTask {
                        title: "Port routes to iced".into(),
                        status: TaskStatus::InProgress,
                        priority: "high".into(),
                    },
                    DetailTask {
                        title: "Wire pane keyboard".into(),
                        status: TaskStatus::Blocked,
                        priority: "high".into(),
                    },
                ],
                decisions: vec![Decision {
                    title: "Custom terminal renderer, not iced_term".into(),
                    created_at: "26 Aug 09:12".into(),
                }],
                timeline: vec![
                    TimelineItem {
                        kind: TimelineKind::Commit,
                        title: "Add terminal pane widget".into(),
                        detail: Some("crates/helm-ui/src/terminal.rs".into()),
                        occurred_at: "27 Aug 14:02".into(),
                        state: None,
                    },
                    TimelineItem {
                        kind: TimelineKind::Decision,
                        title: "Drop signal-field".into(),
                        detail: Some("Permanent rAF spin for decoration.".into()),
                        occurred_at: "27 Aug 11:40".into(),
                        state: Some("accepted".into()),
                    },
                    TimelineItem {
                        kind: TimelineKind::Task,
                        title: "Port routes to iced".into(),
                        detail: None,
                        occurred_at: "27 Aug 09:05".into(),
                        state: Some("in_progress".into()),
                    },
                ],
            },
            Dashboard {
                id: "vault".into(),
                name: "Obsidian vault".into(),
                description: None,
                status: ProjectStatus::Paused,
                repository: None,
                tasks: vec![],
                decisions: vec![],
                timeline: vec![],
            },
        ];
        let selected = projects[0].id.clone();
        Self {
            projects,
            selected,
            error: None,
            reading_git: false,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Select(String),
    RepositoryAction,
    OpenActions,
}

impl State {
    pub fn nav_target(message: &Message) -> Option<Route> {
        match message {
            Message::OpenActions => Some(Route::Actions),
            _ => None,
        }
    }

    fn selected(&self) -> Option<&Dashboard> {
        self.projects.iter().find(|item| item.id == self.selected)
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            // `useEffect` in the TSX keeps the selection on a live project.
            Message::Select(id) => {
                if self.projects.iter().any(|item| item.id == id) {
                    self.selected = id;
                }
            }
            Message::RepositoryAction => {
                if self.reading_git {
                    return Task::none();
                }
                let dirty = self
                    .selected()
                    .and_then(|item| item.repository.as_ref())
                    .map(|repo| repo.dirty_count);
                match dirty {
                    // Refresh Git.
                    Some(_) => self.reading_git = false,
                    // Register repository: nothing to read until a folder exists.
                    None => {
                        self.error =
                            Some("Select a local Git folder before registering.".to_string())
                    }
                }
            }
            Message::OpenActions => {}
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let header = row![
            column![
                eyebrow("Phase 5 · local continuity"),
                h1("Projects"),
                lede("One timeline for the work, the decisions, and the code."),
            ]
            .spacing(6),
            Space::new().width(Fill),
            container(text_button(
                "Manage through Actions",
                Some(Message::OpenActions)
            ))
            .center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let mut items: Vec<Element<'_, Message>> = vec![header.into()];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }

        if self.projects.is_empty() {
            items.push(stack_16(vec![
                eyebrow("No active thread"),
                h2("Start with a project."),
                body(
                    "Create one through the permissioned Actions flow, then connect its \
                     local repository here.",
                ),
                primary_button("Open Actions", Some(Message::OpenActions)),
            ]));
        } else {
            let mut workspace: Vec<Element<'_, Message>> = vec![self.index()];
            if let Some(dashboard) = self.selected() {
                workspace.push(self.detail(dashboard));
            }
            items.push(row(workspace).spacing(16).into());
        }
        page(stack_16(items))
    }

    /// `.projectIndex`.
    fn index(&self) -> Element<'_, Message> {
        let rows = self.projects.iter().enumerate().map(|(i, item)| {
            let blocked = item
                .tasks
                .iter()
                .filter(|task| task.status == TaskStatus::Blocked)
                .count();
            let meta = if blocked > 0 {
                format!("{blocked} blocked")
            } else {
                format!("{} tasks", item.tasks.len())
            };
            let active = item.id == self.selected;
            iced::widget::button(
                row![
                    iced::widget::text(format!("{:02}", i + 1))
                        .size(12.0)
                        .color(if active { ACCENT } else { TEXT_2 }),
                    column![
                        iced::widget::text(item.name.clone()).size(13.0).color(TEXT),
                        dim(meta),
                    ]
                    .spacing(2),
                ]
                .spacing(10)
                .align_y(iced::Alignment::Center),
            )
            .width(Fill)
            .padding(10)
            .on_press(Message::Select(item.id.clone()))
            .style(move |_, status| {
                let hover = matches!(status, iced::widget::button::Status::Hovered);
                iced::widget::button::Style {
                    background: Some(
                        if active {
                            crate::tokens::ACCENT_DIM
                        } else if hover {
                            crate::tokens::rgba(255, 255, 255, 0.04)
                        } else {
                            crate::tokens::rgba(255, 255, 255, 0.0)
                        }
                        .into(),
                    ),
                    text_color: TEXT,
                    border: iced::Border {
                        color: if active {
                            crate::tokens::ACCENT_LINE
                        } else {
                            crate::tokens::LINE
                        },
                        width: 1.0,
                        radius: iced::border::Radius::new(crate::tokens::RADIUS_S),
                    },
                    shadow: iced::Shadow::default(),
                    snap: true,
                }
            })
            .into()
        });
        container(
            column(
                std::iter::once(eyebrow("Project index"))
                    .chain(rows)
                    .collect::<Vec<_>>(),
            )
            .spacing(8),
        )
        .width(260)
        .into()
    }

    /// `.projectDetail`.
    fn detail<'a>(&'a self, dashboard: &'a Dashboard) -> Element<'a, Message> {
        let status_label = match dashboard.status {
            ProjectStatus::Active => "active project",
            ProjectStatus::Paused => "paused project",
            ProjectStatus::Archived => "archived project",
        };
        let action_label = if self.reading_git {
            "Reading Git…"
        } else if dashboard.repository.is_none() {
            "Register repository"
        } else {
            "Refresh Git"
        };
        let head = row![
            column![
                eyebrow(status_label),
                h2(dashboard.name.clone()),
                body(
                    dashboard
                        .description
                        .clone()
                        .unwrap_or_else(|| "No project description yet.".to_string())
                ),
            ]
            .spacing(6)
            .width(Fill),
            container(primary_button(
                action_label,
                (!self.reading_git).then_some(Message::RepositoryAction),
            ))
            .center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let repo: Element<'a, Message> = match &dashboard.repository {
            None => card(
                column![
                    h3("No repository connected"),
                    body("Select a local Git folder. Zero reads status and recent commits only."),
                ]
                .spacing(6),
            ),
            Some(repo) => card(
                row![
                    strip("Repository", repo.directory_name.clone()),
                    strip("Branch", repo.branch.clone()),
                    strip(
                        "Working tree",
                        if repo.dirty_count == 0 {
                            "Clean".to_string()
                        } else {
                            format!("{} changes", repo.dirty_count)
                        }
                    ),
                    strip(
                        "Remote",
                        format!("{} ahead · {} behind", repo.ahead_count, repo.behind_count)
                    ),
                ]
                .spacing(24),
            ),
        };

        let blocked: Vec<&DetailTask> = dashboard
            .tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Blocked)
            .collect();

        let timeline: Element<'a, Message> = if dashboard.timeline.is_empty() {
            empty_state("Tasks, decisions, and commits will meet here.")
        } else {
            column(dashboard.timeline.iter().map(timeline_item))
                .spacing(10)
                .into()
        };

        let blockers: Element<'a, Message> = if blocked.is_empty() {
            empty_state("No blocked tasks.")
        } else {
            column(blocked.into_iter().map(|task| {
                card(
                    column![
                        h3(task.title.clone()),
                        dim(format!("{} priority", task.priority)),
                    ]
                    .spacing(4),
                )
            }))
            .spacing(8)
            .into()
        };

        let decisions: Element<'a, Message> = if dashboard.decisions.is_empty() {
            empty_state("No durable decisions recorded.")
        } else {
            column(dashboard.decisions.iter().take(6).map(|decision| {
                card(
                    column![h3(decision.title.clone()), dim(decision.created_at.clone()),]
                        .spacing(4),
                )
            }))
            .spacing(8)
            .into()
        };

        let continuity = row![
            column![
                column![eyebrow("Continuity rail"), h3("What changed")].spacing(4),
                pill(format!("{} signals", dashboard.timeline.len())),
                timeline,
            ]
            .spacing(10)
            .width(Fill),
            column![
                section_heading("Blockers", Some(blocked_count(dashboard))),
                blockers,
                section_heading("Decisions", Some(dashboard.decisions.len().to_string())),
                decisions,
            ]
            .spacing(10)
            .width(320),
        ]
        .spacing(16);

        container(stack_16(vec![head.into(), repo, continuity.into()]))
            .width(Fill)
            .into()
    }
}

fn blocked_count(dashboard: &Dashboard) -> String {
    dashboard
        .tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Blocked)
        .count()
        .to_string()
}

/// `.repositoryStrip > div`.
fn strip<'a>(label: &'a str, value: String) -> Element<'a, Message> {
    column![dim(label), iced::widget::text(value).size(13.0).color(TEXT)]
        .spacing(4)
        .into()
}

/// `.timelineItem`.
fn timeline_item(item: &TimelineItem) -> Element<'_, Message> {
    let mut lines: Vec<Element<'_, Message>> = vec![row![
        pill(item.kind.label()),
        Space::new().width(Fill),
        dim(item.occurred_at.clone()),
    ]
    .spacing(8)
    .align_y(iced::Alignment::Center)
    .into()];
    lines.push(h3(item.title.clone()));
    if let Some(detail) = &item.detail {
        lines.push(body(detail.clone()));
    }
    if let Some(state) = &item.state {
        lines.push(dim(state.clone()));
    }
    card(column(lines).spacing(6))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_stays_on_a_live_project() {
        let mut state = State::default();
        assert_eq!(state.selected, "helm");
        let _ = state.update(Message::Select("vault".into()));
        assert_eq!(state.selected, "vault");
        let _ = state.update(Message::Select("ghost".into()));
        assert_eq!(state.selected, "vault", "unknown id must not select");
    }

    #[test]
    fn register_without_a_repository_reports_instead_of_reading() {
        let mut state = State::default();
        let _ = state.update(Message::Select("vault".into()));
        let _ = state.update(Message::RepositoryAction);
        assert!(state.error.is_some());
        assert!(!state.reading_git);
    }

    #[test]
    fn blocked_and_signal_counts_come_from_tasks() {
        let state = State::default();
        let helm = &state.projects[0];
        assert_eq!(blocked_count(helm), "1");
        assert_eq!(helm.timeline.len(), 3);
        assert_eq!(blocked_count(&state.projects[1]), "0");
    }

    #[test]
    fn actions_link_navigates() {
        assert_eq!(
            State::nav_target(&Message::OpenActions),
            Some(Route::Actions)
        );
        assert_eq!(State::nav_target(&Message::RepositoryAction), None);
    }
}
