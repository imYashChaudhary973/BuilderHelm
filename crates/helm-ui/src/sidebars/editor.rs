//! `editor-sidebar.tsx` (542 lines).
//!
//! Substitutions, all recorded:
//! - the tree is local seeded state (`editor.list` is host-side); expand,
//!   collapse, search, and create are fully functional against it
//! - autosave saves on edit instead of the 700 ms debounce — no timer in this
//!   widget contract; the flag and its effect are preserved
//! - word wrap is kept as a preference; iced `text_editor` always wraps
//! - ⌘S / ⌘⇧S shortcuts are host-level, not sidebar state

use std::collections::BTreeSet;

use iced::widget::{checkbox, column, container, row, scrollable, text, text_editor, text_input};
use iced::{Element, Fill, Task};

use crate::routes::common::{error_banner, text_button};
use crate::tokens::{ACCENT, ACCENT_DIM, ACCENT_LINE, BG_1, LINE, TEXT, TEXT_2, TEXT_3};

/// `editorTreeHead` icon row glyphs.
pub const TREE_W: f32 = 148.0;
pub const RAIL_W: f32 = 32.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Dir,
    File,
}

/// `EditorEntry`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: Kind,
}

/// One open document: `file.text` vs the live draft.
pub struct Doc {
    pub path: String,
    pub name: String,
    saved: String,
    pub draft: text_editor::Content,
}

impl Doc {
    pub fn new(path: String, name: String, body: &str) -> Self {
        Self {
            saved: body.to_string(),
            draft: text_editor::Content::with_text(body),
            path,
            name,
        }
    }

    /// `doc.draft !== doc.file.text`.
    pub fn dirty(&self) -> bool {
        self.draft.text() != self.saved
    }

    fn save(&mut self) {
        self.saved = self.draft.text();
    }
}

/// `folderName`.
pub fn folder_name(path: &str) -> &str {
    path.split('/')
        .rfind(|part| !part.is_empty())
        .unwrap_or(path)
}

/// `joinPath`.
pub fn join_path(root: &str, name: &str) -> String {
    format!("{}/{}", root.trim_end_matches('/'), name)
}

pub struct State {
    pub root: String,
    pub entries: Vec<Entry>,
    pub expanded: BTreeSet<String>,
    pub active_path: Option<String>,
    pub docs: Vec<Doc>,
    pub hidden: bool,
    pub query: String,
    pub creating: Option<Kind>,
    pub new_name: String,
    pub autosave: bool,
    pub wrap: bool,
    pub tree_open: bool,
    pub error: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            root: "/Users/helm/code/builderhelm".into(),
            entries: seed_entries(),
            expanded: BTreeSet::from(["/Users/helm/code/builderhelm/crates".into()]),
            active_path: None,
            docs: vec![Doc::new(
                "/Users/helm/code/builderhelm/crates/helm-ui/src/lib.rs".into(),
                "lib.rs".into(),
                "mod sidebars;\npub mod sidebars;\n",
            )],
            hidden: false,
            query: String::new(),
            creating: None,
            new_name: String::new(),
            autosave: true,
            wrap: true,
            tree_open: true,
            error: None,
        }
    }
}

fn seed_entries() -> Vec<Entry> {
    let root = "/Users/helm/code/builderhelm";
    let e = |path: &str, kind: Kind| Entry {
        path: path.into(),
        name: folder_name(path).into(),
        kind,
    };
    vec![
        e(&format!("{root}/.gitignore"), Kind::File),
        e(&format!("{root}/Cargo.toml"), Kind::File),
        e(&format!("{root}/README.md"), Kind::File),
        e(&format!("{root}/crates"), Kind::Dir),
        e(&format!("{root}/crates/helm-ui"), Kind::Dir),
        e(&format!("{root}/crates/helm-ui/Cargo.toml"), Kind::File),
        e(&format!("{root}/crates/helm-ui/src"), Kind::Dir),
        e(&format!("{root}/crates/helm-ui/src/lib.rs"), Kind::File),
        e(&format!("{root}/crates/helm-ui/src/shell.rs"), Kind::File),
        e(
            &format!("{root}/crates/helm-ui/src/terminal.rs"),
            Kind::File,
        ),
        e(&format!("{root}/apps"), Kind::Dir),
        e(&format!("{root}/apps/desktop"), Kind::Dir),
        e(&format!("{root}/apps/desktop/main.ts"), Kind::File),
    ]
}

#[derive(Clone, Debug)]
pub enum Message {
    ToggleTree,
    ToggleHidden,
    Refresh,
    Search(String),
    StartCreate(Kind),
    NewName(String),
    Create,
    CancelCreate,
    ToggleNode(String),
    Open(String),
    Activate(String),
    EditActive(text_editor::Action),
    SaveActive,
    SaveOne(String),
    SaveAll,
    ToggleAutosave(bool),
    ToggleWrap(bool),
}

impl State {
    pub fn active_index(&self) -> Option<usize> {
        self.docs
            .iter()
            .position(|doc| Some(doc.path.as_str()) == self.active_path.as_deref())
    }

    pub fn dirty_count(&self) -> usize {
        self.docs.iter().filter(|doc| doc.dirty()).count()
    }

    /// Entries of `parent`'s direct children, honouring the hidden flag.
    fn children(&self, parent: &str) -> Vec<&Entry> {
        let prefix = format!("{parent}/");
        self.entries
            .iter()
            .filter(|entry| {
                entry.path.starts_with(&prefix)
                    && !entry.path[prefix.len()..].contains('/')
                    && (self.hidden || !entry.name.starts_with('.'))
                    && entry.path != parent
            })
            .collect()
    }

    /// Search hits: local stand-in for `editor.search` (180 ms debounce is an
    /// IPC artefact).
    fn hits(&self) -> Vec<&Entry> {
        let needle = self.query.trim().to_lowercase();
        if needle.is_empty() {
            return vec![];
        }
        self.entries
            .iter()
            .filter(|entry| entry.kind == Kind::File && entry.name.to_lowercase().contains(&needle))
            .collect()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::ToggleTree => self.tree_open = !self.tree_open,
            Message::ToggleHidden => self.hidden = !self.hidden,
            Message::Refresh => self.expanded.clear(),
            Message::Search(value) => self.query = value,
            Message::StartCreate(kind) => {
                self.creating = Some(kind);
                self.new_name.clear();
            }
            Message::NewName(value) => self.new_name = value,
            Message::Create => {
                let name = self.new_name.trim();
                if name.is_empty() {
                    return Task::none();
                }
                let Some(kind) = self.creating else {
                    return Task::none();
                };
                let path = join_path(&self.root, name);
                if self.entries.iter().any(|entry| entry.path == path) {
                    self.error = Some("Already exists".into());
                    return Task::none();
                }
                self.entries.push(Entry {
                    path: path.clone(),
                    name: folder_name(&path).into(),
                    kind,
                });
                self.creating = None;
                self.new_name.clear();
                self.error = None;
                if kind == Kind::File {
                    return self.update(Message::Open(path));
                }
            }
            Message::CancelCreate => {
                self.creating = None;
                self.new_name.clear();
            }
            Message::ToggleNode(path) => {
                if self.expanded.contains(&path) {
                    self.expanded.remove(&path);
                } else {
                    self.expanded.insert(path);
                }
            }
            Message::Open(path) => {
                if self.docs.iter().any(|doc| doc.path == path) {
                    self.active_path = Some(path);
                    return Task::none();
                }
                let name = folder_name(&path).to_string();
                self.docs.push(Doc::new(path.clone(), name, ""));
                self.active_path = Some(path);
                self.error = None;
            }
            Message::Activate(path) => self.active_path = Some(path),
            Message::EditActive(action) => {
                let autosave = self.autosave;
                let active = self.active_path.clone();
                if let Some(index) = self.active_index() {
                    self.docs[index].draft.perform(action);
                    if autosave {
                        if let Some(path) = active {
                            return self.update(Message::SaveOne(path));
                        }
                    }
                }
            }
            Message::SaveActive => {
                if let Some(path) = self.active_path.clone() {
                    return self.update(Message::SaveOne(path));
                }
            }
            Message::SaveAll => {
                for doc in &mut self.docs {
                    doc.save();
                }
                self.error = None;
            }
            Message::ToggleAutosave(on) => self.autosave = on,
            Message::ToggleWrap(on) => self.wrap = on,
            Message::SaveOne(path) => {
                if let Some(doc) = self.docs.iter_mut().find(|doc| doc.path == path) {
                    if doc.dirty() {
                        doc.save();
                    }
                }
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        let mut cols: Vec<Element<'_, Message>> = vec![self.rail()];
        if self.tree_open {
            cols.push(self.tree_col());
        }
        cols.push(self.main());
        row(cols).width(Fill).height(Fill).into()
    }

    fn rail(&self) -> Element<'_, Message> {
        container(
            iced::widget::button(
                text(if self.tree_open { "◂" } else { "▸" })
                    .size(12.0)
                    .color(TEXT_2),
            )
            .padding(6)
            .on_press(Message::ToggleTree),
        )
        .width(RAIL_W)
        .height(Fill)
        .center_y(Fill)
        .style(|_| container::Style {
            background: Some(BG_1.into()),
            border: iced::Border {
                color: LINE,
                width: 1.0,
                radius: iced::border::Radius::new(0.0),
            },
            ..container::Style::default()
        })
        .into()
    }

    fn tree_col(&self) -> Element<'_, Message> {
        let head = row![
            text(folder_name(&self.root)).size(12.0).color(TEXT),
            iced::widget::Space::new().width(Fill),
            tiny("＋", Some(Message::StartCreate(Kind::File))),
            tiny("⊞", Some(Message::StartCreate(Kind::Dir))),
            tiny("↻", Some(Message::Refresh)),
            tiny(
                if self.hidden { "●" } else { "◌" },
                Some(Message::ToggleHidden),
            ),
        ]
        .spacing(4)
        .align_y(iced::Alignment::Center);

        let mut cell: Vec<Element<'_, Message>> = vec![
            head.into(),
            text_input("Search files…", &self.query)
                .on_input(Message::Search)
                .padding(6)
                .into(),
        ];
        if self.creating.is_some() {
            let create_row: Element<'_, Message> = row![
                text_input(
                    if self.creating == Some(Kind::Dir) {
                        "folder name"
                    } else {
                        "file name"
                    },
                    &self.new_name,
                )
                .on_input(Message::NewName)
                .on_submit(Message::Create)
                .padding(6),
                tiny("✓", Some(Message::Create)),
                tiny("×", Some(Message::CancelCreate)),
            ]
            .spacing(4)
            .into();
            cell.push(create_row);
        }
        let list: Element<'_, Message> = if !self.query.trim().is_empty() {
            column(self.hits().iter().map(|entry| node(entry, None, self))).into()
        } else {
            self.dir_list(&self.root.clone(), 0)
        };
        cell.push(scrollable(list).height(Fill).into());

        container(column(cell).spacing(6))
            .width(TREE_W)
            .height(Fill)
            .padding(8)
            .style(|_| container::Style {
                background: Some(BG_1.into()),
                border: iced::Border {
                    color: LINE,
                    width: 1.0,
                    radius: iced::border::Radius::new(0.0),
                },
                ..container::Style::default()
            })
            .into()
    }

    /// `DirList` — recursive, depth-indented.
    fn dir_list(&self, parent: &str, depth: usize) -> Element<'_, Message> {
        let children = self.children(parent);
        if children.is_empty() {
            return column([]).into();
        }
        let rows: Vec<Element<'_, Message>> = children
            .iter()
            .map(|entry| {
                let expanded = self.expanded.contains(&entry.path);
                let mut items: Vec<Element<'_, Message>> = vec![node(entry, Some(depth), self)];
                if entry.kind == Kind::Dir && expanded {
                    items.push(self.dir_list(&entry.path, depth + 1));
                }
                column(items).into()
            })
            .collect();
        column(rows).spacing(1).into()
    }

    fn main(&self) -> Element<'_, Message> {
        let tabs: Element<'_, Message> = if self.docs.is_empty() {
            text("Pick a file from the tree.")
                .size(11.0)
                .color(TEXT_3)
                .into()
        } else {
            row(self.docs.iter().map(|doc| {
                let path = doc.path.clone();
                let on = self.active_path.as_deref() == Some(doc.path.as_str());
                iced::widget::button(
                    text(format!(
                        "{}{}",
                        doc.name,
                        if doc.dirty() { " ·" } else { "" }
                    ))
                    .size(11.0)
                    .color(if on { ACCENT } else { TEXT_2 }),
                )
                .padding([4, 8])
                .on_press(Message::Activate(path))
                .style(move |_, status| {
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
                })
                .into()
            }))
            .spacing(4)
            .into()
        };

        let status = match self.active_index() {
            None => "No file",
            Some(i) if self.docs[i].dirty() => "Unsaved",
            Some(_) => "Saved",
        };
        let toolbar = row![
            text_button(
                "Save",
                self.active_path.is_some().then_some(Message::SaveActive)
            ),
            text_button(
                "Save all",
                (self.dirty_count() > 0).then_some(Message::SaveAll),
            ),
            checkbox(self.autosave)
                .label("Autosave")
                .on_toggle(Message::ToggleAutosave)
                .size(14),
            checkbox(self.wrap)
                .label("Wrap")
                .on_toggle(Message::ToggleWrap)
                .size(14),
            iced::widget::Space::new().width(Fill),
            text(status).size(11.0).color(TEXT_3),
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center);

        let toolbar: Element<'_, Message> = toolbar.into();
        let mut cell: Vec<Element<'_, Message>> = vec![tabs, toolbar];
        if let Some(error) = &self.error {
            cell.push(error_banner(error.clone()));
        }
        match self.active_index() {
            None => cell.push(
                text("Select a file from the tree to open it here.")
                    .size(12.0)
                    .color(TEXT_3)
                    .into(),
            ),
            Some(index) => {
                let doc = &self.docs[index];
                let gutter: Element<'_, Message> = text(
                    (1..=doc.draft.lines().count())
                        .map(|n| n.to_string())
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
                .size(11.0)
                .color(TEXT_3)
                .into();
                let pane: Element<'_, Message> = row![
                    container(gutter).padding([8, 6]),
                    text_editor(&doc.draft)
                        .on_action(Message::EditActive)
                        .padding(8),
                ]
                .spacing(4)
                .height(Fill)
                .into();
                cell.push(pane);
            }
        }
        container(column(cell).spacing(6))
            .width(Fill)
            .height(Fill)
            .padding(8)
            .into()
    }
}

/// `editorNode` row.
fn node<'a>(entry: &'a Entry, depth: Option<usize>, state: &'a State) -> Element<'a, Message> {
    let expanded = state.expanded.contains(&entry.path);
    let on = state.active_path.as_deref() == Some(entry.path.as_str());
    let caret = if entry.kind == Kind::Dir {
        if expanded {
            "▾"
        } else {
            "▸"
        }
    } else {
        ""
    };
    let msg = if entry.kind == Kind::Dir {
        Message::ToggleNode(entry.path.clone())
    } else {
        Message::Open(entry.path.clone())
    };
    let pad = 4.0 + depth.map(|d| d as f32 * 10.0).unwrap_or(0.0);
    container(
        iced::widget::button(
            row![
                text(caret).size(10.0).color(TEXT_3),
                text(entry.name.clone())
                    .size(11.0)
                    .color(if on { ACCENT } else { TEXT_2 }),
            ]
            .spacing(4)
            .align_y(iced::Alignment::Center),
        )
        .padding([3, 6])
        .on_press(msg)
        .style(move |_, status| {
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
                    radius: iced::border::Radius::new(5.0),
                },
                shadow: iced::Shadow::default(),
                snap: true,
            }
        }),
    )
    .padding(iced::Padding {
        top: 0.0,
        right: 0.0,
        bottom: 0.0,
        left: pad,
    })
    .into()
}

/// `editorTreeActions` tiny square.
fn tiny<'a>(glyph: &'a str, msg: Option<Message>) -> Element<'a, Message> {
    iced::widget::button(text(glyph).size(11.0).color(TEXT_2))
        .padding([3, 6])
        .on_press_maybe(msg)
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
        })
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paste(text: &str) -> Message {
        Message::EditActive(text_editor::Action::Edit(text_editor::Edit::Paste(
            std::sync::Arc::new(text.to_owned()),
        )))
    }

    #[test]
    fn open_is_idempotent_and_activates() {
        let mut state = State::default();
        let lib = "/Users/helm/code/builderhelm/crates/helm-ui/src/lib.rs".to_string();
        let before = state.docs.len();
        let _ = state.update(Message::Open(lib.clone()));
        assert_eq!(state.docs.len(), before, "re-open must not duplicate");
        assert_eq!(state.active_path.as_deref(), Some(lib.as_str()));
    }

    #[test]
    fn edit_marks_dirty_and_autosave_clears_it() {
        let mut state = State::default();
        state.autosave = false;
        state.active_path = Some(state.docs[0].path.clone());
        assert!(!state.docs[0].dirty());
        let _ = state.update(paste("// draft\n"));
        assert!(state.docs[0].dirty(), "edit must mark dirty");
        let _ = state.update(Message::SaveActive);
        assert!(!state.docs[0].dirty(), "save must clear dirty");
        assert_eq!(state.dirty_count(), 0);
    }

    #[test]
    fn autosave_saves_on_edit_without_manual_save() {
        let mut state = State::default();
        state.autosave = true;
        state.active_path = Some(state.docs[0].path.clone());
        let _ = state.update(paste("x"));
        assert!(!state.docs[0].dirty(), "autosave saves immediately on edit");
    }

    #[test]
    fn save_all_only_exists_while_something_is_dirty() {
        let mut state = State::default();
        state.autosave = false;
        state.active_path = Some(state.docs[0].path.clone());
        assert_eq!(state.dirty_count(), 0);
        let _ = state.update(paste("a"));
        let _ = state.update(Message::Open(
            "/Users/helm/code/builderhelm/crates/helm-ui/src/shell.rs".to_string(),
        ));
        // Open a second doc and dirty it too.
        let _ = state.update(paste("b"));
        assert_eq!(state.dirty_count(), 2);
        let _ = state.update(Message::SaveAll);
        assert_eq!(state.dirty_count(), 0);
    }

    #[test]
    fn search_hits_files_only() {
        let mut state = State::default();
        let _ = state.update(Message::Search("cargo".into()));
        let hits = state.hits();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|entry| entry.kind == Kind::File));
        let _ = state.update(Message::Search("".into()));
        assert!(state.hits().is_empty());
    }

    #[test]
    fn create_needs_a_name_and_refuses_duplicates() {
        let mut state = State::default();
        let _ = state.update(Message::StartCreate(Kind::File));
        let _ = state.update(Message::NewName("  ".into()));
        let _ = state.update(Message::Create);
        assert_eq!(state.docs.len(), 1, "blank name must not create");

        let _ = state.update(Message::NewName("Cargo.toml".into()));
        let _ = state.update(Message::Create);
        assert!(state.error.is_some(), "duplicate must be refused");
        assert_eq!(state.entries.len(), seed_entries().len());

        let _ = state.update(Message::NewName("notes.md".into()));
        let _ = state.update(Message::Create);
        assert!(state.error.is_none());
        assert_eq!(state.entries.len(), seed_entries().len() + 1);
        let made = join_path(&state.root, "notes.md");
        assert_eq!(state.active_path.as_deref(), Some(made.as_str()));
    }

    #[test]
    fn hidden_flag_hides_dotfiles() {
        let state = State::default();
        assert!(
            !state
                .children(&state.root)
                .iter()
                .any(|entry| entry.name.starts_with('.')),
            "dotfiles hidden by default"
        );
    }

    #[test]
    fn tree_nodes_expand_and_collapse() {
        let mut state = State::default();
        let crates = "/Users/helm/code/builderhelm/crates".to_string();
        assert!(state.expanded.contains(&crates));
        let _ = state.update(Message::ToggleNode(crates.clone()));
        assert!(!state.expanded.contains(&crates));
        let _ = state.update(Message::ToggleNode(crates.clone()));
        assert!(state.expanded.contains(&crates));
    }
}
