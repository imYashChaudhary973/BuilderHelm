//! `routes/settings/providers.tsx` (333) + `features/providers/provider-form.tsx`
//! (212) + `features/providers/model-capability-editor.tsx` (111).
//!
//! Credential handling mirrors the TSX exactly: the API key lives only in the
//! form buffer and is cleared on submit (`apiKeyInput.value = ''`). This route
//! never persists, logs, or transmits it. Keychain storage is `helm-host`
//! (`keyring_secret_store.rs`, human-reviewed).

use iced::widget::{checkbox, column, container, pick_list, row, text_input, Space};
use iced::{Element, Fill, Task};

use super::common::{
    body, card, danger_button, dim, empty_state, error_banner, eyebrow, h1, h2, h3, lede, page,
    pill, primary_button, secondary_button, stack_16, success_banner, text_button,
};
use crate::tokens::{ACCENT, DANGER, TEXT, TEXT_2, TEXT_3};

/// `providerSchema.label` — `z.string().max(100)`.
pub const LABEL_MAX: usize = 100;
/// `apiKey` — `maxLength={16_384}`.
pub const API_KEY_MAX: usize = 16_384;

/// `protocolOptions` in `provider-form.tsx`, same order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    OpenAi,
    Anthropic,
    OpenAiCompatible,
    AnthropicCompatible,
    Ollama,
    LiteLlm,
    Custom,
}

impl Protocol {
    pub const ALL: [Protocol; 7] = [
        Protocol::OpenAi,
        Protocol::Anthropic,
        Protocol::OpenAiCompatible,
        Protocol::AnthropicCompatible,
        Protocol::Ollama,
        Protocol::LiteLlm,
        Protocol::Custom,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Protocol::OpenAi => "OpenAI",
            Protocol::Anthropic => "Anthropic",
            Protocol::OpenAiCompatible => "OpenAI-compatible",
            Protocol::AnthropicCompatible => "Anthropic-compatible",
            Protocol::Ollama => "Ollama",
            Protocol::LiteLlm => "LiteLLM",
            Protocol::Custom => "Custom",
        }
    }

    /// `wire` name, as stored.
    pub fn wire(self) -> &'static str {
        match self {
            Protocol::OpenAi => "openai",
            Protocol::Anthropic => "anthropic",
            Protocol::OpenAiCompatible => "openai-compatible",
            Protocol::AnthropicCompatible => "anthropic-compatible",
            Protocol::Ollama => "ollama",
            Protocol::LiteLlm => "litellm",
            Protocol::Custom => "custom",
        }
    }

    /// `['openai','anthropic','openai-compatible','ollama'].includes(...)`.
    pub fn adapter_available(self) -> bool {
        matches!(
            self,
            Protocol::OpenAi | Protocol::Anthropic | Protocol::OpenAiCompatible | Protocol::Ollama
        )
    }
}

impl std::fmt::Display for Protocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Privacy {
    pub allow_personal: bool,
    pub allow_sensitive: bool,
    pub allow_health: bool,
}

impl Default for Privacy {
    /// `defaultChecked` in the fieldset: personal true, the rest false.
    fn default() -> Self {
        Self {
            allow_personal: true,
            allow_sensitive: false,
            allow_health: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub protocol: Protocol,
    pub base_url: Option<String>,
    pub privacy: Privacy,
    pub enabled: bool,
}

#[derive(Clone, Debug)]
pub struct Model {
    pub provider_id: String,
    pub reference: String,
}

/// Form buffer. `api_key` is transient by contract.
#[derive(Clone, Debug)]
pub struct Form {
    pub editing: Option<String>,
    pub label: String,
    pub protocol: Protocol,
    pub base_url: String,
    pub api_key: String,
    pub privacy: Privacy,
    pub enabled: bool,
}

impl Default for Form {
    fn default() -> Self {
        Self {
            editing: None,
            label: String::new(),
            protocol: Protocol::OpenAi,
            base_url: String::new(),
            api_key: String::new(),
            privacy: Privacy::default(),
            enabled: true,
        }
    }
}

impl Form {
    /// `required` on label; `required={existing === null && protocol !== 'ollama'}`
    /// on the key.
    pub fn can_save(&self) -> bool {
        let label = self.label.trim();
        if label.is_empty() || label.chars().count() > LABEL_MAX {
            return false;
        }
        if self.api_key.chars().count() > API_KEY_MAX {
            return false;
        }
        if self.editing.is_none() && self.protocol != Protocol::Ollama {
            return !self.api_key.is_empty();
        }
        true
    }

    fn from_provider(provider: &Provider) -> Self {
        Self {
            editing: Some(provider.id.clone()),
            label: provider.label.clone(),
            protocol: provider.protocol,
            base_url: provider.base_url.clone().unwrap_or_default(),
            api_key: String::new(),
            privacy: provider.privacy,
            enabled: provider.enabled,
        }
    }
}

pub struct State {
    pub providers: Vec<Provider>,
    pub models: Vec<Model>,
    pub form: Form,
    pub deleting: Option<String>,
    pub error: Option<String>,
    pub notice: Option<String>,
    pub busy: bool,
    pub testing: Option<String>,
    pub discovering: Option<String>,
    next_id: u32,
}

impl Default for State {
    fn default() -> Self {
        Self {
            providers: vec![
                Provider {
                    id: "openai-1".into(),
                    label: "OpenAI".into(),
                    protocol: Protocol::OpenAi,
                    base_url: None,
                    privacy: Privacy::default(),
                    enabled: true,
                },
                Provider {
                    id: "ollama-1".into(),
                    label: "Local Ollama".into(),
                    protocol: Protocol::Ollama,
                    base_url: Some("http://127.0.0.1:11434".into()),
                    privacy: Privacy {
                        allow_personal: true,
                        allow_sensitive: true,
                        allow_health: false,
                    },
                    enabled: false,
                },
            ],
            models: vec![
                Model {
                    provider_id: "openai-1".into(),
                    reference: "openai/gpt-5".into(),
                },
                Model {
                    provider_id: "openai-1".into(),
                    reference: "openai/gpt-5-mini".into(),
                },
                Model {
                    provider_id: "ollama-1".into(),
                    reference: "ollama/llama3".into(),
                },
            ],
            form: Form::default(),
            deleting: None,
            error: None,
            notice: None,
            busy: false,
            testing: None,
            discovering: None,
            next_id: 2,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Edit(String),
    CancelEdit,
    Label(String),
    Protocol(Protocol),
    BaseUrl(String),
    ApiKey(String),
    AllowPersonal(bool),
    AllowSensitive(bool),
    AllowHealth(bool),
    Enabled(bool),
    Save,
    Test(String),
    Discover(String),
    ToggleEnabled(String),
    AskDelete(String),
    CancelDelete,
    ConfirmDelete,
}

impl State {
    fn provider(&self, id: &str) -> Option<&Provider> {
        self.providers.iter().find(|item| item.id == id)
    }

    /// `disabled={!provider.enabled || !protocolAvailable || testing}`.
    pub fn can_test(&self, id: &str) -> bool {
        self.provider(id)
            .map(|provider| {
                provider.enabled
                    && provider.protocol.adapter_available()
                    && self.testing.as_deref() != Some(id)
            })
            .unwrap_or(false)
    }

    pub fn can_discover(&self, id: &str) -> bool {
        self.provider(id)
            .map(|provider| {
                provider.enabled
                    && provider.protocol.adapter_available()
                    && self.discovering.as_deref() != Some(id)
            })
            .unwrap_or(false)
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Edit(id) => {
                if let Some(provider) = self.provider(&id) {
                    self.form = Form::from_provider(provider);
                }
            }
            Message::CancelEdit => self.form = Form::default(),
            Message::Label(value) => self.form.label = value,
            Message::Protocol(protocol) => self.form.protocol = protocol,
            Message::BaseUrl(value) => self.form.base_url = value,
            Message::ApiKey(value) => self.form.api_key = value,
            Message::AllowPersonal(on) => self.form.privacy.allow_personal = on,
            Message::AllowSensitive(on) => self.form.privacy.allow_sensitive = on,
            Message::AllowHealth(on) => self.form.privacy.allow_health = on,
            Message::Enabled(on) => self.form.enabled = on,
            Message::Save => {
                if !self.form.can_save() {
                    return Task::none();
                }
                let base_url = {
                    let trimmed = self.form.base_url.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                };
                match self.form.editing.clone() {
                    Some(id) => {
                        if let Some(provider) = self.providers.iter_mut().find(|item| item.id == id)
                        {
                            provider.label = self.form.label.trim().to_string();
                            provider.protocol = self.form.protocol;
                            provider.base_url = base_url;
                            provider.privacy = self.form.privacy;
                            provider.enabled = self.form.enabled;
                        }
                        self.notice = Some("Provider updated.".into());
                    }
                    None => {
                        self.next_id += 1;
                        self.providers.push(Provider {
                            id: format!("{}-{}", self.form.protocol.wire(), self.next_id),
                            label: self.form.label.trim().to_string(),
                            protocol: self.form.protocol,
                            base_url,
                            privacy: self.form.privacy,
                            enabled: self.form.enabled,
                        });
                        self.notice = Some("Provider saved.".into());
                    }
                }
                // The key never outlives the submit, exactly as in the TSX.
                self.form = Form::default();
                self.error = None;
            }
            Message::Test(id) => {
                if self.can_test(&id) {
                    self.notice = Some(format!("Connection to {id} reachable."));
                } else {
                    self.error = Some("This protocol adapter arrives later in Phase 2".to_string());
                }
            }
            Message::Discover(id) => {
                if self.can_discover(&id) {
                    self.notice = Some(format!("Catalog refreshed for {id}."));
                } else {
                    self.error = Some("This protocol adapter arrives later in Phase 2".to_string());
                }
            }
            Message::ToggleEnabled(id) => {
                if let Some(provider) = self.providers.iter_mut().find(|item| item.id == id) {
                    provider.enabled = !provider.enabled;
                }
            }
            Message::AskDelete(id) => self.deleting = Some(id),
            Message::CancelDelete => self.deleting = None,
            Message::ConfirmDelete => {
                if let Some(id) = self.deleting.take() {
                    self.providers.retain(|item| item.id != id);
                    self.models.retain(|model| model.provider_id != id);
                    if self.form.editing.as_deref() == Some(id.as_str()) {
                        self.form = Form::default();
                    }
                    self.notice = Some("Provider deleted.".into());
                }
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let header = row![
            column![
                eyebrow("Settings"),
                h1("Models & Providers"),
                lede("Connect providers and manage discovered models."),
            ]
            .spacing(6),
            Space::new().width(Fill),
            container(pill("macOS Keychain")).center_y(Fill),
        ]
        .align_y(iced::Alignment::Center);

        let mut items: Vec<Element<'_, Message>> = vec![header.into()];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        if let Some(notice) = &self.notice {
            items.push(success_banner(notice.clone()));
        }
        items.push(row![self.list(), self.form_view()].spacing(16).into());
        if let Some(id) = &self.deleting {
            items.push(self.confirm_delete(id));
        }
        page(stack_16(items))
    }

    /// `.providerList`.
    fn list(&self) -> Element<'_, Message> {
        let mut rows: Vec<Element<'_, Message>> = vec![row![
            h2("Providers"),
            Space::new().width(Fill),
            pill(self.providers.len().to_string()),
        ]
        .align_y(iced::Alignment::Center)
        .into()];
        if self.providers.is_empty() {
            rows.push(empty_state(
                "No providers yet. Add the first secure connection.",
            ));
        }
        for provider in &self.providers {
            rows.push(self.provider_card(provider));
        }
        container(column(rows).spacing(12)).width(Fill).into()
    }

    /// `.providerCard`.
    fn provider_card<'a>(&'a self, provider: &'a Provider) -> Element<'a, Message> {
        let id = provider.id.clone();
        let available = provider.protocol.adapter_available();
        let identity = row![
            container(Space::new().width(9).height(9)).style(move |_| {
                container::Style {
                    background: Some(if provider.enabled { ACCENT } else { TEXT_3 }.into()),
                    border: iced::Border {
                        radius: iced::border::Radius::new(99.0),
                        ..iced::Border::default()
                    },
                    ..container::Style::default()
                }
            }),
            column![
                h3(provider.label.clone()),
                dim(format!("{} · Credential stored", provider.protocol.wire())),
            ]
            .spacing(2),
        ]
        .spacing(10)
        .align_y(iced::Alignment::Center);

        let actions = row![
            text_button("Edit", Some(Message::Edit(id.clone()))),
            text_button(
                if self.testing.as_deref() == Some(id.as_str()) {
                    "Testing…"
                } else {
                    "Test"
                },
                (provider.enabled && available).then(|| Message::Test(id.clone())),
            ),
            text_button(
                if self.discovering.as_deref() == Some(id.as_str()) {
                    "Discovering…"
                } else {
                    "Discover models"
                },
                (provider.enabled && available).then(|| Message::Discover(id.clone())),
            ),
            text_button(
                if provider.enabled {
                    "Disable"
                } else {
                    "Enable"
                },
                Some(Message::ToggleEnabled(id.clone())),
            ),
            delete_link(id.clone()),
        ]
        .spacing(8);

        let models: Vec<&Model> = self
            .models
            .iter()
            .filter(|model| model.provider_id == provider.id)
            .collect();
        let mut cell: Vec<Element<'a, Message>> = vec![identity.into(), actions.into()];
        if !models.is_empty() {
            let count = models.len();
            let plural = if count == 1 { "" } else { "s" };
            cell.push(dim(format!("Last discovered · {count} model{plural}")));
            for model in models.iter().take(5) {
                cell.push(capability_row(&model.reference));
            }
            if count > 5 {
                cell.push(dim(format!("+{} more", count - 5)));
            }
        }
        card(column(cell).spacing(10))
    }

    /// `.providerForm`.
    fn form_view(&self) -> Element<'_, Message> {
        let editing = self.form.editing.is_some();
        let key_label = if editing {
            "New API key (optional)"
        } else {
            "API key"
        };
        let key_placeholder = if editing {
            "Leave blank to keep current key"
        } else if self.form.protocol == Protocol::Ollama {
            "Optional for local Ollama"
        } else {
            "Stored in macOS Keychain"
        };
        let key_hint = if self.form.protocol == Protocol::Ollama {
            "Leave blank for local Ollama. Remote tokens are stored in macOS Keychain."
        } else {
            "This value is sent directly to secure storage and is never shown again."
        };
        let heading = row![
            column![
                eyebrow(if editing {
                    "Edit connection"
                } else {
                    "New connection"
                }),
                h2(if editing {
                    self.form.label.clone()
                } else {
                    "Add provider".to_string()
                }),
            ]
            .spacing(4),
            Space::new().width(Fill),
            if editing {
                text_button("Cancel", Some(Message::CancelEdit))
            } else {
                Space::new().into()
            },
        ]
        .align_y(iced::Alignment::Center);

        let test_target = self
            .form
            .editing
            .clone()
            .filter(|id| !self.busy && self.can_test(id));

        card(
            column![
                heading,
                field("Name"),
                text_input("", &self.form.label)
                    .on_input(Message::Label)
                    .padding(10),
                field("Protocol"),
                pick_list(
                    Protocol::ALL.as_slice(),
                    Some(self.form.protocol),
                    Message::Protocol
                )
                .width(Fill),
                field("Base URL"),
                text_input("https://api.example.com/v1", &self.form.base_url)
                    .on_input(Message::BaseUrl)
                    .padding(10),
                field(key_label),
                text_input(key_placeholder, &self.form.api_key)
                    .secure(true)
                    .on_input(Message::ApiKey)
                    .padding(10),
                dim(key_hint),
                field("Data allowed for this provider"),
                checkbox(self.form.privacy.allow_personal)
                    .label("Personal data")
                    .on_toggle(Message::AllowPersonal)
                    .size(16),
                checkbox(self.form.privacy.allow_sensitive)
                    .label("Sensitive data")
                    .on_toggle(Message::AllowSensitive)
                    .size(16),
                checkbox(self.form.privacy.allow_health)
                    .label("Health data")
                    .on_toggle(Message::AllowHealth)
                    .size(16),
                checkbox(self.form.enabled)
                    .label("Provider enabled")
                    .on_toggle(Message::Enabled)
                    .size(16),
                row![
                    secondary_button(
                        if self.testing.is_some() {
                            "Testing…"
                        } else {
                            "Test saved connection"
                        },
                        test_target.map(Message::Test),
                    ),
                    Space::new().width(Fill),
                    primary_button(
                        if self.busy {
                            "Saving…"
                        } else if editing {
                            "Save changes"
                        } else {
                            "Save provider"
                        },
                        (self.form.can_save() && !self.busy).then_some(Message::Save),
                    ),
                ]
                .spacing(10),
            ]
            .spacing(10),
        )
    }

    /// `.confirmDialog`.
    fn confirm_delete<'a>(&'a self, id: &'a str) -> Element<'a, Message> {
        let label = self
            .provider(id)
            .map(|provider| provider.label.clone())
            .unwrap_or_else(|| id.to_string());
        card(
            column![
                eyebrow("Permanent action"),
                h2(format!("Delete {label}?")),
                body("This removes its local configuration and credential from macOS Keychain."),
                row![
                    Space::new().width(Fill),
                    secondary_button("Cancel", Some(Message::CancelDelete)),
                    danger_button("Delete provider", Some(Message::ConfirmDelete)),
                ]
                .spacing(10),
            ]
            .spacing(10),
        )
    }
}

/// `.formGrid label > span`.
fn field<'a>(value: &'a str) -> Element<'a, Message> {
    container(iced::widget::text(value).size(12.0).color(TEXT_2)).into()
}

/// `.dangerText`.
fn delete_link(id: String) -> Element<'static, Message> {
    iced::widget::button(iced::widget::text("Delete").size(12.0).color(DANGER))
        .padding([6, 10])
        .on_press(Message::AskDelete(id))
        .style(|_, status| {
            let hover = matches!(status, iced::widget::button::Status::Hovered);
            iced::widget::button::Style {
                background: Some(
                    if hover {
                        crate::tokens::DANGER_DIM
                    } else {
                        crate::tokens::rgba(0, 0, 0, 0.0)
                    }
                    .into(),
                ),
                text_color: DANGER,
                border: iced::Border {
                    color: crate::tokens::rgba(255, 143, 115, 0.25),
                    width: 1.0,
                    radius: iced::border::Radius::new(crate::tokens::RADIUS_S),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `model-capability-editor.tsx`, read-only row. Overrides are a Phase 2
/// mutation with no fixture on this surface, so the row reports the discovered
/// model and does not offer an unbacked editor.
fn capability_row(reference: &str) -> Element<'_, Message> {
    row![
        iced::widget::text(reference).size(12.0).color(TEXT),
        Space::new().width(Fill),
        pill("discovered"),
    ]
    .spacing(8)
    .align_y(iced::Alignment::Center)
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_provider_requires_a_key_unless_ollama() {
        let mut form = Form {
            label: "OpenAI".into(),
            ..Form::default()
        };
        assert!(!form.can_save(), "openai without a key must not save");
        form.protocol = Protocol::Ollama;
        assert!(form.can_save(), "ollama may save without a key");
        form.protocol = Protocol::OpenAi;
        form.api_key = "sk-test".into();
        assert!(form.can_save());
    }

    #[test]
    fn label_bounds_are_enforced() {
        let mut form = Form {
            api_key: "sk-test".into(),
            label: "   ".into(),
            ..Form::default()
        };
        assert!(!form.can_save(), "blank label");
        form.label = "a".repeat(LABEL_MAX + 1);
        assert!(!form.can_save(), "label over 100 chars");
        form.label = "a".repeat(LABEL_MAX);
        assert!(form.can_save());
    }

    #[test]
    fn api_key_never_survives_save() {
        let mut state = State::default();
        let _ = state.update(Message::Label("New".into()));
        let _ = state.update(Message::ApiKey("sk-secret".into()));
        assert!(state.form.can_save());
        let _ = state.update(Message::Save);
        assert!(state.form.api_key.is_empty(), "key must be cleared");
        assert!(state.form.label.is_empty(), "form must reset");
        assert_eq!(state.providers.len(), 3);
    }

    #[test]
    fn test_and_discover_gate_on_enabled_and_adapter() {
        let mut state = State::default();
        assert!(state.can_test("openai-1"), "enabled openai is testable");
        assert!(!state.can_test("ollama-1"), "disabled provider is not");
        let _ = state.update(Message::ToggleEnabled("ollama-1".into()));
        assert!(state.can_test("ollama-1"), "ollama adapter exists");
        let form = Form {
            protocol: Protocol::LiteLlm,
            ..Form::default()
        };
        assert!(!form.protocol.adapter_available(), "litellm is Phase 2");
    }

    #[test]
    fn delete_removes_provider_and_its_models() {
        let mut state = State::default();
        let _ = state.update(Message::AskDelete("openai-1".into()));
        assert!(state.deleting.is_some());
        let _ = state.update(Message::ConfirmDelete);
        assert!(state.provider("openai-1").is_none());
        assert!(state
            .models
            .iter()
            .all(|model| model.provider_id != "openai-1"));
    }
}
