use super::*;

#[test]
fn document_references_preserve_paths_and_native_uris() {
    for value in ["content://documents/1", "file:///tmp/work.txt"] {
        let document = DocumentRef::parse(value).unwrap();

        assert!(matches!(document, DocumentRef::Uri(_)));
        assert_eq!(document.as_text().unwrap(), value);
    }

    for value in [r"C:\Users\fixture\dump.txt", "/home/fixture/dump.txt"] {
        let document = DocumentRef::parse(value).unwrap();

        assert!(matches!(document, DocumentRef::Path(_)));
        assert_eq!(document.as_text().unwrap(), value);
    }
}

#[test]
fn document_references_reject_network_and_malformed_uris() {
    for value in [
        "https://example.com/private.txt",
        "javascript:alert(1)",
        "data:text/plain,content",
        "content:document",
        "content://user:password@documents/1",
        "content://documents/1#fragment",
        "",
        "invalid\0path",
    ] {
        assert_eq!(DocumentRef::parse(value).unwrap_err().code, "invalid");
    }
}
