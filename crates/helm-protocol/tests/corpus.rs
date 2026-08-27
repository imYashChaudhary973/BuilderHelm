use std::fs;
use std::path::Path;

use serde_json::Value;

fn walk(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            walk(&path, files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
            files.push(path);
        }
    }
}

#[test]
fn every_corpus_fixture_round_trips_without_loss() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../conformance");
    let mut files = Vec::new();
    walk(&root, &mut files);
    assert!(!files.is_empty(), "no fixtures");
    for path in files {
        let raw = fs::read_to_string(&path).unwrap();
        let value: Value =
            serde_json::from_str(&raw).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        let again: Value = serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
        assert_eq!(value, again, "{}", path.display());
    }
}
