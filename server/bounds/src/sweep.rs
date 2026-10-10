//! The one threaded loop every `measure-generation` sweep runs through.

/// `f(0), f(1), ..., f(n - 1)` computed on `threads` threads and returned
/// in index order, so whatever reduces the result sees the same sequence
/// whatever the thread count.
pub fn par_map_in_seed_order<T: Send>(n: u64, threads: u64, f: impl Fn(u64) -> T + Sync) -> Vec<T> {
    let threads = threads.max(1);
    let f = &f;
    let mut indexed: Vec<(u64, T)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                scope.spawn(move || {
                    let mut out = Vec::new();
                    let mut i = t;
                    while i < n {
                        out.push((i, f(i)));
                        i += threads;
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("a sweep thread panicked"))
            .collect()
    });
    indexed.sort_unstable_by_key(|(i, _)| *i);
    indexed.into_iter().map(|(_, v)| v).collect()
}

/// The thread count a sweep runs at.
pub fn threads() -> u64 {
    std::thread::available_parallelism().map_or(4, |t| t.get()) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_result_is_in_index_order_whatever_the_thread_count() {
        let f = |i: u64| i.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 7;
        let one = par_map_in_seed_order(1000, 1, f);
        for threads in [2, 7, 32, 2000] {
            assert_eq!(one, par_map_in_seed_order(1000, threads, f), "{threads}");
        }
        assert_eq!(one.len(), 1000);
        assert_eq!(one[3], f(3));
    }

    #[test]
    fn an_offending_seed_list_built_from_the_result_is_the_same_at_1_and_7_threads() {
        let offending = |threads| -> Vec<u64> {
            par_map_in_seed_order(500, threads, |i| (i, i % 37 == 5))
                .into_iter()
                .filter(|(_, miss)| *miss)
                .map(|(i, _)| i)
                .take(10)
                .collect()
        };
        assert_eq!(offending(1), offending(7));
        assert_eq!(
            offending(1),
            vec![5, 42, 79, 116, 153, 190, 227, 264, 301, 338]
        );
    }

    #[test]
    fn an_empty_range_is_empty() {
        assert!(par_map_in_seed_order(0, 4, |i| i).is_empty());
    }
}
