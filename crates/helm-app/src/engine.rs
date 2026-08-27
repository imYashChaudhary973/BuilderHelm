//! Engine sidecar (ADOPTION phase A).
//!
//! The Electron main process launches this as a long-running child and speaks
//! newline-delimited JSON over stdio. It is deliberately local-only: no TCP
//! listener, no remote trust boundary.
//!
//! Frames, one JSON object per line:
//!
//! ```text
//! out  {"type":"hello","protocol":1,"engine":"0.0.0","host":"conformance",
//!       "channelCount":71,"channels":[...],"events":[],"testControls":false}
//! in   {"id":1,"method":"zero:system:health","input":{...}}
//! out  {"type":"response","id":1,"payload":{"ok":true,"value":{...}}}
//! out  {"type":"error","id":null,"code":"VALIDATION_FAILED","message":"..."}
//! ```
//!
//! `payload` is exactly what `Host::invoke` returns, byte for byte. Channels
//! disagree on shape - `zero:system:health` answers a bare object while
//! `zero:board:home-dir` answers an `{ok,value}` envelope - so the sidecar
//! never re-wraps. Re-wrapping would break the corpus it has to satisfy.
//!
//! The consumer must check `protocol` and `channels` against its own map and
//! fail closed on mismatch rather than degrade.
//!
//! `events` lists the push channels this build can emit unprompted. It is
//! empty: the Rust host has no event source yet, so `zero:board:event`,
//! `zero:chat:stream-event`, and `zero:swarm:event` stay with the TypeScript
//! main process until phases B and C move PTY and chat streaming behind the
//! engine. A consumer reads this list rather than assuming.
//!
//! `--test-controls` additionally accepts `reset`, `dialogFolder`, and
//! `confirm` frames so the conformance runner can drive fixture setup across
//! the process boundary. Production launches must omit the flag; without it
//! those frames are rejected.

use std::io::{BufRead, Write};

use helm_host::Host;
use helm_protocol::{ipc_channel_count, ipc_channel_names};
use serde_json::{json, Value};

/// Wire format version. Bump when a frame shape changes incompatibly.
pub const ENGINE_PROTOCOL: u32 = 1;

/// A request, or a test-only control.
#[derive(Debug, PartialEq)]
enum Frame {
    Request {
        id: Value,
        method: String,
        input: Value,
    },
    /// Rebuild the host, discarding all state.
    Reset { id: Value },
    /// Preload the folder a dialog would return.
    DialogFolder {
        id: Value,
        folder: String,
        canceled: bool,
    },
    /// Preload the answer a confirmation dialog would return.
    Confirm { id: Value, response: i32 },
}

/// Decode one input line into a frame, or an error frame to write back.
fn decode(line: &str, test_controls: bool) -> Result<Frame, Value> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| error_frame(Value::Null, "VALIDATION_FAILED", &error.to_string()))?;
    let id = value.get("id").cloned().unwrap_or(Value::Null);

    if let Some(kind) = value.get("type").and_then(Value::as_str) {
        if !test_controls {
            return Err(error_frame(
                id,
                "VALIDATION_FAILED",
                "control frames need --test-controls",
            ));
        }
        return match kind {
            "reset" => Ok(Frame::Reset { id }),
            "dialogFolder" => Ok(Frame::DialogFolder {
                id,
                folder: value
                    .get("folder")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                canceled: value.get("canceled") == Some(&Value::Bool(true)),
            }),
            "confirm" => Ok(Frame::Confirm {
                id,
                response: value
                    .get("response")
                    .and_then(Value::as_i64)
                    .unwrap_or(1)
                    .clamp(i32::MIN as i64, i32::MAX as i64) as i32,
            }),
            other => Err(error_frame(
                id,
                "VALIDATION_FAILED",
                &format!("unknown control {other}"),
            )),
        };
    }

    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Err(error_frame(
            id,
            "VALIDATION_FAILED",
            "method must be a string",
        ));
    };
    // A missing input is an empty object, so `{"id":1,"method":"..."}` works
    // for the channels that take no arguments.
    let input = value.get("input").cloned().unwrap_or_else(|| json!({}));
    Ok(Frame::Request {
        id,
        method: method.to_string(),
        input,
    })
}

fn error_frame(id: Value, code: &str, message: &str) -> Value {
    json!({ "type": "error", "id": id, "code": code, "message": message })
}

fn hello_frame(host: &str, test_controls: bool) -> Value {
    json!({
        "type": "hello",
        "protocol": ENGINE_PROTOCOL,
        "engine": env!("CARGO_PKG_VERSION"),
        "host": host,
        "channelCount": ipc_channel_count(),
        "channels": ipc_channel_names().to_vec(),
        "events": Vec::<&str>::new(),
        "testControls": test_controls,
    })
}

fn write_frame(out: &mut impl Write, frame: &Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *out, frame)?;
    out.write_all(b"\n")?;
    out.flush()
}

/// Run one channel, turning a panicking handler into an error payload.
///
/// A panic must not take the engine down: the consumer would lose every
/// in-flight request and the app would need a restart over one bad call. This
/// is the same containment the in-process conformance runner applies, so both
/// paths answer identically.
fn invoke_caught(rt: &tokio::runtime::Runtime, host: &Host, channel: &str, input: Value) -> Value {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        rt.block_on(host.invoke(channel, input))
    }))
    .unwrap_or_else(|_| {
        json!({
            "ok": false,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "The request could not be completed",
                "retryable": false
            }
        })
    })
}

/// Serve the sidecar protocol until stdin closes. Returns a process exit code.
pub fn run(test_controls: bool) -> i32 {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(error) => {
            eprintln!("engine: runtime failed: {error}");
            return 1;
        }
    };
    // Phase A carries the conformance-backed host so the transport and channel
    // map can be proven before real state is involved. Production wiring (real
    // database, keyring, swarm runners) is the next step and is named in the
    // handshake so a consumer can tell the difference.
    let mut host = Host::for_conformance();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    if write_frame(&mut stdout, &hello_frame("conformance", test_controls)).is_err() {
        return 1;
    }

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("engine: stdin failed: {error}");
                return 1;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let frame = match decode(&line, test_controls) {
            Ok(Frame::Request { id, method, input }) => {
                let payload = invoke_caught(&rt, &host, &method, input);
                json!({ "type": "response", "id": id, "payload": payload })
            }
            Ok(Frame::Reset { id }) => {
                host = Host::for_conformance();
                json!({ "type": "ok", "id": id })
            }
            Ok(Frame::DialogFolder {
                id,
                folder,
                canceled,
            }) => {
                host.set_dialog_folder(folder, canceled);
                json!({ "type": "ok", "id": id })
            }
            Ok(Frame::Confirm { id, response }) => {
                host.set_confirm(response);
                json!({ "type": "ok", "id": id })
            }
            Err(error) => error,
        };
        if write_frame(&mut stdout, &frame).is_err() {
            return 1;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_advertises_the_whole_channel_map() {
        let hello = hello_frame("conformance", false);
        assert_eq!(hello["protocol"], json!(ENGINE_PROTOCOL));
        assert_eq!(hello["channelCount"], json!(71));
        let channels = hello["channels"].as_array().expect("channels");
        assert_eq!(channels.len(), 71, "handshake must list every channel");
        assert!(channels.iter().any(|c| c == "zero:system:health"));
        assert!(channels.iter().any(|c| c == "zero:helm"));
        // A consumer fails closed on mismatch, so the count and the list must
        // never disagree.
        assert_eq!(
            channels.len(),
            hello["channelCount"].as_u64().unwrap() as usize
        );
    }

    #[test]
    fn hello_declares_no_event_source_yet() {
        let hello = hello_frame("conformance", false);
        assert_eq!(
            hello["events"],
            json!([]),
            "the rust host has no emitter; a consumer must keep its own"
        );
        assert_eq!(hello["testControls"], json!(false));
        assert_eq!(
            hello_frame("conformance", true)["testControls"],
            json!(true)
        );
    }

    #[test]
    fn decode_accepts_a_request_and_defaults_missing_input() {
        let frame = decode(r#"{"id":7,"method":"zero:system:health"}"#, false).expect("frame");
        assert_eq!(
            frame,
            Frame::Request {
                id: json!(7),
                method: "zero:system:health".into(),
                input: json!({}),
            },
            "absent input becomes empty"
        );

        let frame = decode(
            r#"{"id":"a","method":"zero:board:home-dir","input":{"x":1}}"#,
            false,
        )
        .expect("frame");
        assert_eq!(
            frame,
            Frame::Request {
                id: json!("a"),
                method: "zero:board:home-dir".into(),
                input: json!({ "x": 1 }),
            }
        );
    }

    #[test]
    fn decode_rejects_malformed_lines_while_keeping_the_id() {
        let error = decode("not json", false).expect_err("must fail");
        assert_eq!(error["type"], json!("error"));
        assert_eq!(error["id"], Value::Null);
        assert_eq!(error["code"], json!("VALIDATION_FAILED"));

        let error = decode(r#"{"id":3}"#, false).expect_err("method is required");
        assert_eq!(
            error["id"],
            json!(3),
            "id survives so the caller can settle"
        );
        assert_eq!(error["code"], json!("VALIDATION_FAILED"));

        let error = decode(r#"{"id":4,"method":5}"#, false).expect_err("method must be a string");
        assert_eq!(error["id"], json!(4));
    }

    #[test]
    fn control_frames_need_the_flag() {
        let error = decode(r#"{"id":1,"type":"reset"}"#, false).expect_err("must be refused");
        assert_eq!(error["code"], json!("VALIDATION_FAILED"));
        assert!(
            error["message"]
                .as_str()
                .unwrap()
                .contains("--test-controls"),
            "the refusal must name the missing flag"
        );

        assert_eq!(
            decode(r#"{"id":1,"type":"reset"}"#, true).expect("allowed"),
            Frame::Reset { id: json!(1) }
        );
    }

    #[test]
    fn control_frames_decode_their_payloads() {
        assert_eq!(
            decode(
                r#"{"id":2,"type":"dialogFolder","folder":"/tmp/x","canceled":true}"#,
                true
            )
            .expect("frame"),
            Frame::DialogFolder {
                id: json!(2),
                folder: "/tmp/x".into(),
                canceled: true,
            }
        );
        // An absent `canceled` is false, not an error.
        assert_eq!(
            decode(r#"{"id":3,"type":"dialogFolder","folder":"/tmp/y"}"#, true).expect("frame"),
            Frame::DialogFolder {
                id: json!(3),
                folder: "/tmp/y".into(),
                canceled: false,
            }
        );
        assert_eq!(
            decode(r#"{"id":4,"type":"confirm","response":0}"#, true).expect("frame"),
            Frame::Confirm {
                id: json!(4),
                response: 0,
            }
        );
        let error = decode(r#"{"id":5,"type":"nope"}"#, true).expect_err("unknown control");
        assert_eq!(error["code"], json!("VALIDATION_FAILED"));
    }

    #[test]
    fn unknown_methods_answer_instead_of_killing_the_engine() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let host = Host::for_conformance();
        let payload = rt.block_on(host.invoke("zero:not:a-channel", json!({})));
        assert_eq!(payload["ok"], json!(false));
        assert!(payload["error"]["code"].is_string());
    }

    #[test]
    fn frames_are_one_line_each() {
        let mut buffer: Vec<u8> = Vec::new();
        write_frame(&mut buffer, &json!({ "type": "hello", "a": 1 })).expect("write");
        // A payload carrying newlines must not split into two frames.
        write_frame(
            &mut buffer,
            &json!({ "type": "response", "id": 1, "payload": "a\nb\r\nc" }),
        )
        .expect("write");
        let text = String::from_utf8(buffer).expect("utf8");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "one frame per line");
        for line in &lines {
            let _: Value = serde_json::from_str(line).expect("each line parses alone");
        }
        let second: Value = serde_json::from_str(lines[1]).expect("parse");
        assert_eq!(second["payload"], json!("a\nb\r\nc"), "newlines survive");
    }
}
