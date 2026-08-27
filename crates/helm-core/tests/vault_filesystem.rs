use std::fs;
use std::path::{Path, PathBuf};

use helm_core::{
    read_vault_markdown, read_vault_source, resolve_vault_root, vault_markdown_fingerprint,
};

fn temp_base(prefix: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}-{:?}",
        std::process::id(),
        unique,
        std::thread::current().id()
    ));
    fs::create_dir_all(&base).unwrap();
    base
}

fn fixture_vault() -> (PathBuf, PathBuf, PathBuf) {
    let base = temp_base("zero-vault");
    let root = base.join("My Vault");
    let outside = base.join("outside.md");
    fs::create_dir_all(root.join(".obsidian")).unwrap();
    fs::create_dir_all(root.join("Projects")).unwrap();
    fs::write(
        root.join("Projects").join("Zero.md"),
        "# Zero\nPrivate notes.",
    )
    .unwrap();
    fs::write(root.join(".obsidian").join("workspace.json"), "{}").unwrap();
    fs::write(&outside, "# Outside\nMust not be indexed.").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("escaped.md")).unwrap();
    (base, root, outside)
}

fn cleanup(base: &Path) {
    let _ = fs::remove_dir_all(base);
}

#[test]
fn requires_an_obsidian_marker_and_ignores_symlink_escapes_and_config_files() {
    let (base, root, _) = fixture_vault();
    let resolved = resolve_vault_root(root.to_str().unwrap()).unwrap();
    assert_eq!(resolved.name, "My Vault");
    let paths: Vec<_> = read_vault_markdown(root.to_str().unwrap())
        .unwrap()
        .into_iter()
        .map(|file| file.relative_path)
        .collect();
    cleanup(&base);
    assert_eq!(paths, vec!["Projects/Zero.md".to_string()]);
}

#[test]
fn denies_direct_traversal_outside_the_selected_vault() {
    let (base, root, _) = fixture_vault();
    let err = read_vault_source(root.to_str().unwrap(), "../outside.md").unwrap_err();
    cleanup(&base);
    assert!(err.message().contains("outside the vault"));
}

#[test]
fn changes_its_watch_fingerprint_when_markdown_files_change() {
    let (base, root, _) = fixture_vault();
    let before = vault_markdown_fingerprint(root.to_str().unwrap()).unwrap();
    fs::write(root.join("New.md"), "# New\nNew evidence.").unwrap();
    let after = vault_markdown_fingerprint(root.to_str().unwrap()).unwrap();
    cleanup(&base);
    assert_ne!(after, before);
}

#[test]
fn rejects_ordinary_folders_that_are_not_obsidian_vaults() {
    let base = temp_base("zero-folder");
    let err = resolve_vault_root(base.to_str().unwrap()).unwrap_err();
    cleanup(&base);
    assert!(err.message().contains("Select an Obsidian vault"));
}
