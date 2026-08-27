use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use helm_host::{
    create_editor_entry, list_editor_dir, read_editor_file, search_editor_files, write_editor_file,
};
use helm_protocol::EditorKind;
use helm_shared::ZeroErrorCode;

fn git_workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "helm-corpus-editor-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let run = |args: &[&str]| {
        assert!(Command::new("git")
            .args(args)
            .current_dir(&dir)
            .status()
            .unwrap()
            .success());
    };
    run(&["init", "-b", "main"]);
    run(&["config", "user.name", "Corpus"]);
    run(&["config", "user.email", "corpus@example.test"]);
    fs::write(dir.join("README.md"), "# corpus\n").unwrap();
    fs::create_dir(dir.join(".obsidian")).unwrap();
    run(&["add", "README.md"]);
    run(&["commit", "-m", "start"]);
    dir
}

fn root(dir: &Path) -> &str {
    dir.to_str().unwrap()
}

#[test]
fn editor_corpus_read_list_write_create_search() {
    let dir = git_workspace();
    let ws = root(&dir);

    let missing = read_editor_file(ws, dir.join("nope.txt").to_str().unwrap()).unwrap_err();
    assert_eq!(missing.code, ZeroErrorCode::ValidationFailed);
    assert_eq!(missing.message(), "The folder does not exist");

    let listed_out = list_editor_dir(ws, Some("/etc"), false).unwrap_err();
    assert_eq!(listed_out.code, ZeroErrorCode::PermissionDenied);
    assert_eq!(listed_out.message(), "Path is outside the workspace");

    let write_out = write_editor_file(ws, "/etc/passwd", "nope").unwrap_err();
    assert_eq!(write_out.code, ZeroErrorCode::PermissionDenied);
    assert_eq!(write_out.message(), "Path is outside the workspace");

    let readme = read_editor_file(ws, dir.join("README.md").to_str().unwrap()).unwrap();
    assert_eq!(readme.name, "README.md");
    assert_eq!(readme.text, "# corpus\n");

    fs::write(dir.join("bin.dat"), [0u8, 1, 2, 255]).unwrap();
    let binary = read_editor_file(ws, dir.join("bin.dat").to_str().unwrap()).unwrap();
    assert_eq!(binary.name, "bin.dat");
    assert_eq!(binary.text, "\u{0}\u{1}\u{2}\u{fffd}");

    let listed = list_editor_dir(ws, None, false).unwrap();
    let names: Vec<_> = listed.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"README.md"));
    assert!(names.contains(&"bin.dat"));
    assert!(!names.contains(&".obsidian"));

    let written =
        write_editor_file(ws, dir.join("README.md").to_str().unwrap(), "# edited\n").unwrap();
    assert_eq!(written.text, "# edited\n");

    let file =
        create_editor_entry(ws, dir.join("new.txt").to_str().unwrap(), EditorKind::File).unwrap();
    assert_eq!(file.name, "new.txt");
    assert_eq!(file.kind, EditorKind::File);

    let folder =
        create_editor_entry(ws, dir.join("sub").to_str().unwrap(), EditorKind::Dir).unwrap();
    assert_eq!(folder.name, "sub");
    assert_eq!(folder.kind, EditorKind::Dir);

    let hits = search_editor_files(ws, "readme", false).unwrap();
    assert!(hits.iter().any(|e| e.name == "README.md"));

    let _ = fs::remove_dir_all(&dir);
}
