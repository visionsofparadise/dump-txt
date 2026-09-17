use super::*;

#[test]
fn the_system_source_returns_installed_family_names() {
    let families = SystemSource::new().all_families().unwrap();

    assert!(!families.is_empty());
    assert!(families.iter().all(|family| !family.is_empty()));
}
