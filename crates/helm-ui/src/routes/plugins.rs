//! `routes/plugins.tsx` (66 lines).
//!
//! The token field collects a secret. This route never stores, logs, or
//! transmits it: `Message::Save` clears the buffer and records the connection
//! locally. Keychain wiring is P3-3 (`keyring`, human review required).

use iced::widget::{column, container, row, text_input, Space};
use iced::{Element, Fill, Task};

use super::common::{
    card, dim, error_banner, eyebrow, h1, h3, lede, page, primary_button, stack_16,
};
use crate::tokens::TEXT_2;

#[derive(Clone, Debug)]
pub struct Plugin {
    pub id: String,
    pub label: String,
    pub connected: bool,
    pub account: Option<String>,
}

pub struct State {
    pub plugins: Vec<Plugin>,
    pub token: String,
    pub error: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            plugins: vec![Plugin {
                id: "github".into(),
                label: "GitHub".into(),
                connected: false,
                account: None,
            }],
            token: String::new(),
            error: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Token(String),
    Save,
}

impl State {
    /// `disabled={token.trim().length === 0}`.
    pub fn can_save(&self) -> bool {
        !self.token.trim().is_empty()
    }

    fn github(&self) -> Option<&Plugin> {
        self.plugins.iter().find(|item| item.id == "github")
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Token(value) => self.token = value,
            Message::Save => {
                if !self.can_save() {
                    return Task::none();
                }
                // The secret is dropped here. Only the connection is recorded.
                self.token.clear();
                if let Some(plugin) = self.plugins.iter_mut().find(|item| item.id == "github") {
                    plugin.connected = true;
                    plugin.account = Some("pending-keychain".into());
                }
                self.error = None;
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let mut items: Vec<Element<'_, Message>> = vec![
            eyebrow("Plugins"),
            h1("Connected services"),
            lede(
                "Keys stay in Keychain. Connecting GitHub does not enable it on every \
                 teammate. Writes still need an approval card.",
            ),
        ];
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        items.push(self.github_card());
        page(stack_16(items))
    }

    fn github_card(&self) -> Element<'_, Message> {
        let status = match self.github() {
            Some(plugin) if plugin.connected => match &plugin.account {
                Some(account) => format!("Connected as {account}"),
                None => "Connected".to_string(),
            },
            _ => "Not connected".to_string(),
        };
        card(
            column![
                h3("GitHub"),
                dim(status),
                label("Personal access token"),
                text_input("ghp_…", &self.token)
                    .secure(true)
                    .on_input(Message::Token)
                    .on_submit(Message::Save)
                    .padding(10),
                row![
                    Space::new().width(Fill),
                    primary_button("Save in Keychain", self.can_save().then_some(Message::Save)),
                ],
            ]
            .spacing(10),
        )
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
    fn save_needs_a_non_blank_token() {
        let mut state = State::default();
        assert!(!state.can_save());
        let _ = state.update(Message::Token("   ".into()));
        assert!(!state.can_save());
        let _ = state.update(Message::Token("ghp_example".into()));
        assert!(state.can_save());
    }

    #[test]
    fn saving_clears_the_secret_from_state() {
        let mut state = State::default();
        let _ = state.update(Message::Token("ghp_example".into()));
        let _ = state.update(Message::Save);
        assert!(state.token.is_empty(), "token buffer must not be retained");
        assert!(state.github().unwrap().connected);
        assert!(!state.can_save());
    }
}
