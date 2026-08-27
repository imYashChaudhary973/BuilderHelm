use helm_core::parse_markdown_document;
use serde_json::Value;

#[test]
fn extracts_frontmatter_headings_chunks_tags_and_links_with_line_provenance() {
    let document = parse_markdown_document(
        "Projects/Zero.md",
        [
            "---",
            "title: Zero Architecture",
            "status: active",
            "tags: [project, architecture]",
            "---",
            "# Zero",
            "",
            "We selected architecture B for offline operation. #decision",
            "",
            "## Evidence",
            "See [[Research Notes|benchmarks]] and [design](Design.md#Storage).",
        ]
        .join("\n"),
        1_000.0,
        200,
    );

    assert_eq!(document.title, "Zero Architecture");
    let frontmatter: Value = serde_json::from_str(&document.frontmatter_json).unwrap();
    assert_eq!(frontmatter["status"], "active");
    assert_eq!(
        frontmatter["tags"],
        serde_json::json!(["project", "architecture"])
    );
    let tags: Value = serde_json::from_str(&document.tags_json).unwrap();
    assert_eq!(
        tags,
        serde_json::json!(["architecture", "decision", "project"])
    );
    assert_eq!(document.chunks[0].heading.as_deref(), Some("Zero"));
    assert_eq!(document.chunks[0].line_start, 6);
    assert_eq!(document.chunks[0].line_end, 8);
    assert_eq!(document.chunks[1].heading.as_deref(), Some("Evidence"));
    assert_eq!(document.chunks[1].line_start, 10);
    assert_eq!(document.chunks[1].line_end, 11);
    assert_eq!(document.links[0].1, "Research Notes");
    assert_eq!(document.links[0].2.as_deref(), Some("benchmarks"));
    assert_eq!(document.links[0].3, "wikilink");
    assert_eq!(document.links[1].1, "Design.md");
    assert_eq!(document.links[1].2.as_deref(), Some("design"));
    assert_eq!(document.links[1].3, "markdown");
    assert_eq!(document.entities[0].1, "Research Notes");
    assert_eq!(document.entities[0].2, "note");
}
