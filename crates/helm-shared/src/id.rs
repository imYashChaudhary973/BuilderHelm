use uuid::timestamp::context::NoContext;
use uuid::{Timestamp, Uuid};

const MAX_UUID_TIMESTAMP: u64 = 0xffffffffffff;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct ZeroId(String);

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct CorrelationId(String);

impl ZeroId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl CorrelationId {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl std::fmt::Display for ZeroId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for CorrelationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn unix_millis_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn create_id(timestamp: u64) -> ZeroId {
    if timestamp > MAX_UUID_TIMESTAMP {
        panic!("UUIDv7 timestamp must be a non-negative 48-bit integer");
    }
    let seconds = timestamp / 1000;
    let nanos = u32::try_from((timestamp % 1000) * 1_000_000).unwrap_or(0);
    let uuid = Uuid::new_v7(Timestamp::from_unix(NoContext, seconds, nanos));
    ZeroId(uuid.to_string())
}

pub fn create_correlation_id() -> CorrelationId {
    CorrelationId(create_id(unix_millis_now()).0)
}
