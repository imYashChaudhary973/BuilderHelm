//! P4-4 routes. One module per Electron route, same names.
//!
//! Contract, identical for every route module:
//!
//! ```ignore
//! pub struct State { .. }                  // Default
//! pub enum Message { .. }                  // Clone + Debug
//! impl State {
//!     pub fn update(&mut self, message: Message) -> Task<Message>;
//!     pub fn view(&self) -> Element<'_, Message>;
//! }
//! ```

pub mod actions;
pub mod board;
pub mod coming_soon;
pub mod common;
pub mod kanban;
pub mod memory;
pub mod plugins;
pub mod projects;
pub mod routines;
pub mod settings;
pub mod space;
pub mod swarm;
pub mod today;

use iced::{Element, Task};

/// Every reachable surface. `Space` is `/` and `/space`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Space,
    Swarm,
    Board,
    Memory,
    Agent,
    Code,
    Chat,
    Actions,
    Settings,
    Projects,
    Today,
    Routines,
    Plugins,
}

impl Route {
    /// Topbar segmented nav order, matching `MODES` in `App.tsx`.
    pub const NAV: [Route; 7] = [
        Route::Space,
        Route::Swarm,
        Route::Board,
        Route::Memory,
        Route::Agent,
        Route::Code,
        Route::Chat,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Route::Space => "Space",
            Route::Swarm => "Swarm",
            Route::Board => "Board",
            Route::Memory => "Memory",
            Route::Agent => "Agent",
            Route::Code => "Code",
            Route::Chat => "Chat",
            Route::Actions => "Actions",
            Route::Settings => "Settings",
            Route::Projects => "Projects",
            Route::Today => "Today",
            Route::Routines => "Routines",
            Route::Plugins => "Plugins",
        }
    }

    /// Left-rail / settings surfaces are not on the segmented nav.
    pub fn nav_index(self) -> Option<usize> {
        Route::NAV.iter().position(|route| *route == self)
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    Space(space::Message),
    Swarm(swarm::Message),
    Board(board::Message),
    Memory(memory::Message),
    Actions(actions::Message),
    Settings(settings::Message),
    Projects(projects::Message),
    Today(today::Message),
    Routines(routines::Message),
    Plugins(plugins::Message),
}

#[derive(Default)]
pub struct Routes {
    pub space: space::State,
    pub swarm: swarm::State,
    pub board: board::State,
    pub memory: memory::State,
    pub actions: actions::State,
    pub settings: settings::State,
    pub projects: projects::State,
    pub today: today::State,
    pub routines: routines::State,
    pub plugins: plugins::State,
    nav: Option<Route>,
}

impl Routes {
    /// Cross-route jump requested by the last `update`. The shell drains this.
    pub fn take_nav(&mut self) -> Option<Route> {
        self.nav.take()
    }

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Space(m) => self.space.update(m).map(Message::Space),
            Message::Swarm(m) => self.swarm.update(m).map(Message::Swarm),
            Message::Board(m) => self.board.update(m).map(Message::Board),
            Message::Memory(m) => {
                self.nav = memory::State::nav_target(&m);
                self.memory.update(m).map(Message::Memory)
            }
            Message::Actions(m) => self.actions.update(m).map(Message::Actions),
            Message::Settings(m) => self.settings.update(m).map(Message::Settings),
            Message::Projects(m) => {
                self.nav = projects::State::nav_target(&m);
                self.projects.update(m).map(Message::Projects)
            }
            Message::Today(m) => {
                self.nav = today::State::nav_target(&m);
                self.today.update(m).map(Message::Today)
            }
            Message::Routines(m) => self.routines.update(m).map(Message::Routines),
            Message::Plugins(m) => self.plugins.update(m).map(Message::Plugins),
        }
    }

    pub fn view(&self, route: Route) -> Element<'_, Message> {
        match route {
            Route::Space => self.space.view().map(Message::Space),
            Route::Swarm => self.swarm.view().map(Message::Swarm),
            Route::Board => self.board.view().map(Message::Board),
            Route::Memory => self.memory.view().map(Message::Memory),
            Route::Actions => self.actions.view().map(Message::Actions),
            Route::Settings => self.settings.view().map(Message::Settings),
            Route::Projects => self.projects.view().map(Message::Projects),
            Route::Today => self.today.view().map(Message::Today),
            Route::Routines => self.routines.view().map(Message::Routines),
            Route::Plugins => self.plugins.view().map(Message::Plugins),
            Route::Agent => coming_soon::view("agent-title"),
            Route::Code => coming_soon::view("code-title"),
            Route::Chat => coming_soon::view("chat-title"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_route_is_reachable_and_renders() {
        let routes = Routes::default();
        let all = [
            Route::Space,
            Route::Swarm,
            Route::Board,
            Route::Memory,
            Route::Agent,
            Route::Code,
            Route::Chat,
            Route::Actions,
            Route::Settings,
            Route::Projects,
            Route::Today,
            Route::Routines,
            Route::Plugins,
        ];
        assert_eq!(all.len(), 13);
        for route in all {
            let _ = routes.view(route);
            assert!(!route.title().is_empty());
        }
        assert_eq!(Route::Space.nav_index(), Some(0));
        assert_eq!(Route::Chat.nav_index(), Some(6));
        assert_eq!(Route::Settings.nav_index(), None);
    }
}
