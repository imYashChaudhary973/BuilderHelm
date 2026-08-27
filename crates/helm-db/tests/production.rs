use helm_db::{migrations, open_database_unchecked, run_migrations};

#[test]
fn opens_an_existing_version_13_database_and_reads_every_table() {
    let directory = std::env::temp_dir().join(format!("helm-db-prod-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("zero.sqlite");
    {
        let database = open_database_unchecked(path.to_str().unwrap());
        run_migrations(&database, &migrations());
        database.close();
    }
    let database = open_database_unchecked(path.to_str().unwrap());
    let version = database
        .query_one("SELECT MAX(version) AS version FROM schema_migrations", &[])
        .unwrap();
    assert_eq!(
        version.get("version").and_then(serde_json::Value::as_i64),
        Some(13)
    );
    let tables = database.query_all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        &[],
    );
    assert!(!tables.is_empty());
    for table in tables {
        let name = table
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap();
        database.query_all(&format!("SELECT * FROM \"{name}\" LIMIT 1"), &[]);
    }
}
