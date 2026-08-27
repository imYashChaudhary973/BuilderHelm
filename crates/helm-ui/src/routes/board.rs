//! `/board` — `components/kanban-board.tsx` (552 lines) plus `board-store.tsx`.
//!
//! `board-store.tsx` keeps the active board id; the chooser shows whenever it
//! is unset or points at a board that is gone. Cards carry their `workspace`,
//! so a board only ever renders its own tasks.
//!
//! Stage moves replace the TSX drag-and-drop: the same `neighbor()` walk over
//! `COLUMNS`, driven by the `←` / `→` buttons the TSX already renders.

use iced::border::Radius;
use iced::widget::{button, column, container, row, text, text_input, Space};
use iced::{Alignment, Border, Element, Fill, Padding, Shadow, Task};

use super::common::{
    body, card as panel, dim, empty_state, error_banner, eyebrow, h2, h3, page, primary_button,
    secondary_button, BODY, SMALL, TINY,
};
use super::kanban::{self, KanbanColumn, COLUMNS};
use crate::tokens::{
    ACCENT, ACCENT_BRIGHT, ACCENT_DIM, ACCENT_LINE, GLASS, LINE, RADIUS_S, TEXT, TEXT_2, TEXT_3,
};

/// `input maxLength={120}` on the project name field.
const NAME_MAX: usize = 120;

/// A `listProjects` row. `taskCount` is derived from `cards`, never stored, so
/// it cannot drift from the board it counts.
#[derive(Clone, Debug)]
pub struct KanbanProject {
    pub id: String,
    pub name: String,
}

/// `KanbanCard` from `@zero/protocol/kanban`.
#[derive(Clone, Debug)]
pub struct KanbanCard {
    pub id: String,
    pub workspace: String,
    pub title: String,
    pub column: KanbanColumn,
}

pub struct State {
    projects: Vec<KanbanProject>,
    /// `useBoards().activeId`.
    active: Option<String>,
    /// Every board's cards. `workspace` is the isolation boundary.
    cards: Vec<KanbanCard>,
    project_name: String,
    title: String,
    error: Option<String>,
    compose: Option<KanbanColumn>,
    compose_title: String,
    editing: Option<String>,
    edit_title: String,
    next_id: usize,
}

#[derive(Clone, Debug)]
pub enum Message {
    ProjectNameChanged(String),
    CreateProject,
    OpenProject(String),
    /// `boards.choose()` — back to the chooser.
    ChooseBoard,
    TitleChanged(String),
    /// Toolbar submit; lands in `To Do` like the TSX default column.
    AddCard,
    ComposeOpened(KanbanColumn),
    ComposeTitleChanged(String),
    ComposeSubmitted,
    ComposeCancelled,
    EditStarted(String),
    EditTitleChanged(String),
    EditCommitted,
    EditCancelled,
    Moved(String, KanbanColumn),
    Removed(String),
    /// Every `catch` branch in the TSX. Host wiring dispatches this.
    Failed(String),
}

impl Default for State {
    fn default() -> Self {
        let projects = vec![
            KanbanProject {
                id: "board-1".to_owned(),
                name: "ZenVoice".to_owned(),
            },
            KanbanProject {
                id: "board-2".to_owned(),
                name: "Helm Desktop".to_owned(),
            },
        ];
        let seed = [
            ("board-1", "Draft the onboarding script", KanbanColumn::Idea),
            ("board-1", "Pick the voice model", KanbanColumn::Idea),
            ("board-1", "Wire the capture hotkey", KanbanColumn::Doing),
            ("board-1", "Review the latency budget", KanbanColumn::Review),
            ("board-1", "Ship the waveform meter", KanbanColumn::Shipped),
            ("board-2", "Port the kanban route", KanbanColumn::Doing),
            ("board-2", "Fold the workspace rail", KanbanColumn::Shipped),
            (
                "board-2",
                "Drop the Electron shell",
                KanbanColumn::Cancelled,
            ),
        ];
        let cards = seed
            .iter()
            .enumerate()
            .map(|(index, (workspace, title, column))| KanbanCard {
                id: format!("card-{}", index + 1),
                workspace: (*workspace).to_owned(),
                title: (*title).to_owned(),
                column: *column,
            })
            .collect::<Vec<_>>();
        Self {
            next_id: projects.len() + cards.len(),
            projects,
            active: Some("board-1".to_owned()),
            cards,
            project_name: String::new(),
            title: String::new(),
            error: None,
            compose: None,
            compose_title: String::new(),
            editing: None,
            edit_title: String::new(),
        }
    }
}

impl State {
    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::ProjectNameChanged(name) => {
                if name.chars().count() <= NAME_MAX {
                    self.project_name = name;
                }
            }
            Message::CreateProject => self.create_project(),
            Message::OpenProject(id) => self.active = Some(id),
            Message::ChooseBoard => {
                self.active = None;
                self.compose = None;
                self.editing = None;
            }
            Message::TitleChanged(title) => self.title = title,
            Message::AddCard => {
                let title = self.title.clone();
                self.add_card(&title, KanbanColumn::Idea);
            }
            Message::ComposeOpened(column) => {
                self.compose = Some(column);
                self.compose_title.clear();
            }
            Message::ComposeTitleChanged(title) => self.compose_title = title,
            Message::ComposeSubmitted => {
                if let Some(column) = self.compose {
                    let title = self.compose_title.clone();
                    self.add_card(&title, column);
                }
            }
            Message::ComposeCancelled => self.compose = None,
            Message::EditStarted(id) => {
                if let Some(card) = self.cards.iter().find(|card| card.id == id) {
                    self.edit_title = card.title.clone();
                    self.editing = Some(id);
                }
            }
            Message::EditTitleChanged(title) => self.edit_title = title,
            Message::EditCommitted => self.rename(),
            Message::EditCancelled => self.editing = None,
            Message::Moved(id, column) => self.move_card(&id, column),
            Message::Removed(id) => self.remove(&id),
            Message::Failed(cause) => self.error = Some(cause),
        }
        Task::none()
    }

    /// `selectedProject` — the active id resolved against `listProjects`.
    fn selected(&self) -> Option<&KanbanProject> {
        let active = self.active.as_deref()?;
        self.projects.iter().find(|project| project.id == active)
    }

    /// Every card of the active board, in insertion order.
    fn board_cards(&self) -> impl Iterator<Item = &KanbanCard> {
        let active = self.active.clone().unwrap_or_default();
        self.cards
            .iter()
            .filter(move |card| card.workspace == active)
    }

    /// `cards.filter((card) => card.column === column.id)`.
    fn column_cards(&self, column: KanbanColumn) -> Vec<&KanbanCard> {
        self.board_cards()
            .filter(|card| card.column == column)
            .collect()
    }

    fn task_count(&self, workspace: &str) -> usize {
        self.cards
            .iter()
            .filter(|card| card.workspace == workspace)
            .count()
    }

    fn create_project(&mut self) {
        let name = self.project_name.trim().to_owned();
        if name.is_empty() {
            return;
        }
        self.error = None;
        self.next_id += 1;
        let id = format!("board-{}", self.next_id);
        self.projects.push(KanbanProject {
            id: id.clone(),
            name,
        });
        self.project_name.clear();
        self.active = Some(id);
    }

    /// `addCard` — trimmed titles only, and only into the open board.
    fn add_card(&mut self, title: &str, column: KanbanColumn) {
        let title = title.trim().to_owned();
        let Some(workspace) = self.selected().map(|project| project.id.clone()) else {
            return;
        };
        if title.is_empty() {
            return;
        }
        self.error = None;
        self.next_id += 1;
        self.cards.push(KanbanCard {
            id: format!("card-{}", self.next_id),
            workspace,
            title,
            column,
        });
        self.title.clear();
        self.compose_title.clear();
        self.compose = None;
    }

    /// `rename` — closes the field first, then ignores empty or unchanged text.
    fn rename(&mut self) {
        let Some(id) = self.editing.take() else {
            return;
        };
        let title = self.edit_title.trim().to_owned();
        if title.is_empty() {
            return;
        }
        self.error = None;
        if let Some(card) = self.cards.iter_mut().find(|card| card.id == id) {
            if card.title != title {
                card.title = title;
            }
        }
    }

    /// `move` — restages the card in place, so board order never shifts.
    fn move_card(&mut self, id: &str, column: KanbanColumn) {
        self.error = None;
        if let Some(card) = self.cards.iter_mut().find(|card| card.id == id) {
            card.column = column;
        }
    }

    fn remove(&mut self, id: &str) {
        self.error = None;
        self.cards.retain(|card| card.id != id);
        if self.editing.as_deref() == Some(id) {
            self.editing = None;
        }
    }

    pub fn view(&self) -> Element<'_, Message> {
        let Some(project) = self.selected() else {
            return self.chooser();
        };

        let mut rows: Vec<Element<'_, Message>> = vec![self.head(project)];
        if let Some(error) = &self.error {
            rows.push(error_banner(error.as_str()));
        }
        rows.push(
            row(COLUMNS.iter().map(|stage| self.column(*stage)))
                .spacing(10)
                .into(),
        );
        page(column(rows).spacing(16).width(Fill))
    }

    /// `.kanbanHead` — identity, `All boards`, and the `.kanbanAdd` form.
    fn head<'a>(&'a self, project: &'a KanbanProject) -> Element<'a, Message> {
        let count = self.task_count(&project.id);
        let identity = row![
            mark(),
            column![
                h3(project.name.as_str()),
                text(format!(
                    "BuilderHelm Board · {count} {} · Move tasks between stages",
                    if count == 1 { "task" } else { "tasks" }
                ))
                .size(TINY)
                .color(TEXT_3),
            ]
            .spacing(3),
        ]
        .spacing(10)
        .align_y(Alignment::Center);

        let add = row![
            text_input("New task", &self.title)
                .size(SMALL)
                .width(180)
                .padding(Padding {
                    top: 8.0,
                    right: 10.0,
                    bottom: 8.0,
                    left: 10.0,
                })
                .on_input(Message::TitleChanged)
                .on_submit(Message::AddCard)
                .style(field_style),
            primary_button(
                "+ New task",
                (!self.title.trim().is_empty()).then_some(Message::AddCard)
            ),
        ]
        .spacing(8)
        .align_y(Alignment::Center);

        row![
            identity,
            Space::new().width(Fill),
            secondary_button("All boards", Some(Message::ChooseBoard)),
            add,
        ]
        .spacing(10)
        .align_y(Alignment::Center)
        .into()
    }

    fn column(&self, stage: KanbanColumn) -> Element<'_, Message> {
        let cards = self
            .column_cards(stage)
            .into_iter()
            .map(|card| self.card(card))
            .collect();
        let compose = (self.compose == Some(stage)).then(|| {
            kanban::compose_input(
                &self.compose_title,
                Message::ComposeTitleChanged,
                Message::ComposeSubmitted,
                Message::ComposeCancelled,
            )
        });
        kanban::column(stage, Message::ComposeOpened(stage), cards, compose)
    }

    fn card<'a>(&'a self, card: &'a KanbanCard) -> Element<'a, Message> {
        let slot = if self.editing.as_deref() == Some(card.id.as_str()) {
            kanban::card_edit(
                &self.edit_title,
                Message::EditTitleChanged,
                Message::EditCommitted,
                Message::EditCancelled,
            )
        } else {
            kanban::card_title(card.title.as_str(), Message::EditStarted(card.id.clone()))
        };
        kanban::card(
            slot,
            card.column
                .neighbor(-1)
                .map(|stage| Message::Moved(card.id.clone(), stage)),
            card.column
                .neighbor(1)
                .map(|stage| Message::Moved(card.id.clone(), stage)),
            Message::Removed(card.id.clone()),
        )
    }

    /// `ProjectChooser`.
    fn chooser(&self) -> Element<'_, Message> {
        let mut rows: Vec<Element<'_, Message>> = vec![row![
            mark(),
            column![
                h2("BuilderHelm Board"),
                body("Continue a project board or create a clean one for new work."),
            ]
            .spacing(4),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .into()];

        if let Some(error) = &self.error {
            rows.push(error_banner(error.as_str()));
        }

        let create = panel(
            column![
                eyebrow("New project board"),
                h3("What are you working on?"),
                body("Each project keeps its own tasks and stage history."),
                dim("Project name"),
                text_input("ZenVoice", &self.project_name)
                    .size(BODY)
                    .padding(Padding {
                        top: 8.0,
                        right: 10.0,
                        bottom: 8.0,
                        left: 10.0,
                    })
                    .on_input(Message::ProjectNameChanged)
                    .on_submit(Message::CreateProject)
                    .style(field_style),
                primary_button(
                    "Create project board",
                    (!self.project_name.trim().is_empty()).then_some(Message::CreateProject)
                ),
            ]
            .spacing(8),
        );

        let mut library: Vec<Element<'_, Message>> =
            vec![eyebrow("Previous boards"), h3("Continue where you stopped")];
        if self.projects.is_empty() {
            library.push(empty_state("No previous boards yet. Create the first one."));
        } else {
            library.extend(
                self.projects
                    .iter()
                    .map(|project| self.project_row(project)),
            );
        }

        rows.push(
            row![create, panel(column(library).spacing(8))]
                .spacing(14)
                .into(),
        );
        page(column(rows).spacing(16).width(Fill))
    }

    /// `.boardProjectLibrary li > button`.
    fn project_row<'a>(&'a self, project: &'a KanbanProject) -> Element<'a, Message> {
        let count = self.task_count(&project.id);
        button(
            row![
                icon_tile(),
                column![
                    text(project.name.as_str()).size(BODY).color(TEXT),
                    text(format!(
                        "{count} {}",
                        if count == 1 { "task" } else { "tasks" }
                    ))
                    .size(10.0)
                    .color(TEXT_3),
                ]
                .spacing(2),
                Space::new().width(Fill),
                text("Continue →").size(10.0).color(ACCENT_BRIGHT),
            ]
            .spacing(10)
            .align_y(Alignment::Center),
        )
        .padding(Padding {
            top: 10.0,
            right: 12.0,
            bottom: 10.0,
            left: 12.0,
        })
        .width(Fill)
        .on_press(Message::OpenProject(project.id.clone()))
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { ACCENT_DIM } else { GLASS }.into()),
                text_color: TEXT,
                border: Border {
                    color: if hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
    }
}

/// `.kanbanAdd input` / `.boardProjectCreate input`.
fn field_style(_: &iced::Theme, status: text_input::Status) -> text_input::Style {
    let focused = matches!(status, text_input::Status::Focused { .. });
    text_input::Style {
        background: GLASS.into(),
        border: Border {
            color: if focused { ACCENT } else { LINE },
            width: 1.0,
            radius: Radius::new(8.0),
        },
        icon: TEXT_3,
        placeholder: TEXT_2,
        value: TEXT,
        selection: ACCENT_DIM,
    }
}

/// `.kanbanMark` — 34px tile holding `BoardGlyph`.
fn mark<'a>() -> Element<'a, Message> {
    container(glyph(18.0))
        .width(34)
        .height(34)
        .center_x(Fill)
        .center_y(Fill)
        .style(|_| container::Style {
            background: Some(ACCENT_DIM.into()),
            border: Border {
                color: ACCENT_LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_S),
            },
            ..container::Style::default()
        })
        .into()
}

/// `.boardProjectIcon` — 30px tile holding the small glyph.
fn icon_tile<'a>() -> Element<'a, Message> {
    container(glyph(16.0))
        .width(30)
        .height(30)
        .center_x(Fill)
        .center_y(Fill)
        .style(|_| container::Style {
            background: Some(GLASS.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(8.0),
            },
            ..container::Style::default()
        })
        .into()
}

/// `BoardGlyph` — three outlined bars of falling, then rising, height.
fn glyph<'a>(size: f32) -> Element<'a, Message> {
    let unit = size / 24.0;
    let bar = |height: f32| -> Element<'a, Message> {
        container(Space::new().width(4.0 * unit).height(height * unit))
            .style(move |_| container::Style {
                border: Border {
                    color: ACCENT,
                    width: 1.7 * unit,
                    radius: Radius::new(1.2),
                },
                ..container::Style::default()
            })
            .into()
    };
    row![bar(13.0), bar(8.5), bar(11.0)]
        .spacing(1.5 * unit)
        .align_y(Alignment::Start)
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(cards: Vec<&KanbanCard>) -> Vec<String> {
        cards.iter().map(|card| card.id.clone()).collect()
    }

    #[test]
    fn moving_a_card_keeps_board_order_and_conserves_the_count() {
        let mut state = State::default();
        let order = ids(state.board_cards().collect());
        let total = order.len();
        let doing = ids(state.column_cards(KanbanColumn::Doing));
        let card = state.column_cards(KanbanColumn::Idea)[0].id.clone();

        let _ = state.update(Message::Moved(card.clone(), KanbanColumn::Doing));

        assert_eq!(ids(state.board_cards().collect()), order);
        assert_eq!(state.board_cards().count(), total);
        assert_eq!(
            ids(state.column_cards(KanbanColumn::Doing)).len(),
            doing.len() + 1
        );
        assert!(state
            .column_cards(KanbanColumn::Doing)
            .iter()
            .any(|item| item.id == card));
        assert!(state
            .column_cards(KanbanColumn::Idea)
            .iter()
            .all(|item| item.id != card));

        // Compose and rename swap widgets inside the card list; both build.
        let _ = state.update(Message::ComposeOpened(KanbanColumn::Review));
        let _ = state.view();
        let _ = state.update(Message::EditStarted(card));
        let _ = state.view();
    }

    #[test]
    fn tasks_never_leak_between_boards() {
        let mut state = State::default();
        let first = ids(state.board_cards().collect());

        let _ = state.update(Message::OpenProject("board-2".to_owned()));
        let second = ids(state.board_cards().collect());
        assert!(!second.is_empty());
        assert!(first.iter().all(|id| !second.contains(id)));

        let _ = state.update(Message::TitleChanged("Second board only".to_owned()));
        let _ = state.update(Message::AddCard);
        let grown = ids(state.board_cards().collect());
        assert_eq!(grown.len(), second.len() + 1);

        let _ = state.update(Message::OpenProject("board-1".to_owned()));
        assert_eq!(ids(state.board_cards().collect()), first);
    }

    #[test]
    fn a_column_is_empty_only_once_its_last_card_leaves() {
        let mut state = State::default();
        assert!(state.column_cards(KanbanColumn::Cancelled).is_empty());
        assert!(!state.column_cards(KanbanColumn::Idea).is_empty());

        for card in ids(state.column_cards(KanbanColumn::Idea)) {
            assert!(!state.column_cards(KanbanColumn::Idea).is_empty());
            let _ = state.update(Message::Removed(card));
        }
        assert!(state.column_cards(KanbanColumn::Idea).is_empty());

        // The other board still owns its cards, and the chooser is unreachable
        // while a board is open.
        assert!(state.selected().is_some());
        let _ = state.update(Message::ChooseBoard);
        assert!(state.selected().is_none());
        // Chooser branch: both boards listed, neither board's cards rendered.
        let _ = state.view();
    }

    #[test]
    fn blank_titles_and_names_are_rejected() {
        let mut state = State::default();
        let total = state.cards.len();

        let _ = state.update(Message::TitleChanged("   ".to_owned()));
        let _ = state.update(Message::AddCard);
        assert_eq!(state.cards.len(), total);

        let _ = state.update(Message::ProjectNameChanged("  ".to_owned()));
        let _ = state.update(Message::CreateProject);
        assert_eq!(state.projects.len(), 2);

        let _ = state.update(Message::ProjectNameChanged("x".repeat(NAME_MAX + 1)));
        assert!(state.project_name.trim().is_empty());

        let _ = state.update(Message::TitleChanged("  Real task  ".to_owned()));
        let _ = state.update(Message::AddCard);
        assert_eq!(state.cards.len(), total + 1);
        assert_eq!(state.cards[total].title, "Real task");
        assert_eq!(state.cards[total].column, KanbanColumn::Idea);
        assert!(state.title.is_empty());
    }
}
