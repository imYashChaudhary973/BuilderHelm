use std::collections::HashSet;

struct StartupAck {
    id: &'static str,
    needle: &'static str,
    reply: &'static str,
}

const STARTUP_ACKS: &[StartupAck] = &[
    StartupAck {
        id: "claude-trust",
        needle: "i trust this folder",
        reply: "\r",
    },
    StartupAck {
        id: "codex-update",
        needle: "update available",
        reply: "3\r",
    },
    StartupAck {
        id: "workspace-trust",
        needle: "trust this workspace",
        reply: "\r",
    },
];

const STARTUP_FAILS: &[(&str, &str)] = &[
    ("quota", "session limit"),
    ("quota", "usage limit"),
    ("quota", "rate limit"),
    ("auth", "not logged in"),
    ("auth", "please log in"),
    ("auth", "please sign in"),
    ("auth", "invalid api key"),
];

pub fn visible_text(output: &str) -> String {
    let mut out = String::new();
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() {
                let c = bytes[i];
                i += 1;
                if (b'@'..=b'~').contains(&c) {
                    break;
                }
            }
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

pub fn next_startup_ack(
    output: &str,
    already: &HashSet<String>,
) -> Option<(&'static str, &'static str)> {
    let text = visible_text(output).to_ascii_lowercase();
    for ack in STARTUP_ACKS {
        if already.contains(ack.id) {
            continue;
        }
        if text.contains(ack.needle)
            || (ack.id == "workspace-trust" && text.contains("trust this directory"))
        {
            return Some((ack.id, ack.reply));
        }
    }
    None
}

pub fn startup_failure(output: &str) -> Option<&'static str> {
    let text = visible_text(output).to_ascii_lowercase();
    for (id, needle) in STARTUP_FAILS {
        if text.contains(needle) {
            return Some(*id);
        }
    }
    None
}
