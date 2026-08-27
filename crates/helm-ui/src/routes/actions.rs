//! `routes/actions.tsx` (413 lines).
//!
//! **Permission surface.** This route renders per-tool policy. The two guards
//! that matter are preserved verbatim:
//!
//! - only `risk == reversible_write` tools appear in the policy list
//! - `auto_approve` is unselectable when `rollback_support == None`
//!
//! The policy store itself is `helm-core/src/actions/action_service.rs`,
//! which is human-reviewed. Nothing here grants a permission; it
//! only shows and requests one.

use iced::widget::{column, container, pick_list, row, text_input, Space};
use iced::{Element, Fill, Font, Task};

use super::common::{
    body, card, dim, error_banner, eyebrow, h1, h2, h3, lede, page, pill, primary_button,
    secondary_button, stack_16, stop_button, text_button,
};
use crate::tokens::{ACCENT, TEXT, WARNING};

/// `maxLength={2_000}` on the composer.
pub const COMMAND_MAX: usize = 2_000;

/// `commandExamples`.
pub const EXAMPLES: [&str; 4] = [
    "Create project Project A",
    "Add a high-priority task to Project A to benchmark sync tomorrow",
    "Show status of Project A",
    "Mark task-name complete",
];

/// `toolDescriptorSchema.risk`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Risk {
    Read,
    ReversibleWrite,
    Destructive,
    External,
}

/// `toolDescriptorSchema.rollbackSupport`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rollback {
    None,
    Partial,
    Full,
}

/// `permissionPolicyModeSchema`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyMode {
    Ask,
    AutoApprove,
    Deny,
}

impl PolicyMode {
    pub fn label(self) -> &'static str {
        match self {
            PolicyMode::Ask => "Ask every time",
            PolicyMode::AutoApprove => "Auto-approve",
            PolicyMode::Deny => "Deny",
        }
    }
}

impl std::fmt::Display for PolicyMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Clone, Debug)]
pub struct Tool {
    pub id: String,
    pub description: String,
    pub risk: Risk,
    pub rollback_support: Rollback,
}

impl Tool {
    /// `<option value="auto_approve" disabled={tool.rollbackSupport === 'none'}>`.
    pub fn allows_auto_approve(&self) -> bool {
        self.rollback_support != Rollback::None
    }

    /// The modes offered for this tool, in TSX option order.
    pub fn modes(&self) -> Vec<PolicyMode> {
        if self.allows_auto_approve() {
            vec![PolicyMode::Ask, PolicyMode::AutoApprove, PolicyMode::Deny]
        } else {
            vec![PolicyMode::Ask, PolicyMode::Deny]
        }
    }
}

#[derive(Clone, Debug)]
pub struct Resource {
    pub kind: String,
    pub label: String,
}

#[derive(Clone, Debug)]
pub struct Approval {
    pub id: String,
    pub risk: String,
    pub summary: String,
    pub expires_at: String,
    pub affected: Vec<Resource>,
    pub exact_arguments: String,
    pub from_model: bool,
    pub reversible: bool,
}

#[derive(Clone, Debug)]
pub struct Receipt {
    pub id: String,
    pub requested_action: String,
    pub tool_id: String,
    pub approval_state: String,
    pub created_at: String,
    pub exact_arguments: String,
    pub result: String,
    pub rollback_information: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub status: String,
    pub tasks: usize,
    pub done: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FallbackParser {
    pub reference: Option<String>,
    pub label: String,
}

impl std::fmt::Display for FallbackParser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.label)
    }
}

#[derive(Clone, Debug)]
pub struct Outcome {
    pub message: String,
    pub result: Option<String>,
}

/// `toolLabel`.
fn tool_label(value: &str) -> String {
    value.replace('.', " · ").replace('_', " ")
}

pub struct State {
    pub tools: Vec<Tool>,
    pub policies: Vec<(String, PolicyMode)>,
    pub approvals: Vec<Approval>,
    pub receipts: Vec<Receipt>,
    pub projects: Vec<Project>,
    pub parsers: Vec<FallbackParser>,
    pub parser: Option<FallbackParser>,
    pub command: String,
    pub outcome: Option<Outcome>,
    pub error: Option<String>,
    pub busy: bool,
    pub open_receipt: Option<String>,
    pub open_arguments: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        let parsers = vec![
            FallbackParser {
                reference: None,
                label: "Deterministic only".into(),
            },
            FallbackParser {
                reference: Some("openai/gpt-5".into()),
                label: "GPT-5".into(),
            },
        ];
        let parser = parsers.first().cloned();
        Self {
            tools: vec![
                Tool {
                    id: "projects.create_project".into(),
                    description: "Create a local project row.".into(),
                    risk: Risk::ReversibleWrite,
                    rollback_support: Rollback::Full,
                },
                Tool {
                    id: "tasks.create_task".into(),
                    description: "Add a task to an existing project.".into(),
                    risk: Risk::ReversibleWrite,
                    rollback_support: Rollback::Full,
                },
                Tool {
                    id: "tasks.complete_task".into(),
                    description: "Mark a task done.".into(),
                    risk: Risk::ReversibleWrite,
                    rollback_support: Rollback::None,
                },
                Tool {
                    id: "projects.read_status".into(),
                    description: "Read project status.".into(),
                    risk: Risk::Read,
                    rollback_support: Rollback::Full,
                },
            ],
            policies: vec![("tasks.create_task".into(), PolicyMode::AutoApprove)],
            approvals: vec![Approval {
                id: "ap-1".into(),
                risk: "reversible_write".into(),
                summary: "Add task “benchmark the sync layer” to Project A".into(),
                expires_at: "27 Aug 15:10".into(),
                affected: vec![Resource {
                    kind: "project".into(),
                    label: "Project A".into(),
                }],
                exact_arguments: "{\n  \"projectId\": \"pa\",\n  \"title\": \"benchmark the sync layer\",\n  \"priority\": \"high\"\n}".into(),
                from_model: false,
                reversible: true,
            }],
            receipts: vec![Receipt {
                id: "rc-1".into(),
                requested_action: "Create project Project A".into(),
                tool_id: "projects.create_project".into(),
                approval_state: "approved_exact".into(),
                created_at: "27 Aug 09:02".into(),
                exact_arguments: "{\n  \"name\": \"Project A\"\n}".into(),
                result: "{\n  \"projectId\": \"pa\"\n}".into(),
                rollback_information: Some("{\n  \"delete\": \"projects/pa\"\n}".into()),
            }],
            projects: vec![Project {
                id: "pa".into(),
                name: "Project A".into(),
                status: "active".into(),
                tasks: 3,
                done: 1,
            }],
            parsers,
            parser,
            command: String::new(),
            outcome: None,
            error: None,
            busy: false,
            open_receipt: None,
            open_arguments: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Command(String),
    UseExample(&'static str),
    SelectParser(FallbackParser),
    Propose,
    Approve(String),
    Reject(String),
    SetPolicy(String, PolicyMode),
    ToggleArguments(String),
    ToggleReceipt(String),
}

impl State {
    /// `disabled={busy || commandText.trim().length === 0}`.
    pub fn can_propose(&self) -> bool {
        !self.busy && !self.command.trim().is_empty()
    }

    /// `writeTools` — only reversible writes get a policy control.
    pub fn write_tools(&self) -> Vec<&Tool> {
        self.tools
            .iter()
            .filter(|tool| tool.risk == Risk::ReversibleWrite)
            .collect()
    }

    /// `policies.get(tool.id) ?? 'ask'`.
    pub fn policy(&self, tool_id: &str) -> PolicyMode {
        self.policies
            .iter()
            .find(|(id, _)| id == tool_id)
            .map(|(_, mode)| *mode)
            .unwrap_or(PolicyMode::Ask)
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Command(value) => {
                self.command = value.chars().take(COMMAND_MAX).collect();
            }
            Message::UseExample(example) => self.command = example.to_string(),
            Message::SelectParser(parser) => self.parser = Some(parser),
            Message::Propose => {
                if !self.can_propose() {
                    return Task::none();
                }
                let text = self.command.trim().to_string();
                self.error = None;
                self.outcome = Some(Outcome {
                    message: format!("Proposed “{text}”. Approve the exact action below."),
                    result: None,
                });
                self.command.clear();
            }
            Message::Approve(id) => {
                let found = self.approvals.iter().position(|item| item.id == id);
                match found {
                    Some(index) => {
                        let approval = self.approvals.remove(index);
                        self.receipts.insert(
                            0,
                            Receipt {
                                id: format!("rc-{}", self.receipts.len() + 1),
                                requested_action: approval.summary.clone(),
                                tool_id: "tasks.create_task".into(),
                                approval_state: "approved_exact".into(),
                                created_at: approval.expires_at.clone(),
                                exact_arguments: approval.exact_arguments,
                                result: "{\n  \"ok\": true\n}".into(),
                                rollback_information: approval
                                    .reversible
                                    .then(|| "{\n  \"undo\": true\n}".to_string()),
                            },
                        );
                        self.outcome = Some(Outcome {
                            message: approval.summary,
                            result: None,
                        });
                    }
                    None => {
                        self.error = Some(
                            "The action was not executed. It may have expired or changed policy."
                                .into(),
                        )
                    }
                }
            }
            Message::Reject(id) => {
                let before = self.approvals.len();
                self.approvals.retain(|item| item.id != id);
                if self.approvals.len() == before {
                    self.error = Some("The approval could not be rejected.".into());
                }
            }
            Message::SetPolicy(tool_id, mode) => {
                let allowed = self
                    .tools
                    .iter()
                    .find(|tool| tool.id == tool_id)
                    .map(|tool| {
                        tool.risk == Risk::ReversibleWrite
                            && (mode != PolicyMode::AutoApprove || tool.allows_auto_approve())
                    })
                    .unwrap_or(false);
                if !allowed {
                    self.error = Some("The permission policy was not changed.".into());
                    return Task::none();
                }
                match self.policies.iter_mut().find(|(id, _)| *id == tool_id) {
                    Some(entry) => entry.1 = mode,
                    None => self.policies.push((tool_id, mode)),
                }
                self.error = None;
            }
            Message::ToggleArguments(id) => {
                self.open_arguments =
                    (self.open_arguments.as_deref() != Some(id.as_str())).then_some(id);
            }
            Message::ToggleReceipt(id) => {
                self.open_receipt =
                    (self.open_receipt.as_deref() != Some(id.as_str())).then_some(id);
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let header = row![
            column![
                eyebrow("Permission-controlled local tools"),
                h1("Actions"),
                lede("Describe one task or project action. Zero validates it before any write."),
            ]
            .spacing(6),
            Space::new().width(Fill),
            container(pill("Exact approval · immutable receipt")).center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let mut items: Vec<Element<'_, Message>> = vec![header.into()];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        items.push(
            row![self.command_panel(), self.snapshot_panel()]
                .spacing(16)
                .into(),
        );
        items.push(self.approvals_panel());
        items.push(
            row![self.policy_panel(), self.receipts_panel()]
                .spacing(16)
                .into(),
        );
        page(stack_16(items))
    }

    /// `.actionCommandPanel`.
    fn command_panel(&self) -> Element<'_, Message> {
        let intro = row![
            column![eyebrow("Action chat"), h2("What should change?")].spacing(4),
            Space::new().width(Fill),
            column![
                dim("Fallback parser"),
                pick_list(
                    self.parsers.as_slice(),
                    self.parser.clone(),
                    Message::SelectParser
                ),
            ]
            .spacing(4),
        ]
        .align_y(iced::Alignment::Center);

        let examples = column(
            EXAMPLES
                .iter()
                .map(|example| text_button(example, Some(Message::UseExample(example)))),
        )
        .spacing(6);

        let mut cell: Vec<Element<'_, Message>> = vec![
            intro.into(),
            text_input(
                "Add a high-priority task to Project A to benchmark the sync layer tomorrow.",
                &self.command,
            )
            .on_input(Message::Command)
            .on_submit(Message::Propose)
            .padding(10)
            .into(),
            row![
                body(
                    "Local parser runs first. A selected model can only propose registered tools."
                ),
                Space::new().width(Fill),
                primary_button(
                    if self.busy {
                        "Validating…"
                    } else {
                        "Propose action"
                    },
                    self.can_propose().then_some(Message::Propose),
                ),
            ]
            .spacing(10)
            .align_y(iced::Alignment::Center)
            .into(),
            examples.into(),
        ];
        if let Some(outcome) = &self.outcome {
            let mut lines: Vec<Element<'_, Message>> =
                vec![eyebrow("Zero"), h3(outcome.message.clone())];
            if let Some(result) = &outcome.result {
                lines.push(code(result));
            }
            cell.push(card(column(lines).spacing(6)));
        }
        container(column(cell).spacing(12)).width(Fill).into()
    }

    /// `.workSnapshot`.
    fn snapshot_panel(&self) -> Element<'_, Message> {
        let mut cell: Vec<Element<'_, Message>> = vec![
            eyebrow("Local work state"),
            h2(format!("{} projects", self.projects.len())),
        ];
        if self.projects.is_empty() {
            cell.push(body("Start with “Create project Project A”."));
        }
        for project in &self.projects {
            let plural = if project.tasks == 1 { "" } else { "s" };
            cell.push(card(
                column![
                    row![
                        h3(project.name.clone()),
                        Space::new().width(Fill),
                        pill(project.status.clone()),
                    ]
                    .align_y(iced::Alignment::Center),
                    dim(format!(
                        "{} task{plural} · {} done",
                        project.tasks, project.done
                    )),
                ]
                .spacing(6),
            ));
        }
        container(column(cell).spacing(10)).width(300).into()
    }

    /// `.approvalSection`.
    fn approvals_panel(&self) -> Element<'_, Message> {
        let head = row![
            column![eyebrow("Human control"), h2("Pending approvals")].spacing(4),
            Space::new().width(Fill),
            pill(format!("{} waiting", self.approvals.len())),
        ]
        .align_y(iced::Alignment::Center);
        let mut cell: Vec<Element<'_, Message>> = vec![head.into()];
        if self.approvals.is_empty() {
            cell.push(body("No action is waiting for approval."));
        }
        for approval in &self.approvals {
            cell.push(self.approval_card(approval));
        }
        column(cell).spacing(10).into()
    }

    /// `.approvalCard`.
    fn approval_card<'a>(&'a self, approval: &'a Approval) -> Element<'a, Message> {
        let open = self.open_arguments.as_deref() == Some(approval.id.as_str());
        let source = format!(
            "Proposed by {}{}",
            if approval.from_model {
                "selected model"
            } else {
                "local parser"
            },
            if approval.reversible {
                " · reversible write"
            } else {
                " · no rollback"
            }
        );
        let mut cell: Vec<Element<'a, Message>> = vec![
            row![
                column![
                    iced::widget::text(
                        format!("Approval required · {}", approval.risk).to_uppercase(),
                    )
                    .size(11.0)
                    .color(ACCENT),
                    h3(approval.summary.clone()),
                ]
                .spacing(4),
                Space::new().width(Fill),
                dim(format!("Expires {}", approval.expires_at)),
            ]
            .align_y(iced::Alignment::Center)
            .into(),
            row(approval
                .affected
                .iter()
                .map(|resource| pill(format!("{}: {}", resource.kind, resource.label))))
            .spacing(8)
            .into(),
            text_button(
                if open {
                    "Hide exact arguments"
                } else {
                    "Inspect exact arguments"
                },
                Some(Message::ToggleArguments(approval.id.clone())),
            ),
        ];
        if open {
            cell.push(code(&approval.exact_arguments));
        }
        cell.push(body(source));
        cell.push(
            row![
                Space::new().width(Fill),
                stop_button(
                    "Reject",
                    (!self.busy).then(|| Message::Reject(approval.id.clone()))
                ),
                primary_button(
                    "Approve exact action",
                    (!self.busy).then(|| Message::Approve(approval.id.clone()))
                ),
            ]
            .spacing(10)
            .into(),
        );
        card(column(cell).spacing(8))
    }

    /// `.policyPanel`.
    fn policy_panel(&self) -> Element<'_, Message> {
        let mut cell: Vec<Element<'_, Message>> = vec![
            column![eyebrow("Per-tool defaults"), h2("Permissions")]
                .spacing(4)
                .into(),
            warn(
                "Auto-approve means future matching writes execute immediately. \
                 Destructive and external actions can never use this setting.",
            ),
        ];
        for tool in self.write_tools() {
            let id = tool.id.clone();
            cell.push(card(
                row![
                    column![h3(tool_label(&tool.id)), dim(tool.description.clone())]
                        .spacing(2)
                        .width(Fill),
                    pick_list(tool.modes(), Some(self.policy(&tool.id)), move |mode| {
                        Message::SetPolicy(id.clone(), mode)
                    }),
                ]
                .spacing(10)
                .align_y(iced::Alignment::Center),
            ));
        }
        container(column(cell).spacing(10)).width(Fill).into()
    }

    /// `.receiptPanel`.
    fn receipts_panel(&self) -> Element<'_, Message> {
        let head = row![
            column![eyebrow("Append-only history"), h2("Action receipts")].spacing(4),
            Space::new().width(Fill),
            pill(format!("{} recorded", self.receipts.len())),
        ]
        .align_y(iced::Alignment::Center);
        let mut cell: Vec<Element<'_, Message>> = vec![head.into()];
        if self.receipts.is_empty() {
            cell.push(body("Approved actions will leave receipts here."));
        }
        for receipt in &self.receipts {
            cell.push(self.receipt_card(receipt));
        }
        container(column(cell).spacing(10)).width(Fill).into()
    }

    /// `.receiptCard`.
    fn receipt_card<'a>(&'a self, receipt: &'a Receipt) -> Element<'a, Message> {
        let open = self.open_receipt.as_deref() == Some(receipt.id.as_str());
        let mut cell: Vec<Element<'a, Message>> = vec![row![
            column![
                h3(receipt.requested_action.clone()),
                dim(format!(
                    "{} · {}",
                    tool_label(&receipt.tool_id),
                    receipt.approval_state.replace('_', " ")
                )),
            ]
            .spacing(2)
            .width(Fill),
            dim(receipt.created_at.clone()),
            secondary_button(
                if open { "Hide" } else { "Open" },
                Some(Message::ToggleReceipt(receipt.id.clone())),
            ),
        ]
        .spacing(10)
        .align_y(iced::Alignment::Center)
        .into()];
        if open {
            cell.push(dim(format!("Receipt {}", receipt.id)));
            cell.push(dim("Arguments"));
            cell.push(code(&receipt.exact_arguments));
            cell.push(dim("Result"));
            cell.push(code(&receipt.result));
            if let Some(rollback) = &receipt.rollback_information {
                cell.push(dim("Rollback information"));
                cell.push(code(rollback));
            }
        }
        card(column(cell).spacing(8))
    }
}

/// `<pre>` block.
fn code(value: &str) -> Element<'_, Message> {
    container(
        iced::widget::text(value)
            .size(12.0)
            .font(Font::MONOSPACE)
            .color(TEXT),
    )
    .padding(10)
    .width(Fill)
    .style(|_| container::Style {
        background: Some(crate::tokens::BG_1.into()),
        border: iced::Border {
            color: crate::tokens::LINE,
            width: 1.0,
            radius: iced::border::Radius::new(crate::tokens::RADIUS_S),
        },
        ..container::Style::default()
    })
    .into()
}

/// `.policyWarning`.
fn warn<'a>(value: &'a str) -> Element<'a, Message> {
    container(iced::widget::text(value).size(12.0).color(WARNING))
        .padding(10)
        .width(Fill)
        .style(|_| container::Style {
            background: Some(crate::tokens::rgba(242, 201, 76, 0.1).into()),
            border: iced::Border {
                color: crate::tokens::rgba(242, 201, 76, 0.25),
                width: 1.0,
                radius: iced::border::Radius::new(crate::tokens::RADIUS_S),
            },
            ..container::Style::default()
        })
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_reversible_writes_get_a_policy_control() {
        let state = State::default();
        let ids: Vec<&str> = state
            .write_tools()
            .iter()
            .map(|tool| tool.id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec![
                "projects.create_project",
                "tasks.create_task",
                "tasks.complete_task"
            ]
        );
        assert!(
            !ids.contains(&"projects.read_status"),
            "read tools have no policy row"
        );
    }

    #[test]
    fn auto_approve_is_impossible_without_rollback() {
        let mut state = State::default();
        let no_rollback = state
            .tools
            .iter()
            .find(|tool| tool.id == "tasks.complete_task")
            .unwrap();
        assert!(!no_rollback.allows_auto_approve());
        assert_eq!(no_rollback.modes(), vec![PolicyMode::Ask, PolicyMode::Deny]);
        let _ = state.update(Message::SetPolicy(
            "tasks.complete_task".into(),
            PolicyMode::AutoApprove,
        ));
        assert_eq!(state.policy("tasks.complete_task"), PolicyMode::Ask);
        assert!(state.error.is_some(), "refusal must be reported");
    }

    #[test]
    fn read_tools_cannot_be_granted_a_policy() {
        let mut state = State::default();
        let _ = state.update(Message::SetPolicy(
            "projects.read_status".into(),
            PolicyMode::AutoApprove,
        ));
        assert_eq!(state.policy("projects.read_status"), PolicyMode::Ask);
        assert!(state.error.is_some());
    }

    #[test]
    fn approving_consumes_the_request_and_writes_a_receipt() {
        let mut state = State::default();
        let receipts = state.receipts.len();
        let _ = state.update(Message::Approve("ap-1".into()));
        assert!(state.approvals.is_empty());
        assert_eq!(state.receipts.len(), receipts + 1);
        let _ = state.update(Message::Approve("ap-1".into()));
        assert!(state.error.is_some(), "second approve must fail closed");
    }

    #[test]
    fn propose_needs_text_and_command_is_capped() {
        let mut state = State::default();
        assert!(!state.can_propose());
        let _ = state.update(Message::Command("   ".into()));
        assert!(!state.can_propose());
        let _ = state.update(Message::Command("x".repeat(COMMAND_MAX + 10)));
        assert_eq!(state.command.chars().count(), COMMAND_MAX);
        assert!(state.can_propose());
        let _ = state.update(Message::Propose);
        assert!(state.command.is_empty());
        assert!(state.outcome.is_some());
    }

    #[test]
    fn tool_label_matches_the_tsx_transform() {
        assert_eq!(tool_label("tasks.create_task"), "tasks · create task");
    }
}
