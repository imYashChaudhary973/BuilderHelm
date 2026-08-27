//! App chrome. Compare to Electron Space / Swarm topbar + rail.
//!
//! `cargo run -p helm-ui --example shell`

use helm_ui::{helm_theme, window_settings, Shell};
use iced::Theme;

fn theme(_shell: &Shell) -> Theme {
    helm_theme()
}

fn main() -> iced::Result {
    iced::application(Shell::new, Shell::update, Shell::view)
        .theme(theme)
        .subscription(Shell::subscription)
        .title("BuilderHelm")
        .window(window_settings())
        .run()
}
