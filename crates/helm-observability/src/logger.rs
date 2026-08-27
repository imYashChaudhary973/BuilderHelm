use std::sync::Once;

use helm_shared::utc_now;
use serde::Serialize;
use serde_json::Value;
use tracing::Level;

use crate::redact::redact;

static TRACING: Once = Once::new();

#[derive(Clone, Copy)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }

    fn tracing(self) -> Level {
        match self {
            Self::Debug => Level::DEBUG,
            Self::Info => Level::INFO,
            Self::Warn => Level::WARN,
            Self::Error => Level::ERROR,
        }
    }
}

pub struct LogInput<'a> {
    pub event: &'a str,
    pub correlation_id: &'a str,
    pub data: Option<Value>,
}

#[derive(Serialize)]
struct LogRecord<'a> {
    timestamp: String,
    level: &'a str,
    event: &'a str,
    #[serde(rename = "correlationId")]
    correlation_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

pub struct Logger {
    sink: Box<dyn Fn(String)>,
}

fn ensure_tracing() {
    TRACING.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_writer(std::io::sink)
            .try_init();
    });
}

impl Logger {
    fn write(&self, level: LogLevel, input: LogInput<'_>) {
        ensure_tracing();
        let record = LogRecord {
            timestamp: utc_now(),
            level: level.as_str(),
            event: input.event,
            correlation_id: input.correlation_id,
            data: input.data.as_ref().map(redact),
        };
        let line = serde_json::to_string(&record).expect("log record");
        match level.tracing() {
            Level::DEBUG => tracing::debug!(
                event = input.event,
                correlation_id = input.correlation_id,
                "{line}"
            ),
            Level::INFO => tracing::info!(
                event = input.event,
                correlation_id = input.correlation_id,
                "{line}"
            ),
            Level::WARN => tracing::warn!(
                event = input.event,
                correlation_id = input.correlation_id,
                "{line}"
            ),
            Level::ERROR => tracing::error!(
                event = input.event,
                correlation_id = input.correlation_id,
                "{line}"
            ),
            _ => {}
        }
        (self.sink)(line);
    }

    pub fn debug(&self, input: LogInput<'_>) {
        self.write(LogLevel::Debug, input);
    }

    pub fn info(&self, input: LogInput<'_>) {
        self.write(LogLevel::Info, input);
    }

    pub fn warn(&self, input: LogInput<'_>) {
        self.write(LogLevel::Warn, input);
    }

    pub fn error(&self, input: LogInput<'_>) {
        self.write(LogLevel::Error, input);
    }
}

pub fn create_logger(sink: impl Fn(String) + 'static) -> Logger {
    Logger {
        sink: Box::new(sink),
    }
}
