use helm_db::{
    migrations, open_database_unchecked, run_migrations, KnowledgeChunkWrite,
    KnowledgeDocumentWrite, KnowledgeRepository, KnowledgeVaultWrite,
};
use helm_shared::{create_correlation_id, utc_now};

fn id() -> String {
    create_correlation_id().to_string()
}

fn document(relative_path: &str, text: &str) -> KnowledgeDocumentWrite {
    let now = utc_now();
    KnowledgeDocumentWrite {
        id: id(),
        relative_path: relative_path.into(),
        title: "Architecture Decision".into(),
        content_hash: format!("hash-{text}"),
        modified_at_ms: 1.0,
        size_bytes: text.len() as i64,
        frontmatter_json: "{}".into(),
        tags_json: "[]".into(),
        created_at: now.clone(),
        updated_at: now,
        chunks: vec![KnowledgeChunkWrite {
            id: id(),
            ordinal: 0,
            heading: Some("Decision".into()),
            line_start: 3,
            line_end: 4,
            text: text.into(),
            content_hash: format!("chunk-{text}"),
        }],
        links: vec![],
        entities: vec![],
    }
}

#[test]
fn indexes_searches_incrementally_updates_and_removes_vault_sources() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let repository = KnowledgeRepository::new(&database);
    let vault_id = id();
    let now = utc_now();
    repository.create_vault(&KnowledgeVaultWrite {
        id: vault_id.clone(),
        root_path: "/fixture/vault".into(),
        name: "Fixture".into(),
        created_at: now.clone(),
        updated_at: now,
    });
    let first = document("Decision.md", "Architecture B enables offline operation.");
    repository.sync_vault(&vault_id, &[first], &utc_now());
    let vaults = repository.list_vaults();
    assert_eq!(vaults[0].id, vault_id);
    assert_eq!(vaults[0].note_count, 1);
    let hits = repository.search(&vault_id, "\"architecture\"*", 5);
    assert_eq!(hits[0].relative_path, "Decision.md");
    assert_eq!(hits[0].heading.as_deref(), Some("Decision"));
    assert_eq!(hits[0].line_start, 3);
    assert_eq!(hits[0].line_end, 4);
    let stable_chunk_id = hits[0].chunk_id.clone();
    let stable_source_id = repository.list_sources(&vault_id)[0].id.clone();
    repository.sync_vault(
        &vault_id,
        &[document(
            "Decision.md",
            "Architecture B enables offline operation.",
        )],
        &utc_now(),
    );
    assert_eq!(
        repository.search(&vault_id, "\"architecture\"*", 5)[0].chunk_id,
        stable_chunk_id
    );
    repository.sync_vault(
        &vault_id,
        &[document(
            "Decision.md",
            "Architecture C replaced the old design.",
        )],
        &utc_now(),
    );
    assert_eq!(repository.list_sources(&vault_id)[0].id, stable_source_id);
    assert!(repository.search(&vault_id, "\"offline\"*", 5).is_empty());
    assert_eq!(repository.search(&vault_id, "\"replaced\"*", 5).len(), 1);
    repository.sync_vault(&vault_id, &[], &utc_now());
    assert_eq!(repository.list_vaults()[0].note_count, 0);
    assert!(repository
        .search(&vault_id, "\"architecture\"*", 5)
        .is_empty());
}
