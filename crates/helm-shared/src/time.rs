use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

#[derive(Debug)]
pub struct InvalidTimestamp;

impl std::fmt::Display for InvalidTimestamp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Timestamp must be a valid date")
    }
}

impl std::error::Error for InvalidTimestamp {}

fn format_js_iso(dt: OffsetDateTime) -> String {
    let utc = dt.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        utc.year(),
        u8::from(utc.month()),
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
        utc.millisecond()
    )
}

pub fn utc_now() -> String {
    format_js_iso(OffsetDateTime::now_utc())
}

pub fn to_utc_timestamp(value: &str) -> Result<String, InvalidTimestamp> {
    let parsed = OffsetDateTime::parse(value, &Rfc3339).map_err(|_| InvalidTimestamp)?;
    Ok(format_js_iso(parsed))
}
