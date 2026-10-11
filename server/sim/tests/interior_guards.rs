//! The per-city interior guard figures (`sim::generation::guards`), on a
//! committed city. The kind tags are resolved here, never in the generator.

use sim::generated::defs;
use sim::generation::guards::{KindTags, interior_figures, kind_spread_verdict};
use sim::generation::{GenerationConfig, GenerationContent, plan};

#[test]
fn interior_figures_measure_a_committed_city() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let id = |k: &str| content.tags.iter().find(|t| t.key == k).unwrap().id;
    let tags = KindTags {
        dwelling: id("dwelling"),
        shop: id("shop"),
        cafe: id("cafe"),
        staff: id("staff"),
    };
    let d = plan(1, &cfg, &content).unwrap();
    let f = interior_figures(&d, &content, &cfg, &tags);
    assert_eq!(f.laid, d.interiors.enterable_count());
    assert_eq!(f.enterable, f.laid, "every laid interior is enterable");
    assert!(f.laid >= cfg.interior_min_enterable_count);
    assert!(f.max_attempts >= 1 && f.max_attempts <= cfg.interior_max_layout_attempts);
    assert!(f.rejected_percent <= cfg.interior_max_rejected_percent);
    assert!(f.placed.iter().all(|&p| p > 0), "{:?}", f.placed);
    assert!(
        f.kind_enterable
            .iter()
            .zip(f.placed)
            .all(|(&e, p)| e >= 1 && e <= p)
    );
    assert!(f.low_band_dwelling);
    assert!(
        f.max_room_aspect_x100 >= 100
            && f.max_room_aspect_x100 <= cfg.interior_max_room_aspect as i64 * 100
    );
    assert_eq!(
        kind_spread_verdict(f.placed, f.kind_enterable, f.laid, &cfg),
        Ok(())
    );
}
