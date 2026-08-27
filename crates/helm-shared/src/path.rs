//! Cross-platform path comparison (P5-1).
//!
//! Windows filesystems are case-insensitive with two separator styles, and
//! `fs::canonicalize` returns verbatim (`\\?\C:\…`, `\\?\UNC\…`) paths. Raw
//! `Path::starts_with` / `==` therefore miss escapes that differ only in case
//! or separator — unacceptable for the P3-4 workspace scoping checks.
//!
//! The normalization core is pure and case-fold-flag-parameterised so its
//! Windows semantics are unit-tested on any host; the `cfg` wrappers pick the
//! host behaviour at compile time.

use std::path::{Path, PathBuf};

/// Normalise a path string for scoping comparisons.
///
/// - strips the `\\?\` verbatim prefix (and `\\?\UNC\` → `\\`)
/// - folds `\` and `/` to a single separator
/// - ASCII-lowercases when the filesystem is case-insensitive
///
/// Long-path (`\\?\C:\very\long…`) inputs survive: only the prefix is
/// removed, the rest is kept verbatim.
pub fn normalize_for_compare(raw: &str, case_sensitive: bool) -> String {
    let mut value = raw.trim();
    let mut unc = false;
    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        unc = true;
        value = stripped;
    } else if let Some(stripped) = value.strip_prefix(r"\\?\") {
        value = stripped;
    }
    let mut out = String::with_capacity(value.len());
    if unc {
        out.push_str("//");
    }
    for ch in value.chars() {
        if ch == '\\' || ch == '/' {
            out.push('/');
        } else if case_sensitive {
            out.push(ch);
        } else {
            out.push(ch.to_ascii_lowercase());
        }
    }
    out.trim_end_matches('/').to_string()
}

/// Scope check: `target == root || target.starts_with(root)` under the chosen
/// filesystem semantics. Pure so tests can pin both semantics anywhere.
pub fn within_normalized(root: &str, target: &str, case_sensitive: bool) -> bool {
    let root = normalize_for_compare(root, case_sensitive);
    let target = normalize_for_compare(target, case_sensitive);
    if root.is_empty() {
        return false;
    }
    target == root || target.starts_with(&format!("{root}/"))
}

/// Host-semantic scope check used by the P3-4 defences.
#[cfg(windows)]
pub fn path_within(root: &Path, target: &Path) -> bool {
    within_normalized(&root.to_string_lossy(), &target.to_string_lossy(), false)
}

/// Host-semantic scope check used by the P3-4 defences.
#[cfg(not(windows))]
pub fn path_within(root: &Path, target: &Path) -> bool {
    within_normalized(&root.to_string_lossy(), &target.to_string_lossy(), true)
}

/// Host-semantic path equality.
#[cfg(windows)]
pub fn same_path(a: &Path, b: &Path) -> bool {
    normalize_for_compare(&a.to_string_lossy(), false)
        == normalize_for_compare(&b.to_string_lossy(), false)
}

/// Host-semantic path equality.
#[cfg(not(windows))]
pub fn same_path(a: &Path, b: &Path) -> bool {
    normalize_for_compare(&a.to_string_lossy(), true)
        == normalize_for_compare(&b.to_string_lossy(), true)
}

/// Drop the `\\?\` verbatim prefix for display and for storing paths that
/// other tools (git) will re-parse. Returns the input unchanged on
/// non-verbatim paths and on unix.
pub fn strip_verbatim(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    let stripped = raw
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| raw.strip_prefix(r"\\?\").map(str::to_string));
    match stripped {
        Some(clean) => PathBuf::from(clean),
        None => path.to_path_buf(),
    }
}

/// True when `candidate` is a workspace root the P3-4 checks must refuse:
/// filesystem root, the OS user directory, a system directory, or `$HOME`.
/// Pure: `case_sensitive` selects host semantics so the Windows list is
/// unit-testable on any host.
pub fn is_forbidden_root_normalized(
    candidate: &str,
    case_sensitive: bool,
    home: Option<&str>,
) -> bool {
    let candidate = normalize_for_compare(candidate, case_sensitive);
    if candidate.is_empty() {
        return true;
    }
    if let Some(home) = home {
        if candidate == normalize_for_compare(home, case_sensitive) {
            return true;
        }
    }
    // Filesystem root: "/", or a bare drive "c:".
    if candidate == "/" || (candidate.len() == 2 && candidate.ends_with(':')) {
        return true;
    }
    // Strip a drive prefix so "\Users" checks work on "C:/Users" and "/Users".
    let without_drive = candidate
        .strip_prefix(|c: char| c.is_ascii_alphanumeric())
        .and_then(|rest| rest.strip_prefix(':'))
        .unwrap_or(&candidate);
    // Exact-case list for sensitive (unix/mac) hosts, lowercased for
    // insensitive (Windows) hosts. A project under `C:\Users\helm\code` is
    // allowed; the check is against the shared parent directories themselves
    // and the home handled above.
    let system_dirs: &[&str] = if case_sensitive {
        &["/Users", "/System"]
    } else {
        &[
            "/users",
            "/windows",
            "/program files",
            "/program files (x86)",
        ]
    };
    system_dirs.iter().any(|dir| {
        let is_users = *dir == "/users" || *dir == "/Users";
        if is_users {
            // Under the shared Users folder only the folder itself, Public,
            // and Default profiles are forbidden; subfolders of the current
            // user's home are legitimate workspaces.
            without_drive == *dir
                || without_drive.starts_with(&format!("{dir}/")) && {
                    let rest = without_drive
                        .trim_start_matches(dir)
                        .trim_start_matches('/');
                    rest.is_empty()
                        || rest == "public"
                        || rest == "default"
                        || rest.starts_with("public/")
                        || rest.starts_with("default/")
                }
        } else {
            without_drive == *dir || without_drive.starts_with(&format!("{dir}/"))
        }
    })
}

/// Host wrapper: the macOS guard list from `resolve_workspace`, unchanged.
#[cfg(not(windows))]
pub fn is_forbidden_root(candidate: &Path, home: Option<&Path>) -> bool {
    let home_str = home.map(|h| h.to_string_lossy().into_owned());
    is_forbidden_root_normalized(&candidate.to_string_lossy(), true, home_str.as_deref())
}

/// Host wrapper: drive roots, `\Users`, `\Windows`, `\Program Files`, home.
#[cfg(windows)]
pub fn is_forbidden_root(candidate: &Path, home: Option<&Path>) -> bool {
    let home_str = home.map(|h| h.to_string_lossy().into_owned());
    is_forbidden_root_normalized(&candidate.to_string_lossy(), false, home_str.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_folding_gates_scope_on_windows_semantics() {
        // Different case must NOT escape the workspace when insensitive.
        assert!(within_normalized(
            r"C:\Work\repo",
            r"c:\WORK\REPO\src\main.rs",
            false
        ));
        assert!(within_normalized("/work/repo", "/work/repo/src", true));
        assert!(!within_normalized("/work/repo", "/Work/repo/x", true));
    }

    #[test]
    fn sibling_prefixes_never_count_as_inside() {
        // The classic `/repo` vs `/repo-evil` prefix bug.
        assert!(!within_normalized("/work/repo", "/work/repo-evil/x", true));
        assert!(!within_normalized(
            r"C:\work\repo",
            r"C:\work\repo-evil\x",
            false
        ));
        assert!(within_normalized("/work/repo", "/work/repo", true));
        assert!(within_normalized("/work/repo", "/work/repo/a/b", true));
    }

    #[test]
    fn separators_and_verbatim_prefixes_normalize() {
        assert_eq!(
            normalize_for_compare(r"C:\Work\Repo", false),
            "c:/work/repo"
        );
        assert_eq!(normalize_for_compare("C:/Work/Repo", false), "c:/work/repo");
        assert_eq!(
            normalize_for_compare(r"\\?\C:\Work\Repo", false),
            "c:/work/repo"
        );
        assert_eq!(
            normalize_for_compare(r"\\?\UNC\server\share\repo", false),
            "//server/share/repo"
        );
        // Long verbatim path keeps its tail verbatim after the prefix strip.
        let long = format!(r"\\?\C:\{}", "x".repeat(300));
        assert_eq!(
            normalize_for_compare(&long, false),
            format!("c:/{}", "x".repeat(300).to_ascii_lowercase())
        );
        // Case-sensitive hosts keep case; verbatim prefix is still stripped.
        assert_eq!(
            normalize_for_compare(r"/Users/Helm/code", true),
            "/Users/Helm/code"
        );
        assert_eq!(normalize_for_compare(r"\\?\C:\Work", true), "C:/Work");
        assert!(within_normalized(
            r"\\?\C:\work\repo",
            r"C:\WORK\REPO\a",
            false
        ));
    }

    #[test]
    fn empty_root_contains_nothing() {
        assert!(!within_normalized("", "/anything", false));
        assert!(!within_normalized("", "/anything", true));
    }

    #[test]
    fn forbidden_roots_cover_drives_users_system_and_home() {
        let home = r"C:\Users\helm";
        for candidate in [
            r"C:\",
            "c:",
            r"C:\Users",
            r"c:\users\public",
            r"C:\Windows\System32",
            r"C:\Program Files\App",
            r"C:\Program Files (x86)\App",
            home,
        ] {
            assert!(
                is_forbidden_root_normalized(candidate, false, Some(home)),
                "{candidate} must be forbidden"
            );
        }
        for candidate in [r"C:\Work\repo", r"C:\Users\helm\code"] {
            assert!(
                !is_forbidden_root_normalized(candidate, false, Some(home)),
                "{candidate} must be allowed"
            );
        }
        // Unix list: root, /Users, /System, home.
        for candidate in ["/", "/Users", "/Users/helm", "/System/Library"] {
            assert!(is_forbidden_root_normalized(
                candidate,
                true,
                Some("/Users/helm")
            ));
        }
        assert!(!is_forbidden_root_normalized(
            "/Users/helm/code",
            true,
            Some("/Users/helm")
        ));
        assert!(!is_forbidden_root_normalized(
            "/work/repo",
            true,
            Some("/Users/helm")
        ));
    }

    #[test]
    fn strip_verbatim_removes_only_the_prefix() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\C:\work\repo")).to_string_lossy(),
            r"C:\work\repo"
        );
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\server\share\repo")).to_string_lossy(),
            r"\\server\share\repo"
        );
        assert_eq!(
            strip_verbatim(Path::new(r"C:\plain\path")).to_string_lossy(),
            r"C:\plain\path"
        );
    }
}
