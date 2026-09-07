use sim::demo_ping::validate_ping_message;

#[test]
fn rejects_an_empty_message() {
    assert_eq!(validate_ping_message(""), Err("message must not be empty"));
}

#[test]
fn accepts_a_non_empty_message() {
    assert_eq!(validate_ping_message("hello"), Ok(()));
}
