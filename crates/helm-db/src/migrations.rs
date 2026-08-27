use crate::migration_runner::{Migration, MigrationDatabase};

fn up_0001(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0001-phase-zero.sql"));
}
fn up_0002(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0002-provider-settings.sql"));
}
fn up_0003(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0003-chat-persistence.sql"));
}
fn up_0004(database: &dyn MigrationDatabase) {
    database.execute(include_str!(
        "../migrations/0004-model-capability-overrides.sql"
    ));
}
fn up_0005(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0005-obsidian-knowledge.sql"));
}
fn up_0006(database: &dyn MigrationDatabase) {
    database.execute(include_str!(
        "../migrations/0006-tools-permissions-actions.sql"
    ));
}
fn up_0007(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0007-project-continuity.sql"));
}
fn up_0008(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0008-board-presets.sql"));
}
fn up_0009(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0009-kanban-cards.sql"));
}
fn up_0010(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0010-kanban-projects.sql"));
}
fn up_0011(database: &dyn MigrationDatabase) {
    database.execute(include_str!(
        "../migrations/0011-kanban-review-cancelled.sql"
    ));
}
fn up_0012(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0012-swarm-persistence.sql"));
}
fn up_0013(database: &dyn MigrationDatabase) {
    database.execute(include_str!("../migrations/0013-helm-platform.sql"));
}

pub fn migrations() -> [Migration; 13] {
    [
        Migration {
            version: 1,
            name: "phase-zero-foundation",
            up: up_0001,
        },
        Migration {
            version: 2,
            name: "provider-settings",
            up: up_0002,
        },
        Migration {
            version: 3,
            name: "chat-persistence",
            up: up_0003,
        },
        Migration {
            version: 4,
            name: "model-capability-overrides",
            up: up_0004,
        },
        Migration {
            version: 5,
            name: "obsidian-knowledge",
            up: up_0005,
        },
        Migration {
            version: 6,
            name: "tools-permissions-actions",
            up: up_0006,
        },
        Migration {
            version: 7,
            name: "project-continuity",
            up: up_0007,
        },
        Migration {
            version: 8,
            name: "board-presets",
            up: up_0008,
        },
        Migration {
            version: 9,
            name: "kanban-cards",
            up: up_0009,
        },
        Migration {
            version: 10,
            name: "kanban-projects",
            up: up_0010,
        },
        Migration {
            version: 11,
            name: "kanban-review-cancelled",
            up: up_0011,
        },
        Migration {
            version: 12,
            name: "swarm-persistence",
            up: up_0012,
        },
        Migration {
            version: 13,
            name: "helm-platform",
            up: up_0013,
        },
    ]
}
