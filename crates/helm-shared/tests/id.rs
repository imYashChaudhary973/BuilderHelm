use helm_shared::{create_correlation_id, create_id};

fn is_rfc9562_v7(id: &str) -> bool {
    let parts: Vec<&str> = id.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    if parts[0].len() != 8
        || parts[1].len() != 4
        || parts[2].len() != 4
        || parts[3].len() != 4
        || parts[4].len() != 12
    {
        return false;
    }
    if !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return false;
    }
    let version = parts[2].as_bytes()[0];
    let variant = parts[3].as_bytes()[0];
    version == b'7' && matches!(variant, b'8' | b'9' | b'a' | b'b')
}

#[test]
fn creates_an_rfc_9562_version_7_uuid() {
    let id = create_id(1_754_678_400_000);
    assert!(is_rfc9562_v7(id.as_str()), "{id}");
}

#[test]
fn sorts_records_created_in_different_milliseconds_chronologically() {
    assert!(create_id(1_000) < create_id(1_001));
}

#[test]
fn uses_the_same_safe_format_for_correlation_ids() {
    let id = create_correlation_id();
    assert_eq!(id.as_str().len(), 36);
    assert!(id
        .as_str()
        .bytes()
        .all(|b| b.is_ascii_hexdigit() || b == b'-'));
}
