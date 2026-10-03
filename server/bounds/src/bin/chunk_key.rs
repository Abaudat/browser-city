//! Prints `sim::world::chunk_key` for each `<cx> <cy> <floor>` line on
//! stdin (chunk coordinates, not cells), one key per line. Exists so a
//! shell check never carries its own copy of the bit layout.

use std::io::BufRead;

use sim::world::{CHUNK_SIZE, chunk_key};

fn main() {
    for line in std::io::stdin().lock().lines() {
        let line = line.expect("stdin is readable");
        let parts: Vec<i64> = line
            .split_whitespace()
            .map(|p| p.parse().expect("an integer"))
            .collect();
        let [cx, cy, floor] = parts[..] else {
            panic!("expected `<cx> <cy> <floor>`, got {line:?}");
        };
        let key = chunk_key(
            (cx * i64::from(CHUNK_SIZE)) as i32,
            (cy * i64::from(CHUNK_SIZE)) as i32,
            floor as i8,
        );
        println!("{key}");
    }
}
