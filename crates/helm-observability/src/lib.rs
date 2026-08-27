mod logger;
mod redact;

pub use logger::{create_logger, LogInput, LogLevel, Logger};
pub use redact::redact;
