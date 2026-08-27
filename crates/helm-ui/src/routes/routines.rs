//! `routes/routines.tsx` (112 lines).

use iced::widget::{column, container, pick_list, row, text_input, Space};
use iced::{Element, Fill, Task};

use super::common::{
    body, card, error_banner, eyebrow, h1, h3, lede, page, pill, primary_button, stack_16,
};
use crate::tokens::TEXT_2;

/// `everyMinutes` floor from the TSX `min={15}`.
pub const MIN_MINUTES: u32 = 15;
/// `useState(1440)`.
pub const DEFAULT_MINUTES: u32 = 1440;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Agent {
    pub id: String,
    pub name: String,
}

impl std::fmt::Display for Agent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.name)
    }
}

#[derive(Clone, Debug)]
pub struct Routine {
    pub name: String,
    pub instruction: String,
    pub every_minutes: u32,
    pub paused: bool,
}

pub struct State {
    pub agents: Vec<Agent>,
    pub routines: Vec<Routine>,
    pub agent: Option<Agent>,
    pub name: String,
    pub instruction: String,
    pub minutes: u32,
    pub minutes_input: String,
    pub error: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            agents: vec![
                Agent {
                    id: "claude".into(),
                    name: "Claude".into(),
                },
                Agent {
                    id: "codex".into(),
                    name: "Codex".into(),
                },
                Agent {
                    id: "grok".into(),
                    name: "Grok".into(),
                },
            ],
            routines: vec![Routine {
                name: "Morning repo summary".into(),
                instruction: "Inspect this week’s merges. Draft notes. Do not publish.".into(),
                every_minutes: 1440,
                paused: false,
            }],
            agent: None,
            name: String::new(),
            instruction: String::new(),
            minutes: DEFAULT_MINUTES,
            minutes_input: DEFAULT_MINUTES.to_string(),
            error: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Agent(Agent),
    Name(String),
    Instruction(String),
    Minutes(String),
    Save,
}

impl State {
    /// `disabled={name.trim().length === 0 || agentId.length === 0}`.
    pub fn can_save(&self) -> bool {
        !self.name.trim().is_empty() && self.agent.is_some()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Agent(agent) => self.agent = Some(agent),
            Message::Name(value) => self.name = value,
            Message::Instruction(value) => self.instruction = value,
            Message::Minutes(value) => {
                self.minutes_input = value;
                match self.minutes_input.trim().parse::<u32>() {
                    Ok(parsed) if parsed >= MIN_MINUTES => {
                        self.minutes = parsed;
                        self.error = None;
                    }
                    Ok(_) => {
                        self.error =
                            Some(format!("Interval must be at least {MIN_MINUTES} minutes"))
                    }
                    Err(_) => self.error = Some("Interval must be a whole number".into()),
                }
            }
            Message::Save => {
                if !self.can_save() {
                    return Task::none();
                }
                self.routines.push(Routine {
                    name: self.name.trim().to_string(),
                    instruction: self.instruction.trim().to_string(),
                    every_minutes: self.minutes,
                    paused: false,
                });
                self.name.clear();
                self.instruction.clear();
                self.error = None;
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let mut items: Vec<Element<'_, Message>> = vec![
            eyebrow("Routines"),
            h1("Scheduled teammates"),
            lede(
                "Runs only while BuilderHelm is open. Each tick opens a fresh Chat draft. \
                 No publish, delete, or pay unattended.",
            ),
        ];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        items.push(self.form());
        items.push(self.recap());
        page(stack_16(items))
    }

    /// `.wizardSection` form.
    fn form(&self) -> Element<'_, Message> {
        card(
            column![
                label("Agent"),
                pick_list(self.agents.as_slice(), self.agent.clone(), Message::Agent)
                    .placeholder("Choose teammate")
                    .width(Fill),
                text_input("Morning repo summary", &self.name)
                    .on_input(Message::Name)
                    .padding(10),
                text_input(
                    "Inspect this week’s merges. Draft notes. Do not publish.",
                    &self.instruction,
                )
                .on_input(Message::Instruction)
                .padding(10),
                label("Every N minutes"),
                text_input("1440", &self.minutes_input)
                    .on_input(Message::Minutes)
                    .padding(10),
                row![
                    Space::new().width(Fill),
                    primary_button("Save routine", self.can_save().then_some(Message::Save)),
                ],
            ]
            .spacing(10),
        )
    }

    /// `.swarmRecap` list.
    fn recap(&self) -> Element<'_, Message> {
        if self.routines.is_empty() {
            return super::common::empty_state("No routines yet");
        }
        let rows = self.routines.iter().map(|routine| {
            let cadence = if routine.paused {
                "paused".to_string()
            } else {
                format!("every {}m", routine.every_minutes)
            };
            card(
                column![
                    row![
                        pill(cadence),
                        Space::new().width(Fill),
                        h3(routine.name.clone()),
                    ]
                    .spacing(10)
                    .align_y(iced::Alignment::Center),
                    body(routine.instruction.clone()),
                ]
                .spacing(8),
            )
        });
        column(rows).spacing(10).into()
    }
}

/// `.wizardLabel`.
fn label<'a>(value: &'a str) -> Element<'a, Message> {
    container(iced::widget::text(value).size(12.0).color(TEXT_2)).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_needs_name_and_agent() {
        let mut state = State::default();
        assert!(!state.can_save());
        let _ = state.update(Message::Name("  ".into()));
        assert!(!state.can_save(), "whitespace name is not a name");
        let _ = state.update(Message::Name("Nightly sweep".into()));
        assert!(!state.can_save(), "still no agent");
        let agent = state.agents[0].clone();
        let _ = state.update(Message::Agent(agent));
        assert!(state.can_save());
    }

    #[test]
    fn interval_floor_is_enforced() {
        let mut state = State::default();
        let _ = state.update(Message::Minutes("5".into()));
        assert!(state.error.is_some());
        assert_eq!(state.minutes, DEFAULT_MINUTES, "rejected value not applied");
        let _ = state.update(Message::Minutes("60".into()));
        assert_eq!(state.minutes, 60);
        assert!(state.error.is_none());
    }

    #[test]
    fn save_appends_and_clears_the_form() {
        let mut state = State::default();
        let before = state.routines.len();
        let agent = state.agents[0].clone();
        let _ = state.update(Message::Agent(agent));
        let _ = state.update(Message::Name("Nightly sweep".into()));
        let _ = state.update(Message::Instruction(" draft only ".into()));
        let _ = state.update(Message::Save);
        assert_eq!(state.routines.len(), before + 1);
        assert_eq!(state.routines.last().unwrap().instruction, "draft only");
        assert!(state.name.is_empty());
        assert!(!state.can_save(), "cleared form cannot re-save");
    }
}
