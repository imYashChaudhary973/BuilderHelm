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
//! out  {"type":"event","event":"zero:board:event","payload":{...}}
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
//! `events` lists the push channels this build can emit unprompted, and an
//! event frame carries no id because nothing asked for it. A consumer reads
//! the list rather than assuming, and drops any event the handshake did not
//! advertise.
//!
//! Phase B step 1 builds the transport, not the source. The engine has no
//! unprompted event source yet, so a production launch advertises no events
//! and `zero:board:event`, `zero:chat:stream-event`, and `zero:swarm:event`
//! stay with the TypeScript main process. Under `--test-controls` the `emit`
//! control drives the transport across a real process boundary, so the
//! handshake advertises what `emit` can produce. Phase B replaces that source
//! with `helm-pty` output and advertises it unconditionally.
//!
//! Every frame leaves through one writer thread fed by a channel, so an
//! unprompted event can never interleave with a response mid-line. `emit`
//! answers `ok` only after the event frame is queued ahead of it, which gives
//! a test a barrier instead of a sleep.
//!
//! `--test-controls` additionally accepts `reset`, `dialogFolder`, `confirm`,
//! and `emit` frames so the conformance runner can drive fixture setup across
//! the process boundary. Production launches must omit the flag; without it
//! those frames are rejected.

use std::io::{BufRead, Write};
use std::sync::mpsc;

use helm_host::Host;
use helm_protocol::{ipc_channel_count, ipc_channel_names};
use serde_json::{json, Value};

/// Wire format version. Bump when a frame shape changes incompatibly.
pub const ENGINE_PROTOCOL: u32 = 1;

/// Push channels the engine knows how to emit unprompted.
///
/// Phase B step 1 has no production source for these; `emit` under
/// `--test-controls` is the only thing that produces one, so a production
/// handshake advertises none of them. Adding a name here without a source
/// would make a consumer drop its own emitter and lose the events.
pub const EMITTABLE_EVENTS: [&str; 1] = ["zero:board:event"];

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
    /// Push one event frame, then acknowledge. Proves the event transport.
    Emit {
        id: Value,
        event: String,
        payload: Value,
    },
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
            // An event nobody advertised would be dropped by the consumer, so
            // refuse it here where the refusal is visible instead.
            "emit" => match value.get("event").and_then(Value::as_str) {
                Some(event) if EMITTABLE_EVENTS.contains(&event) => Ok(Frame::Emit {
                    id,
                    event: event.to_string(),
                    payload: value.get("payload").cloned().unwrap_or_else(|| json!({})),
                }),
                Some(event) => Err(error_frame(
                    id,
                    "VALIDATION_FAILED",
                    &format!("{event} is not an emittable event"),
                )),
                None => Err(error_frame(
                    id,
                    "VALIDATION_FAILED",
                    "emit needs an event name",
                )),
            },
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
    // Advertise only what this launch can actually emit. Without the flag
    // nothing produces an event, and claiming otherwise would make the
    // consumer stand down its own emitter.
    let events: Vec<&str> = if test_controls {
        EMITTABLE_EVENTS.to_vec()
    } else {
        Vec::new()
    };
    json!({
        "type": "hello",
        "protocol": ENGINE_PROTOCOL,
        "engine": env!("CARGO_PKG_VERSION"),
        "host": host,
        "channelCount": ipc_channel_count(),
        "channels": ipc_channel_names().to_vec(),
        "events": events,
        "testControls": test_controls,
    })
}

/// An unprompted push. No id: nothing asked for it.
fn event_frame(event: &str, payload: Value) -> Value {
    json!({ "type": "event", "event": event, "payload": payload })
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

/// Own stdout on one thread so nothing can interleave mid-line.
///
/// Responses and unprompted events share this queue, which makes ordering
/// FIFO and makes a torn frame impossible once phase B emits PTY output from
/// a background task. Returns whether every frame reached stdout.
fn spawn_writer(rx: mpsc::Receiver<Value>) -> std::thread::JoinHandle<bool> {
    std::thread::spawn(move || {
        let mut out = std::io::stdout();
        for frame in rx {
            if write_frame(&mut out, &frame).is_err() {
                // Drain without writing: the consumer is gone, and the read
                // loop learns about it from its own failed send.
                return false;
            }
        }
        true
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
    let (tx, rx) = mpsc::channel::<Value>();
    let writer = spawn_writer(rx);

    // A closed queue means stdout is gone; stop rather than spin.
    let send = |frame: Value| tx.send(frame).is_ok();
    if !send(hello_frame("conformance", test_controls)) {
        return 1;
    }

    let mut failed = false;
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("engine: stdin failed: {error}");
                failed = true;
                break;
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
            // The event goes ahead of its own acknowledgement, so a caller
            // that has seen the `ok` has already been handed the event.
            Ok(Frame::Emit { id, event, payload }) => {
                if !send(event_frame(&event, payload)) {
                    failed = true;
                    break;
                }
                json!({ "type": "ok", "id": id })
            }
            Err(error) => error,
        };
        if !send(frame) {
            failed = true;
            break;
        }
    }
    // Dropping the queue ends the writer, which flushes what is still buffered.
    drop(tx);
    let flushed = writer.join().unwrap_or(false);
    i32::from(failed || !flushed)
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
    fn a_production_launch_declares_no_event_source() {
        let hello = hello_frame("conformance", false);
        assert_eq!(
            hello["events"],
            json!([]),
            "nothing emits without the flag; a consumer must keep its own emitter"
        );
        assert_eq!(hello["testControls"], json!(false));
    }

    #[test]
    fn test_controls_advertise_what_emit_can_produce() {
        let hello = hello_frame("conformance", true);
        assert_eq!(hello["testControls"], json!(true));
        assert_eq!(
            hello["events"],
            json!(["zero:board:event"]),
            "the advertised list must match what emit accepts"
        );
        // The list a consumer filters on and the list emit validates against
        // are the same list, or an accepted event would be dropped.
        for event in EMITTABLE_EVENTS {
            assert!(hello["events"]
                .as_array()
                .expect("events")
                .iter()
                .any(|advertised| advertised == event));
        }
    }

    #[test]
    fn an_event_frame_carries_no_id() {
        let frame = event_frame("zero:board:event", json!({ "paneId": "p1" }));
        assert_eq!(frame["type"], json!("event"));
        assert_eq!(frame["event"], json!("zero:board:event"));
        assert_eq!(frame["payload"]["paneId"], json!("p1"));
        assert!(
            frame.get("id").is_none(),
            "nothing asked for it, so there is no id to answer"
        );
    }

    #[test]
    fn emit_decodes_only_advertised_events() {
        assert_eq!(
            decode(
                r#"{"id":9,"type":"emit","event":"zero:board:event","payload":{"a":1}}"#,
                true
            )
            .expect("frame"),
            Frame::Emit {
                id: json!(9),
                event: "zero:board:event".into(),
                payload: json!({ "a": 1 }),
            }
        );
        // A missing payload is an empty object, matching the request path.
        assert_eq!(
            decode(r#"{"id":9,"type":"emit","event":"zero:board:event"}"#, true).expect("frame"),
            Frame::Emit {
                id: json!(9),
                event: "zero:board:event".into(),
                payload: json!({}),
            }
        );

        let error = decode(
            r#"{"id":1,"type":"emit","event":"zero:chat:stream-event"}"#,
            true,
        )
        .expect_err("not emittable yet");
        assert_eq!(error["code"], json!("VALIDATION_FAILED"));
        assert!(error["message"]
            .as_str()
            .unwrap()
            .contains("not an emittable event"));

        let error = decode(r#"{"id":2,"type":"emit"}"#, true).expect_err("event is required");
        assert_eq!(error["id"], json!(2));

        // Emitting is a control, so it needs the flag like every other one.
        let error = decode(
            r#"{"id":3,"type":"emit","event":"zero:board:event"}"#,
            false,
        )
        .expect_err("must be refused");
        assert!(error["message"]
            .as_str()
            .unwrap()
            .contains("--test-controls"));
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
