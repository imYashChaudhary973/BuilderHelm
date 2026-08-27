use std::fs;
use std::path::PathBuf;

use helm_host::{
    create_editor_entry, list_editor_dir, list_git_changes, read_editor_file, search_editor_files,
    write_editor_file,
};
use helm_protocol::EditorKind;
use helm_shared::ZeroErrorCode;

fn temp_workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "helm-editor-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn err_code<T>(result: Result<T, helm_shared::ZeroError>) -> (ZeroErrorCode, String) {
    let err = result.err().expect("expected error");
    (err.code, err.message().to_string())
}

#[test]
fn reads_utf8_text_and_rejects_files_over_1_mb() {
    let dir = temp_workspace();
    let small = dir.join("note.txt");
    fs::write(&small, "hello").unwrap();
    let file = read_editor_file(dir.to_str().unwrap(), small.to_str().unwrap()).unwrap();
    assert_eq!(file.name, "note.txt");
    assert_eq!(file.text, "hello");
    assert!(file.path.ends_with("note.txt"));

    let big = dir.join("big.txt");
    fs::write(&big, vec![0u8; 1_000_001]).unwrap();
    let (code, message) = err_code(read_editor_file(
        big.to_str().unwrap(),
        big.to_str().unwrap(),
    ));
    assert_eq!(code, ZeroErrorCode::ValidationFailed);
    assert!(message.contains("larger than 1 MB"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_dotdot_escape() {
    let dir = temp_workspace();
    fs::write(dir.join("inside.txt"), "in").unwrap();
    let outside = dir
        .parent()
        .unwrap()
        .join(format!("helm-outside-{}", std::process::id()));
    fs::write(&outside, "secret").unwrap();
    let sneak = dir.join("..").join(outside.file_name().unwrap());
    let (code, message) = err_code(read_editor_file(
        dir.to_str().unwrap(),
        sneak.to_str().unwrap(),
    ));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Path is outside the workspace");
    let _ = fs::remove_file(&outside);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_absolute_path_outside_workspace() {
    let dir = temp_workspace();
    let (code, message) = err_code(list_editor_dir(dir.to_str().unwrap(), Some("/etc"), false));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Path is outside the workspace");
    let (code, message) = err_code(write_editor_file(
        dir.to_str().unwrap(),
        "/etc/passwd",
        "nope",
    ));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Path is outside the workspace");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_windows_separator_escape() {
    let dir = temp_workspace();
    let sneak = format!("{}\\..\\..\\etc\\passwd", dir.display());
    let err = read_editor_file(dir.to_str().unwrap(), &sneak).expect_err("must not follow \\");
    assert_ne!(err.code, ZeroErrorCode::InternalError);
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn rejects_symlink_pointing_outside() {
    let dir = temp_workspace();
    let link = dir.join("escape");
    std::os::unix::fs::symlink("/etc/passwd", &link).unwrap();
    let (code, message) = err_code(read_editor_file(
        dir.to_str().unwrap(),
        link.to_str().unwrap(),
    ));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Path is outside the workspace");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_home_and_system_roots() {
    let (code, message) = err_code(list_editor_dir("/", None, false));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Pick a project folder, not your home directory");
    if let Ok(home) = std::env::var("HOME") {
        let (code, _) = err_code(list_editor_dir(&home, None, false));
        assert_eq!(code, ZeroErrorCode::PermissionDenied);
    }
}

#[test]
fn missing_file_is_folder_does_not_exist() {
    let dir = temp_workspace();
    let missing = dir.join("nope.txt");
    let (code, message) = err_code(read_editor_file(
        dir.to_str().unwrap(),
        missing.to_str().unwrap(),
    ));
    assert_eq!(code, ZeroErrorCode::ValidationFailed);
    assert_eq!(message, "The folder does not exist");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn create_rejects_traversal_and_lists_skips() {
    let dir = temp_workspace();
    fs::create_dir(dir.join(".git")).unwrap();
    fs::write(dir.join("keep.txt"), "k").unwrap();
    let listed = list_editor_dir(dir.to_str().unwrap(), None, false).unwrap();
    assert!(listed.iter().all(|e| e.name != ".git"));
    assert!(listed.iter().any(|e| e.name == "keep.txt"));

    let (code, message) = err_code(create_editor_entry(
        dir.to_str().unwrap(),
        dir.join("..").join("x.txt").to_str().unwrap(),
        EditorKind::File,
    ));
    assert_eq!(code, ZeroErrorCode::PermissionDenied);
    assert_eq!(message, "Path is outside the workspace");

    let (code, _) = err_code(create_editor_entry(
        dir.to_str().unwrap(),
        dir.join("..").to_str().unwrap(),
        EditorKind::File,
    ));
    assert_eq!(code, ZeroErrorCode::ValidationFailed);

    let made = create_editor_entry(
        dir.to_str().unwrap(),
        dir.join("new.txt").to_str().unwrap(),
        EditorKind::File,
    )
    .unwrap();
    assert_eq!(made.name, "new.txt");
    assert_eq!(made.kind, EditorKind::File);

    let found = search_editor_files(dir.to_str().unwrap(), "KEEP", false).unwrap();
    assert!(found.iter().any(|e| e.name == "keep.txt"));
    assert!(list_git_changes(dir.to_str().unwrap()).unwrap().is_empty());
    let _ = fs::remove_dir_all(&dir);
}
