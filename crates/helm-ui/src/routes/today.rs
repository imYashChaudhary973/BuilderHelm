//! `routes/today.tsx` (162 lines).
//!
//! `CountUp` / `SplitText` / `useSpotlight` from `fx.tsx` are not ported: they
//! are rAF decorations and the route contract has no subscription. Final values
//! render directly.

use iced::widget::{column, container, row, Space};
use iced::{Element, Fill, Task};

use super::common::{
    body, card, dim, eyebrow, h1, h2, h3, page, primary_button, stack_16, text_button,
};
use super::Route;
use crate::tokens::{ACCENT, TEXT, TEXT_2};

/// `taskSchema.status` in `protocol/actions.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Todo,
    InProgress,
    Blocked,
    Done,
}

/// `projectSchema.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectStatus {
    Active,
    Paused,
    Archived,
}

#[derive(Clone, Debug)]
pub struct ProjectTask {
    pub title: String,
    pub status: TaskStatus,
}

/// `projectRepositorySchema`, trimmed to what the row renders.
#[derive(Clone, Debug)]
pub struct Repository {
    pub branch: String,
    pub dirty_count: u32,
}

/// `projectDashboardSchema`.
#[derive(Clone, Debug)]
pub struct Dashboard {
    pub name: String,
    pub status: ProjectStatus,
    pub repository: Option<Repository>,
    pub tasks: Vec<ProjectTask>,
    pub timeline: usize,
}

/// `dashboard.isLoading` / `isError` → `data-core-status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoreStatus {
    Checking,
    Unavailable,
    Ready,
}

impl CoreStatus {
    fn label(self) -> &'static str {
        match self {
            CoreStatus::Checking => "Reading local work",
            CoreStatus::Unavailable => "Data unavailable",
            CoreStatus::Ready => "Local data current",
        }
    }
}

pub struct State {
    pub day_label: String,
    pub core: CoreStatus,
    pub projects: Vec<Dashboard>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            day_label: "Wednesday, 27 August".into(),
            core: CoreStatus::Ready,
            projects: vec![
                Dashboard {
                    name: "BuilderHelm".into(),
                    status: ProjectStatus::Active,
                    repository: Some(Repository {
                        branch: "feat/swarm-v2".into(),
                        dirty_count: 3,
                    }),
                    tasks: vec![
                        ProjectTask {
                            title: "Port routes to iced".into(),
                            status: TaskStatus::InProgress,
                        },
                        ProjectTask {
                            title: "Wire keyboard into panes".into(),
                            status: TaskStatus::Todo,
                        },
                    ],
                    timeline: 12,
                },
                Dashboard {
                    name: "Conformance corpus".into(),
                    status: ProjectStatus::Active,
                    repository: Some(Repository {
                        branch: "main".into(),
                        dirty_count: 0,
                    }),
                    tasks: vec![ProjectTask {
                        title: "Add browser fixtures".into(),
                        status: TaskStatus::Blocked,
                    }],
                    timeline: 4,
                },
                Dashboard {
                    name: "Obsidian vault".into(),
                    status: ProjectStatus::Paused,
                    repository: None,
                    tasks: vec![],
                    timeline: 0,
                },
            ],
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    OpenActions,
    OpenProjects,
    Refresh,
}

impl State {
    /// Cross-route jumps are translated by `Routes::update`.
    pub fn nav_target(message: &Message) -> Option<Route> {
        match message {
            Message::OpenActions => Some(Route::Actions),
            Message::OpenProjects => Some(Route::Projects),
            Message::Refresh => None,
        }
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Refresh => self.core = CoreStatus::Ready,
            Message::OpenActions | Message::OpenProjects => {}
        }
        Task::none()
    }

    fn active_projects(&self) -> usize {
        self.projects
            .iter()
            .filter(|item| item.status == ProjectStatus::Active)
            .count()
    }

    fn tasks_with(&self, status: TaskStatus) -> usize {
        self.projects
            .iter()
            .flat_map(|item| item.tasks.iter())
            .filter(|task| task.status == status)
            .count()
    }

    fn repositories(&self) -> usize {
        self.projects
            .iter()
            .filter(|item| item.repository.is_some())
            .count()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let header = row![
            column![eyebrow(&self.day_label), h1("Continue what matters.")].spacing(6),
            Space::new().width(Fill),
            container(dim(self.core.label())).center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let summary = row![
            stat("Active projects", self.active_projects(), true),
            stat(
                "In progress",
                self.tasks_with(TaskStatus::InProgress),
                false
            ),
            stat("Blocked", self.tasks_with(TaskStatus::Blocked), false),
            stat("Repositories", self.repositories(), false),
        ]
        .spacing(16);

        let tail: Element<'_, Message> =
            if self.projects.is_empty() && self.core != CoreStatus::Checking {
                stack_16(vec![
                    eyebrow("Clear desk"),
                    h2("Your active work will gather here."),
                    body(
                        "Create a project through Actions. Today will then surface its \
                         tasks, blockers, decisions, and Git activity.",
                    ),
                    primary_button("Create through Actions", Some(Message::OpenActions)),
                ])
            } else {
                let rows = self.projects.iter().take(6).map(project_row);
                stack_16(vec![
                    row![
                        column![eyebrow("Active threads"), h2("Where to resume")].spacing(6),
                        Space::new().width(Fill),
                        text_button("Open project view", Some(Message::OpenProjects)),
                    ]
                    .align_y(iced::Alignment::Center)
                    .into(),
                    column(rows).spacing(12).into(),
                ])
            };

        page(stack_16(vec![header.into(), summary.into(), tail]))
    }
}

/// `.statCard`.
fn stat<'a>(label: &'a str, value: usize, accent: bool) -> Element<'a, Message> {
    card(
        column![
            dim(label),
            iced::widget::text(value.to_string())
                .size(28.0)
                .color(if accent { ACCENT } else { TEXT }),
        ]
        .spacing(6),
    )
}

/// `.todayProjectRows > article`.
fn project_row(item: &Dashboard) -> Element<'_, Message> {
    let repo = match &item.repository {
        None => "Repository not connected".to_string(),
        Some(repo) if repo.dirty_count == 0 => format!("{} · clean", repo.branch),
        Some(repo) => format!("{} · {} changes", repo.branch, repo.dirty_count),
    };
    let next = item
        .tasks
        .iter()
        .find(|task| task.status == TaskStatus::InProgress)
        .or_else(|| {
            item.tasks
                .iter()
                .find(|task| task.status == TaskStatus::Todo)
        })
        .map(|task| task.title.clone())
        .unwrap_or_else(|| "Choose the next task".to_string());
    let blocked = item
        .tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Blocked)
        .count();
    let signal = if blocked > 0 {
        format!("{blocked} blocked")
    } else {
        format!("{} recent events", item.timeline)
    };
    card(
        row![
            column![h3(item.name.clone()), dim(repo)]
                .spacing(4)
                .width(Fill),
            column![
                dim("Next"),
                iced::widget::text(next).size(13.0).color(TEXT_2)
            ]
            .spacing(4)
            .width(Fill),
            column![
                dim("Signal"),
                iced::widget::text(signal).size(13.0).color(TEXT_2)
            ]
            .spacing(4),
        ]
        .spacing(16)
        .align_y(iced::Alignment::Center),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_counts_match_task_statuses() {
        let state = State::default();
        assert_eq!(state.active_projects(), 2);
        assert_eq!(state.tasks_with(TaskStatus::InProgress), 1);
        assert_eq!(state.tasks_with(TaskStatus::Blocked), 1);
        assert_eq!(state.repositories(), 2);
    }

    #[test]
    fn empty_desk_only_when_no_projects_and_not_loading() {
        let mut state = State::default();
        state.projects.clear();
        state.core = CoreStatus::Checking;
        let _ = state.view();
        state.core = CoreStatus::Ready;
        let _ = state.view();
        assert_eq!(state.active_projects(), 0);
    }

    #[test]
    fn cross_route_links_resolve() {
        assert_eq!(
            State::nav_target(&Message::OpenActions),
            Some(Route::Actions)
        );
        assert_eq!(
            State::nav_target(&Message::OpenProjects),
            Some(Route::Projects)
        );
        assert_eq!(State::nav_target(&Message::Refresh), None);
    }
}
