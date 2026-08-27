//! `routes/memory.tsx` (422 lines).
//!
//! `MemoryGlyph` is a bare mark (no `svg` feature). Recent questions live in
//! `State` rather than `localStorage`; the TSX itself treats them as optional
//! ("retrieval still works when storage is unavailable").

use iced::widget::{column, container, pick_list, row, scrollable, text_input, Space};
use iced::{Element, Fill, Font, Task};

use super::common::{
    body, card, dim, error_banner, h1, h2, h3, page, pill, primary_button, stack_16, text_button,
};
use super::Route;
use crate::tokens::{ACCENT, ACCENT_DIM, TEXT, TEXT_2};

/// `maxLength={2_000}` on the question box.
pub const QUESTION_MAX: usize = 2_000;
/// `maxSources: 8` in the answer request.
pub const MAX_SOURCES: usize = 8;
/// `.slice(0, 6)` in `rememberQuery`.
pub const RECENTS_MAX: usize = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub note_count: u32,
    pub last_indexed_at: Option<String>,
}

impl std::fmt::Display for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.name)
    }
}

/// `indexedLabel`.
fn indexed_label(value: Option<&str>) -> String {
    match value {
        None => "Not indexed".to_string(),
        Some(when) => format!("Indexed {when}"),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnswerModel {
    pub reference: String,
    pub label: String,
}

impl std::fmt::Display for AnswerModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.label)
    }
}

#[derive(Clone, Debug)]
pub struct Citation {
    pub chunk_id: String,
    pub title: String,
    pub note_path: String,
    pub heading: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub excerpt: String,
}

#[derive(Clone, Debug)]
pub struct Answer {
    pub answer: String,
    pub citations: Vec<Citation>,
}

#[derive(Clone, Debug)]
pub struct SourceView {
    pub chunk_id: String,
    pub title: String,
    pub note_path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub content: String,
}

pub struct State {
    pub vaults: Vec<Vault>,
    pub models: Vec<AnswerModel>,
    pub vault: Option<Vault>,
    pub model: Option<AnswerModel>,
    pub question: String,
    pub answer: Option<Answer>,
    pub source: Option<SourceView>,
    pub recents: Vec<String>,
    pub error: Option<String>,
    pub asking: bool,
}

impl Default for State {
    fn default() -> Self {
        let vaults = vec![Vault {
            id: "vault-1".into(),
            name: "Builder vault".into(),
            note_count: 412,
            last_indexed_at: Some("27 Aug 09:40".into()),
        }];
        let models = vec![
            AnswerModel {
                reference: "openai/gpt-5".into(),
                label: "GPT-5".into(),
            },
            AnswerModel {
                reference: "anthropic/claude-opus-5".into(),
                label: "Claude Opus 5".into(),
            },
        ];
        // The TSX defaults both selects to the first available entry.
        let vault = vaults.first().cloned();
        let model = models.first().cloned();
        Self {
            vaults,
            models,
            vault,
            model,
            question: String::new(),
            answer: None,
            source: None,
            recents: vec!["Why did I choose architecture B for Project X?".into()],
            error: None,
            asking: false,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    AddVault,
    SelectVault(Vault),
    RefreshIndex,
    SelectModel(AnswerModel),
    Question(String),
    Ask,
    UseRecent(String),
    OpenCitation(String),
    OpenModelSettings,
}

impl State {
    pub fn nav_target(message: &Message) -> Option<Route> {
        match message {
            Message::OpenModelSettings => Some(Route::Settings),
            _ => None,
        }
    }

    /// `canAsk` in the TSX.
    pub fn can_ask(&self) -> bool {
        self.vault.is_some()
            && self.model.is_some()
            && !self.question.trim().is_empty()
            && !self.asking
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::AddVault => {
                self.error = None;
                let id = format!("vault-{}", self.vaults.len() + 1);
                let vault = Vault {
                    id,
                    name: format!("Vault {}", self.vaults.len() + 1),
                    note_count: 0,
                    last_indexed_at: None,
                };
                self.vaults.push(vault.clone());
                self.vault = Some(vault);
                self.answer = None;
                self.source = None;
            }
            Message::SelectVault(vault) => {
                self.vault = Some(vault);
                self.answer = None;
                self.source = None;
            }
            Message::RefreshIndex => {
                self.error = None;
                self.answer = None;
                self.source = None;
            }
            Message::SelectModel(model) => self.model = Some(model),
            Message::Question(value) => {
                self.question = value.chars().take(QUESTION_MAX).collect();
            }
            Message::Ask => {
                if !self.can_ask() {
                    return Task::none();
                }
                let asked = self.question.trim().to_string();
                self.error = None;
                self.source = None;
                self.answer = Some(Answer {
                    answer: format!(
                        "Answer for “{asked}” is assembled from at most {MAX_SOURCES} \
                         vault sources, each cited below."
                    ),
                    citations: vec![
                        Citation {
                            chunk_id: "c1".into(),
                            title: "Architecture decisions".into(),
                            note_path: "decisions/architecture.md".into(),
                            heading: Some("Choosing B".into()),
                            line_start: 12,
                            line_end: 18,
                            excerpt: "B keeps the write path single-threaded.".into(),
                        },
                        Citation {
                            chunk_id: "c2".into(),
                            title: "Migration plan".into(),
                            note_path: "projects/migration.md".into(),
                            heading: None,
                            line_start: 44,
                            line_end: 47,
                            excerpt: "Corpus is the oracle for every ported method.".into(),
                        },
                    ],
                });
                self.remember(asked);
            }
            Message::UseRecent(query) => self.question = query,
            Message::OpenCitation(chunk_id) => {
                let citation = self
                    .answer
                    .as_ref()
                    .and_then(|answer| {
                        answer
                            .citations
                            .iter()
                            .find(|item| item.chunk_id == chunk_id)
                    })
                    .cloned();
                match citation {
                    Some(citation) => {
                        let content = (1..=60)
                            .map(|line| format!("line {line} of {}", citation.note_path))
                            .collect::<Vec<_>>()
                            .join("\n");
                        self.source = Some(SourceView {
                            chunk_id: citation.chunk_id,
                            title: citation.title,
                            note_path: citation.note_path,
                            line_start: citation.line_start,
                            line_end: citation.line_end,
                            content,
                        });
                    }
                    None => {
                        self.error = Some(
                            "That note changed after the answer. Refresh the vault and ask again."
                                .into(),
                        )
                    }
                }
            }
            Message::OpenModelSettings => {}
        }
        Task::none()
    }

    /// `rememberQuery`: most recent first, deduped, capped at 6.
    fn remember(&mut self, query: String) {
        self.recents.retain(|item| *item != query);
        self.recents.insert(0, query);
        self.recents.truncate(RECENTS_MAX);
    }

    pub fn view(&self) -> Element<'_, Message> {
        let header = row![
            row![
                mark(),
                column![
                    h1("BuilderHelm Memory"),
                    body("Private, cited recall from your local Obsidian vault."),
                ]
                .spacing(4),
            ]
            .spacing(12)
            .align_y(iced::Alignment::Center),
            Space::new().width(Fill),
            container(primary_button("Add vault", Some(Message::AddVault))).center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let mut items: Vec<Element<'_, Message>> = vec![header.into()];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        items.push(
            row![self.nav(), self.query(), self.source_panel()]
                .spacing(16)
                .into(),
        );
        page(stack_16(items))
    }

    /// `.memoryNav`.
    fn nav(&self) -> Element<'_, Message> {
        let vault_section: Element<'_, Message> = if self.vaults.is_empty() {
            card(
                column![
                    h3("No vault connected"),
                    body("Add an Obsidian folder to build a local, read-only index."),
                ]
                .spacing(6),
            )
        } else {
            let meta: Element<'_, Message> = match &self.vault {
                None => Space::new().into(),
                Some(vault) => card(
                    column![
                        h3(format!("{} notes", vault.note_count)),
                        dim(indexed_label(vault.last_indexed_at.as_deref())),
                        text_button("Refresh index", Some(Message::RefreshIndex)),
                    ]
                    .spacing(6),
                ),
            };
            column![
                pick_list(
                    self.vaults.as_slice(),
                    self.vault.clone(),
                    Message::SelectVault
                )
                .width(Fill),
                meta,
            ]
            .spacing(8)
            .into()
        };

        let model_section: Element<'_, Message> = if self.models.is_empty() {
            card(
                column![
                    h3("No compatible model"),
                    body("Connect a text-streaming model to answer from your vault."),
                    text_button("Open model settings", Some(Message::OpenModelSettings)),
                ]
                .spacing(6),
            )
        } else {
            pick_list(
                self.models.as_slice(),
                self.model.clone(),
                Message::SelectModel,
            )
            .width(Fill)
            .into()
        };

        let recents: Element<'_, Message> = if self.recents.is_empty() {
            body("Your cited questions will stay here on this Mac.")
        } else {
            column(
                self.recents
                    .iter()
                    .map(|query| text_button(query, Some(Message::UseRecent(query.clone())))),
            )
            .spacing(6)
            .into()
        };

        container(
            column![
                label("Vault"),
                vault_section,
                label("Answer model"),
                model_section,
                label("Recent questions"),
                recents,
            ]
            .spacing(8),
        )
        .width(260)
        .into()
    }

    /// `.memoryQuery`.
    fn query(&self) -> Element<'_, Message> {
        let ask_head = row![
            column![
                h2("Ask Memory"),
                body("Every answer must point back to exact vault lines."),
            ]
            .spacing(4),
            Space::new().width(Fill),
            pill("Read-only"),
        ]
        .align_y(iced::Alignment::Center);

        let ask_form = card(
            column![
                ask_head,
                text_input(
                    "Why did I choose architecture B for Project X?",
                    &self.question
                )
                .on_input(Message::Question)
                .on_submit(Message::Ask)
                .padding(10),
                row![
                    dim(format!("{}/{QUESTION_MAX}", self.question.chars().count())),
                    Space::new().width(Fill),
                    primary_button(
                        if self.asking {
                            "Reading sources…"
                        } else {
                            "Answer with citations"
                        },
                        self.can_ask().then_some(Message::Ask),
                    ),
                ]
                .align_y(iced::Alignment::Center),
            ]
            .spacing(10),
        );

        let result: Element<'_, Message> = match &self.answer {
            None => card(
                column![
                    mark(),
                    h2("Recall with evidence"),
                    body(
                        "Ask about decisions, projects, research, or notes. BuilderHelm \
                         searches only the selected local vault and keeps every source \
                         inspectable.",
                    ),
                ]
                .spacing(8),
            ),
            Some(answer) => {
                let active = self.source.as_ref().map(|source| source.chunk_id.clone());
                let citations = answer.citations.iter().enumerate().map(|(i, citation)| {
                    let on = active.as_deref() == Some(citation.chunk_id.as_str());
                    let where_ = citation
                        .heading
                        .clone()
                        .unwrap_or_else(|| citation.note_path.clone());
                    citation_button(
                        i + 1,
                        citation,
                        where_,
                        on,
                        Message::OpenCitation(citation.chunk_id.clone()),
                    )
                });
                card(
                    column![
                        label("Cited answer"),
                        body(answer.answer.clone()),
                        column(citations).spacing(8),
                    ]
                    .spacing(10),
                )
            }
        };

        container(column![ask_form, result].spacing(16))
            .width(Fill)
            .into()
    }

    /// `.knowledgeSource`.
    fn source_panel(&self) -> Element<'_, Message> {
        match &self.source {
            None => container(card(
                column![
                    mark(),
                    h2("Source preview"),
                    body("Select a citation to inspect its note and highlighted line range."),
                ]
                .spacing(8),
            ))
            .width(320)
            .into(),
            Some(source) => {
                let head = row![
                    column![
                        label("Source preview"),
                        h3(source.title.clone()),
                        dim(source.note_path.clone()),
                    ]
                    .spacing(4),
                    Space::new().width(Fill),
                    pill(format!("Lines {}–{}", source.line_start, source.line_end)),
                ]
                .align_y(iced::Alignment::Center);
                let lines = source.content.lines().enumerate().map(|(i, line)| {
                    let number = i as u32 + 1;
                    let cited = number >= source.line_start && number <= source.line_end;
                    source_line(number, line, cited)
                });
                container(card(
                    column![head, scrollable(column(lines).spacing(0)).height(420),].spacing(10),
                ))
                .width(320)
                .into()
            }
        }
    }
}

/// `.memorySectionLabel`.
fn label<'a>(value: &'a str) -> Element<'a, Message> {
    container(
        iced::widget::text(value.to_uppercase())
            .size(11.0)
            .color(TEXT_2),
    )
    .into()
}

/// `.memoryMark`, without the SVG glyph.
fn mark<'a>() -> Element<'a, Message> {
    container(Space::new().width(19).height(19))
        .style(|_| container::Style {
            background: Some(ACCENT.into()),
            border: iced::Border {
                radius: iced::border::Radius::new(6.0),
                ..iced::Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

/// `.citationList > button`.
fn citation_button<'a>(
    index: usize,
    citation: &'a Citation,
    where_: String,
    active: bool,
    msg: Message,
) -> Element<'a, Message> {
    iced::widget::button(
        column![
            row![
                iced::widget::text(format!("[S{index}]"))
                    .size(11.0)
                    .color(ACCENT),
                iced::widget::text(citation.title.clone())
                    .size(13.0)
                    .color(TEXT),
            ]
            .spacing(8),
            dim(format!(
                "{where_} · lines {}–{}",
                citation.line_start, citation.line_end
            )),
            body(citation.excerpt.clone()),
        ]
        .spacing(4),
    )
    .width(Fill)
    .padding(10)
    .on_press(msg)
    .style(move |_, status| {
        let hover = matches!(status, iced::widget::button::Status::Hovered);
        iced::widget::button::Style {
            background: Some(
                if active || hover {
                    ACCENT_DIM
                } else {
                    crate::tokens::rgba(255, 255, 255, 0.02)
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
}

/// `.sourceLine` / `.sourceLineCited`.
fn source_line(number: u32, line: &str, cited: bool) -> Element<'_, Message> {
    let text = if line.is_empty() { " " } else { line };
    container(
        row![
            iced::widget::text(format!("{number:>3}"))
                .size(11.0)
                .font(Font::MONOSPACE)
                .color(TEXT_2),
            iced::widget::text(text)
                .size(12.0)
                .font(Font::MONOSPACE)
                .color(TEXT),
        ]
        .spacing(8),
    )
    .style(move |_| container::Style {
        background: cited.then(|| ACCENT_DIM.into()),
        ..container::Style::default()
    })
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ask_needs_vault_model_and_question() {
        let mut state = State::default();
        assert!(!state.can_ask(), "no question yet");
        let _ = state.update(Message::Question("  ".into()));
        assert!(!state.can_ask(), "whitespace is not a question");
        let _ = state.update(Message::Question("why B?".into()));
        assert!(state.can_ask());
        state.vault = None;
        assert!(!state.can_ask(), "vault is required");
    }

    #[test]
    fn question_is_capped_at_two_thousand_chars() {
        let mut state = State::default();
        let _ = state.update(Message::Question("x".repeat(QUESTION_MAX + 50)));
        assert_eq!(state.question.chars().count(), QUESTION_MAX);
    }

    #[test]
    fn recents_dedupe_and_cap_at_six() {
        let mut state = State::default();
        state.recents.clear();
        for i in 0..8 {
            state.remember(format!("q{i}"));
        }
        assert_eq!(state.recents.len(), RECENTS_MAX);
        assert_eq!(state.recents[0], "q7", "most recent first");
        state.remember("q7".into());
        assert_eq!(state.recents.len(), RECENTS_MAX);
        assert_eq!(
            state.recents.iter().filter(|item| *item == "q7").count(),
            1,
            "no duplicates"
        );
    }

    #[test]
    fn switching_vault_clears_answer_and_source() {
        let mut state = State::default();
        let _ = state.update(Message::Question("why B?".into()));
        let _ = state.update(Message::Ask);
        assert!(state.answer.is_some());
        let chunk = state.answer.as_ref().unwrap().citations[0].chunk_id.clone();
        let _ = state.update(Message::OpenCitation(chunk));
        assert!(state.source.is_some());
        let vault = state.vaults[0].clone();
        let _ = state.update(Message::SelectVault(vault));
        assert!(state.answer.is_none());
        assert!(state.source.is_none());
    }

    #[test]
    fn model_settings_link_navigates() {
        assert_eq!(
            State::nav_target(&Message::OpenModelSettings),
            Some(Route::Settings)
        );
    }
}
