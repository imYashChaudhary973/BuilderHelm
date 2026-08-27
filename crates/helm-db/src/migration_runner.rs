use helm_shared::{utc_now, ZeroError, ZeroErrorCode, ZeroErrorOptions};
use serde_json::json;

use crate::database::ZeroDatabase;

pub trait MigrationDatabase {
    fn execute(&self, sql: &str);
}

impl MigrationDatabase for ZeroDatabase {
    fn execute(&self, sql: &str) {
        ZeroDatabase::execute(self, sql);
    }
}

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: fn(&dyn MigrationDatabase),
}

pub struct MigrationResult {
    pub applied: Vec<i64>,
    pub current_version: i64,
}

fn migration_failed(message: impl Into<String>) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::MigrationFailed,
        message,
        ZeroErrorOptions::default(),
    )
}

fn validate_migrations(migrations: &[Migration]) {
    for (index, migration) in migrations.iter().enumerate() {
        let expected = i64::try_from(index + 1).expect("migration index");
        if migration.version != expected || migration.name.trim().is_empty() {
            panic!(
                "{}",
                migration_failed(format!(
                    "Migration sequence is invalid at version {}",
                    migration.version
                ))
            );
        }
    }
}

pub fn run_migrations(database: &ZeroDatabase, migrations: &[Migration]) -> MigrationResult {
    validate_migrations(migrations);
    database.execute(
        "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  ",
    );

    let existing = database.query_all(
        "SELECT version, name FROM schema_migrations ORDER BY version ASC",
        &[],
    );
    for row in &existing {
        let version = row
            .get("version")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        let name = row
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let expected = migrations.get(usize::try_from(version - 1).unwrap_or(usize::MAX));
        if expected.is_none() || expected.unwrap().name != name {
            panic!(
                "{}",
                migration_failed(format!(
                    "Applied migration {version} does not match the repository migration history"
                ))
            );
        }
    }

    let mut applied = Vec::new();
    let start = existing.len();
    for migration in &migrations[start..] {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            database.transaction(|| {
                (migration.up)(database);
                database.run(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                    &[
                        json!(migration.version),
                        json!(migration.name),
                        json!(utc_now()),
                    ],
                );
            });
        }));
        match outcome {
            Ok(()) => applied.push(migration.version),
            Err(_) => {
                panic!(
                    "{}",
                    migration_failed(format!(
                        "Failed to apply migration {}: {}",
                        migration.version, migration.name
                    ))
                );
            }
        }
    }

    MigrationResult {
        applied,
        current_version: migrations.last().map(|m| m.version).unwrap_or(0),
    }
}
