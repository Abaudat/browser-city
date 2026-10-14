# Generation Design

This is the home for placement constraints, adjacency tables, density
curves and neighbourhood parameter ranges -- the document
`docs/architecture.md`'s Rules section names as the home for rule
content. `docs/gdd.md`'s Level Design Framework states *intent* ("the
periphery is deliberately quiet"); this document turns intent into
rules; `defs/rules/*.toml` holds the executable rows. A claim is stated
in exactly one of those three, never two -- in particular, this document
never repeats a number or a tag `defs/` already carries: a rule entry
here is its `key`, its `status` (`committed`/`planned`), the pass that
consumes it, its scope, the parameters it reads and a one-sentence
intent, never the subject/ratio/spacing/direction that make it fire.
Those live only in the `defs/rules/*.toml` row the key names.

A rule arrives here before or with the code that consumes it, never
after: a `planned` row with no matching `defs/rules/` key is the
normal, expected state of most of this document today; the reverse --
a committed key with no row, or a row still marked `planned` once its
key is committed -- is a red build (`server/sim/tests/rule_examples.rs`).

The lowercase headings below (`## parameters` and the five `## <kind>`
sections) are machine-read, fixed shape -- exact heading text, one
table each, checked at every build. So is "## Must never be seen"'s own
`Claimed by`/`Status` pair, even though its heading is Title Case.
Every other section is free prose.

## Design laws

These apply to every rule recorded below, not just the ones already
written.

- **Friction is content.** A distribution rule must not sand the city
  into uniform convenience. Service coverage thinning with affluence or
  toward the periphery is intended; a rule guaranteeing everything is
  near everyone is a design defect, not a safety net.
- **The city grows** (Epic 14). New neighbourhoods generate adjacent to
  a city that already exists and is lived in. A whole-site rule is the
  expensive exception, and its own row must say how it behaves when the
  site is extended rather than generated fresh.
- **Every state change has an author.** Initial generation is the one
  sanctioned authorless act, because no citizen exists yet to have
  authored anything. Any later invocation of the generator is the
  outcome of the development chain (Epic 14), never spontaneous.

## Neighbourhood parameters

A neighbourhood is the ground between arterials (or an arterial and the
site edge) -- an area, never an identity: no name, no archetype or preset
("old town", "docks") in `defs/` or Rust, no per-neighbourhood override
table. It is a
point in a four-parameter space and nothing more (FR113): anything that
differs by place reads one of the four dials below, and no fifth mechanism
makes a neighbourhood feel different. These are the sim's own quantities --
the same ones the gentrification loop (physical state -> desirability ->
rent -> demographics) later reads and mutates -- whose *initial* values the
generator sets; `sim::generation::NeighbourhoodParams`, returned by
`LandUseMap::at_world`, has exactly these four fields.

**Density has one definition: how tightly plots are packed along a
block** (the GDD's own wording), and keeps its centre-to-periphery
falloff. "Props visible per screen of street" (below) and the citizens a
screen supports are *consequences* a rule derives from that packing, never
second meanings of the word.

**Land-use mix is not a scalar.** The GDD names four uses --
residential, commercial, industrial, institutional -- so the parameter
is a share per use. A neighbourhood's mix is the derived share of its area
per use, realised by pass 1; there is no second authored number.

**Age and affluence are plateaus with edges.** Each is one value per
neighbourhood: flat across it, stepping only where an arterial separates
two, never through a block interior. The two sides of one street may
differ -- that single screen is the payoff. Each raw draw is a pure function of
`(city_seed, the neighbourhood's own world-absolute corner, cfg)` from its
own keyed stream, never normalised against the site's extent, so raw draws
are growth-stable; age, affluence and the density peak are independent of
one another, so a district never has one core-to-edge character. The
guarantees below are repaired once, at initial generation. Afterwards the
dials are sim state the generator never re-derives: growth authors new
ground only. Per district, the generator guarantees (balance
keys under `generation.neighbourhood.*`): at least three neighbourhoods a
legible step apart, a legible step between an adjacent pair on age, an adjacent pair in
opposite end thirds of affluence (so the one screen across it is the dial's
whole range), at least three of the four corners (old/new x poor/rich), and a
bottom-band neighbourhood that holds dwellings -- somewhere affordable to
begin. A neighbourhood narrower than two viewports is joined to a neighbour
into one patch sharing both dials, so a place is always bigger than a
screen (unless that would leave fewer patches than the corners need).

| Parameter | Unit | Range | Visible carrier |
| --- | --- | --- | --- |
| Density | plots per unit street length, integer | `generation.land_use.density_min`..`density_max` | plot packing along `2_City_Terrains`/`1_Terrains_and_Fences` ground coverage, and street-prop cadence (bins, benches, lamps, trees) from `3_City_Props` -- more plots and more props per screen at the high end, wide gaps and few props at the low end; it bands dwelling *form class* (low / mid / high) and only density does |
| Building age | integer, newer to older | `generation.neighbourhood.building_age_min`..`building_age_max` | facade variant *within* `4_Generic_Buildings`, never family choice. Older end: `Condo_9` (exposed pipes, posters and flyers, a stained base course), the `Condo_8` fire-escape/balcony/flyer dressing on a tenement body as assembled in `Condo_Example`, `Condo_4` (red brick, arched entrances, bay fronts, white cornices) and `Condo_6` (grey stone, round-arched windows). Newer end: `Condo_5` (flat teal panel block, ribbon windows, canopy entrance) and `Condo_1`/`Condo_2` (flat rendered facades, plain rectangular windows, no ornament). `Condo_3` and `Condo_7` sit mid-range. No set has an aged variant of itself, so age reads through architectural style and applied dressing alone, never a building visibly ageing in place. `5_Floor_Modular_Buildings` varies by ground-floor shop type, not by age; `9_Shopping_Center_and_Markets` ships one building style and `7_Villas` two (the large timber-fronted houses with a porch, `villa`'s carrier, and the small red-roofed rendered houses, `cottage`'s) -- none carries an age range. Age never gates a building type |
| Affluence | integer, poorer to richer | `generation.neighbourhood.affluence_min`..`affluence_max` | the commercial frontage: shop-type mix and the share of shuttered units (`[[building_type]]` `affluence_min`/`affluence_max` bands, the density band's own shape and the one eligibility filter), and later plot dressing (`17_Garden`, `1_Terrains_and_Fences`, `6_Garage_Sales`, `3_City_Props`) and the `moderninteriors` theme (e.g. `26_Condominium_Singles` vs the plain `1_Generic`); prop density is a generator output, never a sprite variant. Affluence picks the dwelling type *within* a form class (`villa` rich, `cottage` poor, both `form_low`); the form class itself is Density's |
| Land-use mix | four shares (residential / commercial / industrial / institutional), integer, summing to a whole | `generation.land_use.share_*_pct`, each within `share_tolerance_pct` | which family appears at all along a street: `4_Generic_Buildings`/`5_Floor_Modular_Buildings`/`7_Villas` (residential), `9_Shopping_Center_and_Markets`/`16_Office` (commercial), `8_Worksite` (industrial -- the only dedicated industrial family the tileset ships; the industrial end of this range is thin by construction, not by design choice), institutional families per FR116 once a later story adds them |

Affluence reads as a swing: shuttered units are plainly present in the
bottom third (at least `shuttered_bottom_third_min_percent` of its
commercial frontage) and absent in the top third, and each end third holds
at least `pole_min_share_percent` of its high street's fill weight on types
the opposite end cannot hold. The shuttered unit is the only state carrier
the tileset allows; a retune of `vacant_unit`'s weight must keep that key
true.

Four carriers, four parameters, never shared: building *family* carries
Land-use mix; dwelling *form class* and plot packing carry Density; the
commercial frontage (and the dwelling type within a form class) carries
Affluence; facade *variant within* `4_Generic_Buildings` carries Building
age. Nothing here selects a sprite
family or facade variant -- no pass rasterises yet. "Their state" in the
acceptance criteria means age dressing plus shuttered units: the tileset
ships no damaged variants, so no tint, no overlay, no decay filter and no
new or edited sprites, now or later. A row that reuses a carrier already
claimed above is wrong on sight. Two neighbourhoods at opposite ends of a
parameter must be tellable apart from a single full-viewport screenshot
with no text; that test is owed once a pass rasterises, and
`tests/neighbourhoods.rs` holds the sim-side half now (below).

**Physical state and desirability.** Each building records its own age (its
neighbourhood's plus a small keyed spread, `building_age_spread`) and an
initial physical state, an integer 0 (worn) to 100 (kept): `((100 - age %) x
state_weight_age + affluence % x state_weight_affluence) / (the two
weights)`, so old and poor is worn and old and rich is kept. This story sets
the initial value only; nothing mutates it (initial generation is the one
authorless act -- no decay, no tick). Desirability, 0 to 100, is derived and
never stored: one pure function of a block's mean physical state
(`desirability_state_floor` is wholly undesirable, 100 is fully kept) --
affluence is not an input, or the loop short-circuits. Land use is already
per plot. Rent, demographics, citizen seeding and per-type dwelling
occupancy are not in this story.

**Crowding is derived, never a dial or a stored capacity.** A screen's
crowding is a proxy: every dwelling (a type carrying the tag named by
`dwelling_tag_id`) times `citizens_per_dwelling` plus every post times
`citizens_per_post`, over the buildings whose entrance falls in the window.
Both weights are terms of that street-crowding proxy, not an occupancy or a
headcount (the district houses about 5,000 citizens in about 585
residential buildings); the citizen-seeding story replaces the proxy with
real citizens. A screen is `viewport_width_cells` x `viewport_height_cells`
(1080p at 3x zoom and 16 px tiles, 40x22); the weights are set so a whole
screen averages NFR15a's one citizen per 52.4 cells (~17.6; the pooled
core, edge and whole-screen means are in the `pooled evidence` block). The
bounds that matter are pooled over that block's fixed seeds: a core is at least
`busy_core_over_city_min_percent` of the city's own mean screen, and an edge
at most `quiet_edge_pooled_max_percent_of_core` of the core. Two per-seed
keys only guard a wild deviation: a core at the top of the density range at
least `busy_screen_min_citizens`, an edge at most
`quiet_edge_max_percent_of_core` of the same district's core. The quiet
edge still gets continuous ground and pavement -- fewer things, never
missing things.

**Evidence.** [`docs/generation/neighbourhoods-seed-1.svg`](generation/neighbourhoods-seed-1.svg),
[`-2`](generation/neighbourhoods-seed-2.svg), [`-3`](generation/neighbourhoods-seed-3.svg):
four small panels per seed (density, age, affluence, land use) with every
block filled flat over the street network, age and affluence each a
single-hue ramp whose lightness carries the value (never a red/green pair);
then one boundary strip across the district's sharpest adjacent step -- the
window slid along the shared edge to hold the most frontage, both front rows
drawn whole around a framed one-screen window, the sides named upper/lower
or left/right -- plots, envelopes by derived class, a type marker on each
distribution subject, shuttered units hatched, an inner square per building
carrying its age and a dashed outline on a worn one -- with each side's
figures (density, age, affluence, frontage units, shop types, shuttered
share, citizens per screen) underneath. No text on a map; legends sit below.
Same regen-and-diff guard as the other passes.

## Rule scope and reads

Two columns on every rule row below read from closed vocabularies.

**`scope`** is the largest extent the engine must see to judge the
rule: `cell` (the subject and its immediate same-floor neighbours),
`room`, `building`, `neighbourhood`, `catchment`, `site`. A `catchment`
is a fixed-extent, world-absolute square (`generation.catchment_extent_
cells`) a `[[distribution]]` row is judged in on its own -- not a
neighbourhood, which is the arterial-bounded area carrying the dials. The
test for choosing: if generating more city next door (Epic 14) could change
whether an existing placement still passes, the rule is `neighbourhood`,
`catchment` or `site`; if it could not, the rule is smaller than that.
A `[[distribution]]` row's `scope` cell is its own `scope` data
(`site` or `catchment`). `site` is the
exception the city-grows design law above is about -- a row scoped
`site` owes its own row an answer to how it behaves when the site is
extended, stated in its intent or found in "Does not fit" below.

**`reads`** lists the neighbourhood parameters (by name, from the
table above, `+`-joined) whose value changes what the rule demands, or
`-` when none. A catchment-scoped `[[distribution]]` row may give its
number as a two-ended pair (`ratio_at_min`, `ratio_at_max`) read against
one named parameter (`reads = "affluence"`), integer-interpolated on the
catchment's own mean of that parameter over its `per` cells -- the idiom
`block_size_min/max_cells` already uses. It is data on the row: no curve,
no expression, no per-key branch, and `defs-build` refuses a read on a
`site` row. `server/sim/tests/rule_examples.rs` holds this column to the
rows: a row reads a parameter exactly when its `reads` cell names it.

## Passes

The spine is FR110's seven passes, coarse to fine. A pass not yet
implemented gets its heading and contract lines only, never speculative
rules invented to fill it. Rules are never grouped by building or
institution -- Institutions (FR116) are rows in the building-type pass,
expressed over tags exactly like everything else; a heading here named
after one institution would be the accreted-special-case shape this
document exists to prevent. Which rules a pass consumes is never
restated here: filter the `pass` column in the tables below -- a second,
prose copy of that mapping is exactly the kind of duplicate this
document's own opening paragraph forbids.

### Land use

- **Receives:** the city seed and the site bounds.
- **Hands down:** a coarse residential/commercial/industrial/
  institutional split across the site, and the spatial parameter field
  the whole city reads from then on: all four neighbourhood parameters at
  every point (`LandUseMap::at_world` -> `NeighbourhoodParams`) -- land-use
  mix and density from the coarse cells, including the centre-to-
  periphery falloff as a property of the field itself, and building age
  and affluence per neighbourhood (the ground between arterials,
  `Neighbourhood`/`LandUseMap::neighbourhoods`), one field and never a
  second. A grown neighbourhood (Epic 14) is a new region of the same
  field, adjacent to the one already there.
- **Reads:** nothing of an earlier pass -- it is the first pass. It reads
  pass 2's arterial lines through `streets::neighbourhood_rects`, a pure
  function of the seed that pass 2 itself draws first, so a neighbourhood
  edge and an arterial are the same line by construction.
- **Accepted as built (story 4.21):** the `share_*_pct` keys are shares of
  the site's coarse-cell *area*. They were applied to the BSP leaf count,
  and leaves are 9 to 36 cells, so a seed whose leaves near the density
  peak were all large got nearly twice its commercial land: seed
  `16021368561388801292` had commercial at 33.3% of the site against
  `share_commercial_pct = 18`, with pass 5's per-use workplace ratios
  unchanged, and 539 workplaces against a 171-514 band (about 6.5 sigma).
  Pass 1 now targets `round(coarse_cells * share / 100)` cells per use
  and takes a leaf only if it brings the claimed area closer to the target
  than stopping would (overshoot at most half a leaf); every growth
  constraint is unchanged. `land_use.max_recursion_depth` had been binding
  at 8 (leaves up to 8x11 cells) and is now a termination cap of 20, so
  leaves are 3 to 6 cells per axis as `max_leaf_cells` says. Widening the workplace band to cover the seed
  was refused: it would accept a city with double the designed commercial
  land, against the Scale Baseline and the share keys both. Area shares
  moved the pooled means, so residential/institutional are 61/7 (were
  58/10), and the guard now lives at the pass that owns it
  (`land_use.share_tolerance_pct`, 6 points). `workplace_count_tolerance_
  percent` is re-derived 50 -> 40 from the post-fix sigma (29.9 -> 21.3)
  by the same 5.5-sigma rule; `count_tolerance_percent` stays 21. An
  outlier CI finds is diagnosed to the pass that owns it and pinned as a
  plain `#[test]`, never absorbed by re-measuring a tolerance to cover the
  sample's new max.
- **Evidence:** [`docs/generation/land-use-seed-1.svg`](generation/land-use-seed-1.svg),
  [`-seed-2`](generation/land-use-seed-2.svg), [`-seed-3`](generation/land-use-seed-3.svg)
  -- flat colour per coarse cell (land use), density carried as opacity,
  a legend for the four uses; three seeds so the rules read as rules and
  not one lucky roll. Regenerated and diffed by `bounds/tests/generation_
  evidence_current.rs` (`cargo run -p bounds --bin dump-generation`
  regenerates it).

### Street network

- **Receives:** the land-use split and the parameter field.
- **Hands down:** the street graph (carriageway, pavement, kerb) blocks
  are subdivided from.
- **Reads:** density, land use.
- **Evidence:** [`docs/generation/street-network-seed-1.svg`](generation/street-network-seed-1.svg),
  [`-seed-2`](generation/street-network-seed-2.svg), [`-seed-3`](generation/street-network-seed-3.svg)
  -- one land-use tint per finished block (majority coarse-cell area,
  never per coarse cell -- a change of tint only ever falls at a real
  block edge), the street graph on top by tier (arterial/street/lane), a
  combined legend, and two 40x22-cell viewport outlines (one at the
  density peak, one at the farthest periphery) so the per-screen reading
  is judgeable directly from the image; same regen-and-diff guard as the
  row above. Plus one worst-case-seed picture per entry in `streets::
  PINNED_DETOUR_SEEDS` -- [`docs/generation/detour-worst-seed-
  610140160610395379.svg`](generation/detour-worst-seed-610140160610395379.svg),
  [`-4595557621078204092`](generation/detour-worst-seed-4595557621078204092.svg),
  [`-6482608135473407511`](generation/detour-worst-seed-6482608135473407511.svg)
  -- the same street-network render (same tints, same tier styling, same
  legend, same two viewport outlines) with an overlay: that seed's own
  worst *exhaustive* pair (`detour_samples(usize::MAX)`'s own argmax,
  the population `max_detour_excess_cells` is keyed against, never the
  cheap `DETOUR_SAMPLE_MAX_NODES` sample) as two markers, the shortest
  street route between them as one solid stroke, the Manhattan L between
  them as one dashed stroke, both in a colour no tint or tier already
  uses, and the excess in cells on its own legend row, so the actual
  route is checkable by looking, not just asserted. An 8-cell margin
  around the site (overlay files only) keeps a boundary-sitting marker
  or dashed stroke from ever being clipped by the canvas -- every pinned
  seed's own worst pair ends on a boundary exit, so this is the common
  case, not the exception. Same regen-and-diff guard, a separate file
  set from the twelve above (never a byte of those twelve moves when
  only these three are added or a pinned seed changes).

### What binds block size (story 4.22)

A block's size is bound by `target_block_size`/`target_block_depth`
(density) and by one region rule: `subdivide` splits a rect for a
region's sake only when the rect *encloses* one (some region under it has
no coarse cell reaching a street-abutting side, `generation::block_sides`
-- a side on the site boundary has no street) or *swallows* one (at least
a quarter of a region's cells lie under the rect and its land use is not the
rect's majority land use, so the block holding most of the region would
not carry it). A land-use boundary through a block's interior is neither,
and the rect is left to density. A thin strip (short side under half the
target) may run to `thin_strip_long_side_percent` of the target (150) before it is cut, so a boundary strip
splits into halves near the target, never into pieces shorter than it.
The earlier rule split on any rect
covering two regions; pass-1 leaves are 3-6 coarse cells, so peripheral
blocks were chopped to region size whatever the density said.
`StreetNetwork::low_band_chopped_blocks` counts low-band blocks at or
under a quarter of their local target's area (the pooled share over
seeds 0..256 is in the `pooled evidence` block below) and
`peripheral_blocks_pooled_chopped_share_stays_bounded` bounds it, so a
ratio that looks fine cannot hide a chopped periphery.
`block_size_max_cells`/`max_block_depth_max_cells` are tuned with it to
the Scale Baseline building count.

The 2x bar -- peripheral mean block area at least twice the central --
is Artie's, judged by `mean_area_by_density_band` on the three committed
evidence seeds (1, 2, 3), which do not change to fit a measurement. It
is 2x because a 1.5x area is a 1.22x side, invisible on a 40x22-cell
viewport, while 2x is a 1.41x side: the floor at which a player walking
outward sees one fewer street crossing per screen, so leaving the core
reads by looking, not by a HUD. The three ratios are in the `pooled
evidence` block below.

### The detour-excess bound (story 3.18)

`generation.streets.max_detour_excess_cells` has no tight structural
bound to derive: a guillotine partition can lay running bond (full-width
cuts, independently jittered cross cuts), so a straight crossing is
blocked at every course and excess grows with distance travelled, not
with block size, and leaf size is not capped at `block_size_max_cells`
either (`try_split` refusal, `max_lane_splits` and `max_recursion_depth`
can all leave an over-target leaf). Two earlier formulas here (a 2x, then
a 3x multiple of `block_size_max_cells`) were each a story fitted to the
last failing seed, not a derivation -- including "T-terminated dead-end
spur", which named the wrong mechanism: the degree-1 node a worst pair
ends on is the *ordinary* boundary exit every street has -- there is no
perimeter street (`generation::block_sides`, `docs/architecture.md`'s
Generation section: a block side abuts a street iff it does not
coincide with the site's own boundary), so every street simply ends at
the boundary, reached one way, never a special spur case.

The three pinned seeds' own worst-case pictures (linked above) each end
on a boundary exit (`detour_excess_holds_at_pinned_boundary_exit_seeds`
pins that). The mechanism analysis -- one large peripheral block with a
couple of minor jogs, or running bond, a staircase of many short jogs --
was made on the pre-story-4.21 seeds and not repeated for these. A
picture that instead showed a block with no way through, reading as a
wall, would be a pass-2 finding, not evidence for this key.

`max_detour_excess_cells` is a *measured* value, re-derived by `cargo
run -p bounds --release --bin measure-generation`: the exhaustive-pair
max (every non-both-boundary node pair, not the cheap 14-node sample
`inv_generation_detour_ratio_bounded` checks on arbitrary seeds) over the
`exhaustive loop` block's mixed seeds, times 1.25, rounded up to a multiple
of 8 -- the block carries the current run's numbers. `GenerationConfig::from_balance` separately
refuses a value over `4 * block_size_max_cells + 2 * arterial_width_cells`
-- a loosening guard that scales with the block keys, never a worst-case
claim.

**What actually protects master.** `inv_generation_detour_ratio_bounded`
runs on arbitrary seeds, in every CI run, but only ever samples the
cheap 14-node width -- its own worst reading sits a few cells under the
exhaustive figure the key is set from (both are in the `exhaustive loop`
block). That gap is not the margin; the margin is the stated 1.25 factor,
nothing else, over a tail that is still growing: the ten largest per-seed
worsts are in the same block. A future run finding a new worst above the
key remains possible -- that is what re-measuring on a retune, and
pinning what a random sweep finds, both exist for.

For scale: the worst pinned seed (`610140160610395379`) is about eight
viewport-widths of extra walking for the worst pair of the worst city in
the `exhaustive loop` block -- accepted as a rare tail. That figure still
has one foot on the site boundary, though, where the city stops and
almost nobody stands; the same block's worst pair with *both* endpoints
off the boundary -- the player-felt figure -- is a few cells under it
(`detour_excess_cells_exhaustive_both_endpoints_interior`). The maze
fixture `a_maze_fails_dead_ends_and_detour` (a U-shaped corridor, no real
route through) overshoots by 600 cells, real margin over the committed
value and a stated distance from "our worst real city" to "a maze", not
just a pass/fail. If a future re-measurement moves the exhaustive max
itself well past the current one, that PR owes the new worst seed's own
picture and Artie's own judgement again on whether the result still
reads as a city.

### The detour bound is one function of distance, not two with a seam (story 15.10)

Seed `8872365549107643721` failed `inv_generation_detour_ratio_bounded` on
CI run 36388555866 (PR #349, which touches none of passes 1-2, so it
fails the same way on master): the pair `(152,0)`-`(393,18)`, Manhattan
259, had a 204% ratio against the old `max_detour_percent` (200%), while
its own network distance (529 cells) sat comfortably under `manhattan +
max_detour_excess_cells` (675). Derek's finding: under the old AND-with-
threshold contract, the allowed additive excess dropped from 416 cells
at Manhattan 255 (just short of the old `detour_long_pair_cells`, 256)
to 259 cells at Manhattan 259 (just past it) -- a non-monotonic budget
that permitted *less* excess to a longer pair than to a shorter one. No
value of `detour_long_pair_cells`, `max_detour_percent` and
`max_detour_excess_cells` together could make that AND both non-
redundant (short of the threshold, the ratio was already implied by the
excess bound -- Quentin's cycle-3 finding at the old threshold of 128)
and coherent (the seam above, at any threshold): the threshold itself
was the defect, not either number either side of it.

**The choice.** No `streets.rs` change: a pass-2 change that makes such
a pair impossible would constrain the same two mechanisms (one large
peripheral block, running bond) `max_detour_excess_cells` already
accepts at 416 cells, moving every golden and every evidence SVG to
serve a test inconsistency, not a generator defect. Instead, the two
ceilings become one function of distance that never permits less at a
longer range than at a shorter one: `network <= max(manhattan +
max_detour_excess_cells, manhattan * max_detour_percent / 100)`, for
every sampled pair, no distance threshold of its own
(`streets::detour_bound_violation`, the one place the comparison lives,
called by `inv_generation_detour_ratio_bounded`, its pinned regression
and the sweep below). `detour_long_pair_cells` is gone entirely --
deleted from `defs/balance/generation.toml`, `GenerationConfig`, this
document's own balance table and the trace matrix. The range where the
ratio term actually binds is now derived, never a third committed key:
`GenerationConfig::detour_ratio_takeover_distance_cells` is
`max_detour_excess_cells * 100 / (max_detour_percent - 100)`, 400 cells
today -- coincidentally the same figure as `max_detour_excess_cells`
itself, since `max_detour_percent` (200) makes the ratio term exactly
`manhattan * 2`. `max_detour_percent` returns to its pre-story value,
200, and is once again the site-scale-free long-range claim 3.11's
estimator relies on: real margin (below) over the real, previously
unmeasured, long-range tail, not a number re-expressing the excess
budget at an arbitrary distance. The ratio assertion can still never go
red on any seed unless the excess assertion already did -- exceeding the
max() of two terms means exceeding both -- but that is a property of the
max() contract for every pair, at every distance, not a floor derived
from one committed key and refused by another.

Seed `8872365549107643721` is pinned as a deterministic regression
(`seed_8872365549107643721_holds_the_detour_ceilings`): it must clear the
committed max()-contract. Its original `(152,0)`-`(393,18)` pair no longer
exists -- story 4.21's area-share land use moved every pass-2 network --
so the pin no longer asserts that pair's figures; the seam itself is held
by the max() contract's own definition.

### The p99 detour bound is a fill of the max() contract

Seed `8619285945825134650` has a 206% p99 detour *ratio* against the old
`p99_detour_percent` (200). `measure-generation p99 8619285945825134650`
lists the 64-node sample's pairs at the p99 rank: every one of them is a
long peripheral crossing ending on the site boundary (Manhattan 126-436
cells, 150-300% ratio, at most 250 cells of excess, at most 80% of its own
max()-contract allowance), the large-peripheral-block mechanism
`max_detour_excess_cells` already accepts; none fails `detour_bound_holds`.
The generator is not defective -- the statistic was: a bare ratio holds a
short pass-2 crossing to a stricter contract than the one the worst pair
is held to.

**The choice.** No `streets.rs` change; goldens and evidence are
byte-identical. The p99 bound moves onto
the committed contract: a pair's *fill* is `network * 100 /
DetourSample::detour_allowed`, and `generation.streets.p99_detour_fill_percent`
bounds the 99th-percentile fill over the 64-node sample, strictly under
100 (`streets::p99_detour_violation`, the one place the comparison lives;
the proptest, the pinned seed and the sweep all call it). The seed's p99
fill is 71%.

**p99 margin rule.** A perfect route at or beyond the takeover distance
already fills 50% (allowed is `2 * manhattan` there), so only the share
of the worst measured p99 fill above that floor can worsen: scale that
share by 1.25, add the floor back, round up to a multiple of 5. The
worst per-seed p99 fill (the `detour-bounds sweep` block) is 84% (seed
`11161877730662506814`, pinned in `streets::PINNED_P99_FILL_SEEDS`):
(84 - 50) * 1.25 + 50 = 92.5, rounded up to 95, which is committed.
`p99_detour_fill_percent_matches_its_own_margin_rule` derives it from the
pinned figure and fails if the key drifts. If a future sweep's worst
makes the rule give 100 or more, the key cannot take it, and that is the
pass-2 question, not a number to fit.

**What the ratio p99 guarded and the fill p99 does not.** The old p99
bound held the typical pair's detour *ratio* regardless of distance. The
fill is measured against `max(manhattan + max_detour_excess_cells,
manhattan * max_detour_percent / 100)`, so below the takeover distance the
additive allowance dominates: a Manhattan-100 pair can run at 300% ratio
(network 300) and sit at 60% fill (allowed 500). A city whose short and
medium pairs all doubled their detour would pass both detour checks.
Short-pair ratio regressions under the additive allowance are not guarded
by either check; anything that relies on the Manhattan estimator for
short and medium pairs (the pathfinding estimator, story 3.11) must not
assume they are.

**Coverage gap.** No generated seed is known where the p99 fill bound
fires while the max() contract holds, so the firing path on a real
network is covered by a hand-built U corridor
(`a_u_corridor_near_its_allowance_holds_the_max_contract_but_breaks_the_p99`)
and the unit tests on hand-built samples, not by the proptest.

### Plot subdivision

- **Receives:** a street-network block and the land-use field (each
  block's own land use and density) -- a pass reads every earlier pass's
  output it actually needs, never only its immediate predecessor's.
- **Hands down:** individual plots within the block, each recording its
  own front-facing side, land use and density. Faces are cut in a fixed
  order -- south, north, east, west, regardless of street tier -- and
  the face cut first takes the corner, so a south-facing corner plot
  (facade to the camera) is the wider one, and a corner plot is cut
  wider by exactly the inset its corner edge carries. Opposite rows run
  through to the block's mid-line and meet; a core at or under the
  density-interpolated ceiling (`max_core_depth_cells` at the peak,
  `max_core_depth_periphery_cells` at the edge -- deep gardens there) is
  absorbed into the rows as rear yard, and only a core past it stays
  open, as one explicit, recorded `open` plot (a future yard, park or
  car park) whose short side always clears `open_min_side_cells`. A face
  remainder too short for one module is never a plot of its own: it is
  absorbed into the rows beside it. A block with no street frontage at
  all, or too small on some axis for one module, yields one whole-block
  `open` plot rather than a landlocked or unbuildable one.
- **Reads:** density, land-use mix.
- **Evidence:** [`docs/generation/envelopes-seed-1.svg`](generation/envelopes-seed-1.svg),
  [`-seed-2`](generation/envelopes-seed-2.svg), [`-seed-3`](generation/envelopes-seed-3.svg)
  -- shared with the building-envelope pass below: the street-network
  SVG's own block tint and streets as the backdrop, every plot's outline
  on top (`open` ones hatched, front edge a heavier stroke), a legend;
  same regen-and-diff guard as the rows above.

### Building envelope

- **Receives:** a plot.
- **Hands down:** a building footprint -- at this story, an abstract
  outer rectangle only (no wall cells, no entrance cell yet; the sealed
  exterior shell lands with the story that first rasterises one, which is
  what `front` is recorded for), or a typed rejection when the plot
  cannot hold its own land use's minimum usable interior -- never a
  footprint shrunk below that minimum. The footprint fills its plot's
  full available width exactly (variety comes from the plot rhythm, never
  from shaving the frontage) and its available depth minus a small keyed
  trim; every envelope on a block sits the same setback behind its own
  street edge, and a corner envelope sits flush to both streets' build
  lines. At or above the density threshold the gap between neighbours
  is 0 (party walls); below it, the committed side gap exactly -- never
  1 cell.
- **Reads:** density, land-use mix (not building age: pass 5, building
  type, has not run yet, so the "intended type" this pass sizes against
  is the plot's own land use).
- **Evidence:** the same three files as the plot-subdivision pass above
  -- every plot's own yard (a lighter tint, `open` ones hatched, rejected
  ones hatched distinctly) and every placed envelope (a darker, opaque
  fill, a door tick on its own front edge), plus two residential insets
  at viewport scale (the residential block nearest the density peak and the
  farthest one, each panel anchored on the block's street-facing side so
  it shows the street with the block's front row and yard behind it, so
  plot packing alone is what differs) since a 12x11 envelope is
  unreadable at 512-cell scale; same regen-and-diff guard.

### Building type

- **Receives:** every placed envelope (pass 4) and each one's own plot
  (pass 3, for land use and density).
- **Hands down:** a `defs/building-types/*.toml` id per placed envelope
  -- never a Rust category. "Institution", "workplace" and "residential"
  are all *derived*: a workplace is any type whose own `professions`
  list is non-empty; a municipal service is any type carrying the
  `municipal_service` tag; a dwelling is any type carrying `dwelling`.
  Placement is two steps: a weighted draw among every *hard*-eligible
  type for an envelope's own plot (land use, density band, minimum
  interior, every `requires_site` context it demands), then a
  distribution-row override for each named institution (depot, council,
  hospital, welfare office, shelter, and, since story 15.9, cafe), read generically off the
  committed rule set (`sim::rules::RuleDef::as_distribution`) in
  ascending rule id order -- never a hand-named placer. A row's target is
  `sim::rules::distribution_target` over its `per` count, the figure
  `evaluate` judges it by: the whole site for a `site` row, each
  catchment on its own land for a `catchment` row. Within a pool,
  candidates rank by how many of the subject type's own `prefers_site`
  contexts they match, then `density_affinity`, then a seeded draw key --
  never a shuffled list taken greedily. A catchment whose land cannot
  hold what it owes is left short and `check_rules` returns a typed
  `GenerationError`, never a silently missing institution.
- **Reads:** density, land-use mix and affluence, plus each envelope's
  own structural site context (a corner, and the street tier its front
  faces) -- a type's own `requires_site`/`prefers_site` read this, never
  a content key reaching the generator (a closed, generator-derived
  vocabulary, the same standing as `land_uses`). Affluence gates a type
  through an `affluence_min`/`affluence_max` band on `[[building_type]]`,
  the same shape and the same generic eligibility filter as the density
  band; bands are wide and overlapping and full-range by default, and only
  end types are banded (`launderette` and `vacant_unit` toward the poor
  end; `bookshop`, `gym`, `hotel`, `restaurant` and `villa` toward the
  rich end; `cottage` is the poor-end dwelling of the sparse edge, so a
  low-density neighbourhood in the bottom band still has homes). A trade
  hosted only by end-banded types may be absent from a district whose
  commercial land lies wholly at the other end (a town's trades follow its
  money); no launch job (FR14) may be such a trade, and the set is counted:
  at most `max_end_stranded_professions` per end, held by a test, so banding
  a type that strands another trade fails until it is decided on purpose. `defs-build`'s coverage check runs over land use x
  density x affluence, so the fill stays total. Building age never gates a
  type: each building records its own age and initial physical state
  instead (`BuildingTypeMap::states`).
- A welfare office or shelter is not a dwelling: it carries no `dwelling`
  tag, is eligible on every land use, and where it stands on a house it
  replaces that dwelling. Replacing a `per` member changes the basis its row
  is judged on, so the generator re-reads what the row owes from the types as
  they now stand and tops the catchment up (a few rounds at most), and a
  catchment's ceiling is at least one above `expected`.
- Accepted as built, recorded so nobody relitigates it: one residential
  building = one dwelling for `per` purposes (Tim's unit). It
  understates the dense core's own need -- a `condo_block` owes what a
  `villa` owes -- and a dwellings-per-type count becomes unavoidable
  once citizens are seeded onto housing.
- Accepted as built, story 15.9: cafe is a distributed type
  (`cafe.weight = 0`, `cafe_present` in `defs/rules/generation.toml`),
  not ordinary weighted fill. FR14 makes the barista a launch job, and
  FR116 lists cafes among the placed institutions -- a city with zero
  cafes was a real, if rare, content defect
  players would read as the game being broken, not a quirk of the site,
  so "at least one cafe" is a real requirement, expressed the way every
  other required kind already is rather than left to the fill's own
  luck. Shops stay ordinary weighted fill, a likelihood and not a
  guarantee: a row over a tag many types share would pick the type by
  hand and erase the variety the fill exists for, and a shopless
  neighbourhood is intended friction, so no invariant asserts one.
- **Evidence:** [`docs/generation/building-types-seed-1.svg`](generation/building-types-seed-1.svg),
  [`-2`](generation/building-types-seed-2.svg), [`-3`](generation/building-types-seed-3.svg)
  -- envelopes tinted by a derived, structural class (no per-key branch
  and no hash: is the `per` basis of a distribution row, housing; is
  named by a coherence row's own `subject`/`within`, the two form
  extremes; has posts, workplace; both housing and posts, mixed use;
  none of these, vacant/yard -- six fixed classes over a fixed palette,
  so no two unrelated types can ever collide onto one swatch), a
  distinct marker for every type that is the subject of a committed
  distribution row this pass actually feeds (map and legend read the
  shape from the same row list and the same index), a dashed catchment
  grid with a pink wash over a physically-short catchment (no text on
  the map itself -- the per/owed/placed figures live in a panel below
  it, one line per catchment, so labels never cover a building), legend
  derived from what the district actually places; same regen-and-diff
  guard.

### Interior layout

- **Receives:** every placed envelope (pass 4), its assigned building
  type (pass 5) and its plot (pass 3, for the street edge the entrance
  walks out to).
- **Hands down:** one outcome per placed envelope, in envelope order --
  a laid-out ground floor (rooms as rects, thresholds, required
  fixtures, the entrance's approach; walls are the footprint minus
  rooms and thresholds, never stored), a solid `Shell`, or a typed,
  counted `Rejected` with no interior at all. All of it in world
  coordinates on the street's own tilemap: the interior of a building at
  `(x, y)` is found at `(x, y)`. Ground floor only: upper storeys and
  back doors are later additions. Tags and cells, never an object or a
  sprite -- which def stands a fixture, and so its sprite, is the prop pass's.
- **Reads:** the type's room program, the footprint and its own front,
  the plot's front edge, and the committed requirement rows. Not
  affluence: no pass has authored it on the field yet, and this one
  neither reads nor imitates it.
- **Enterable is a consequence, never a selection.** A building is
  enterable exactly when it was laid out: its type has a room program
  and its footprint held it. There is no quota and no "best hundred";
  the district clears `generation.interiors.min_enterable_count` (FR114's
  figure) by a wide margin, and `generate` fails below it. A building is
  a `Shell` only when its type has neither `professions` nor the
  `dwelling` tag (a workplace nobody can walk into is a mechanical seam
  between an AI-held and a player-held post), enforced at defs build. A
  building that is the subject of a committed distribution row and comes
  out `Rejected` is a typed error: an institution that cannot be entered
  is a missing institution. One street entrance per building.
- **A program is a core plus a tail.** `rooms` is the required core, front
  room first; `optional_rooms` an ordered tail, of which the footprint
  takes the longest prefix some plan fits -- size buys rooms, not bigger
  rooms. Every dwelling's core sleeps, washes and cooks: the small
  dwelling's front room is a kitchen-diner, and a separate kitchen and
  living room are what size buys.
- **Three plans, every room under the aspect cap.** No room's long side
  is more than `generation.interiors.max_room_aspect` times its short
  side; every plan is sized under it and an attempt past it is refused.
  *Band*: the front room across the full width, a partition, the back
  rooms side by side behind it. *Column*: the front room a full-depth
  column holding the entrance, the back rooms stacked front to back on
  either side of it. *Two rows*: the front band, a first row of back
  rooms, and a second row behind -- a second-row room reached through
  the first-row room in front of it, only when the two share an access;
  a first-row room with nothing behind it runs both rows' depth. A room
  owing `sleeping` has nothing behind it but a bathroom, and a bathroom
  has nothing behind it (a room type's `rear` list in
  `defs/room-types/*.toml`), so a bedroom is never a way through. Every
  room is sized for what it owes, its doors and a lane.
- **Access is a room-type tag:** exactly one of `public`, `staff` or
  `private` per room type -- what "back room" means (a staff room), and
  what keys, opening hours and the guard's door round read later. From
  the entrance every public room is reachable without crossing a staff or
  private room, and a type with a public room has one as its front room.
  Room-to-room reachability is not one of the five rule kinds; it is held
  as an invariant over tags (see "Does not fit").
- **What a room owes is rows.** Each room type's own tags name the
  requirement rows it owes (`defs/rules/interiors.toml`); the pass places
  exactly the fixtures those rows ask for and the one engine judges the
  result (`evaluate_local`). The line between this pass and prop
  placement is one test: a fixture a citizen will act at to meet a need
  or hold a post belongs here; anything only looked at belongs to the
  prop pass. `stock` is an empty container in a staff room -- no item, no
  quantity, no cash in any till; the light has no on/off state. Every
  fixture has a walkable cell beside it, reachable from the entrance.

| Room type's function | Anchors the pass places |
| --- | --- |
| sleeping | a bed |
| cooking | a cooker |
| washing | a basin, a toilet |
| dining | a table set |
| trading (a public floor that sells, serves or receives) | a till or service counter |
| seated service | two table sets |
| working | a desk |
| making | a workbench |
| staff (any back room) | a stock fixture |
| every room | a light |

- **Composition (camera-driven).** The south wall retracts, so the north
  wall is the display wall. A doorway's cell and the cell either side of
  it stay clear, and every fixture keeps a lane to the entrance at least
  one cell wide; no room is narrower than two walkable cells. The entry
  room of a dwelling is its kitchen-diner, never a bathroom; businesses
  put the public room on the street side and staff and stock behind it.
- **Fixture placement.** Each anchor tag carries a placement class
  (`defs/tags/*.toml`'s `placement`), and the pass places by class, never
  two fixtures in adjacent cells where the room allows. *Wall-backed*
  (bed, cooker, basin, toilet, desk, workbench, stock): along the north wall,
  then the side walls, centred first, in a corner only in a room two
  cells wide. *Free-standing* (table set): on the open floor away from
  every wall, nearest the centre, in a room three or more cells each way.
  *Wall-mounted* (light): on the north wall row, centred, never in a
  corner. *Facing the door* (counter): on the wall across from the
  room's door -- or, when that wall is a partition, the side wall
  nearest the door -- centred, with the cell between it and the door
  kept walkable. The prop pass dresses around these anchors.
- **Variety** comes from the plan (band, column or two rows), the
  footprint-driven sizes, mirrored arrangements, the order of the back
  rooms and the choice of fixture cells, all drawn from a stream seeded
  by the building's own bounds and the attempt index -- never list
  position, so a retry in one building never shifts its neighbour. A
  building the rule engine refuses is rebuilt, up to
  `generation.interiors.max_layout_attempts`, then `Rejected`. Every
  attempt builds the longest program the footprint fits; the last also
  falls back through the shorter programs, down to the required core, so
  a footprint whose longest program no randomised plan realises still
  gets its core rather than a missing institution.
- **Toilet.** A `washing` room owes a toilet beside its basin (a
  requirement row over the function tag, like every other anchor), so a
  bathroom reads as one at 16 px. Pass 7 stands it.
- **Ownership.** Each building's footprint is a `building_area` (walls
  included) and each room's floor plus the doorway it owns a `room_area`
  (several rects sharing one room id; never a wall), emitted through
  `clip_rect_to_chunks` with position-derived owner ids, so growing the
  city next door never renumbers an existing building. Nothing in the
  ownership data encodes building = tenancy: a later unit groups stable
  room ids.
- **Evidence:** [`docs/generation/interiors-seed-1.svg`](generation/interiors-seed-1.svg),
  [`-seed-2`](generation/interiors-seed-2.svg), [`-seed-3`](generation/interiors-seed-3.svg)
  -- the enterable set as a footprint map tinted by derived kind (housing,
  commercial, industrial, institutional; a shell grey, a rejected
  building red), then a contact sheet of twelve laid-out interiors per
  kind side by side at viewport scale (rooms as rects, never one element
  per cell), and a legend of every room type and fixture; same
  regen-and-diff guard as the rows above.

### Prop placement

- **Receives:** every earlier pass: each envelope's interior (pass 6), the
  street network (pass 2, for the pavement) and the committed rule rows
  and object defs. A pure function of those and the seed.
- **Hands down:** one row per placed object -- a def id at an anchor cell
  (the footprint's south-west corner) on a floor, with its layer and
  orientation: exactly the columns of `placed_object` minus the surrogate
  id and the chunk key, so a later story that makes a district live maps
  them one to one. Never a width, a height or a collider: a row's extent
  and collision are its def's. The list is walls (a building's footprint
  minus its rooms and thresholds; a whole solid cell for a shell or a
  rejected building), every pass-6 fixture resolved from its tag to a def
  carrying it, the glazing a counter owes on its street wall, and the
  street furniture. One emitter, one list; this story does not write
  `placed_object` (`create_district` still discards the plan).
- **One collision map.** The district's collision is the rasterisation of
  those rows' def colliders: one tile-granular `FloorCollision` per floor,
  a cell blocked iff a collider touches it, composited once at the end of
  the pass and cached on the `PropMap`. A def with no collider contributes
  nothing (FR128). No later pass, reducer or test infers blocking from a
  key, a layer or a sprite (`scripts/ci/check-no-runtime-collision-
  inference.sh`). Per-floor materialisation and patching are story 3.8's.
- **Reads:** which side of the door a def belongs to (the
  `indoor_props_never_on_the_street` / `outdoor_props_never_indoors`
  coherence rows: a def only ever stands where neither bars it, and only
  if it carries one of the two), what each room and the street owe (the
  requirement and distribution rows), `density` on the street (props per
  screen), and the `generation.props.*` dials. Not affluence and not
  building age: age is the facade's, and a prop carries no state to show
  it; which candidate stands is a seeded draw, never a theme branch.
- **Defs by tag, never by key.** A fixture's tag is resolved to a seeded
  draw among the defs that carry it and may stand on a floor. Each anchor
  tag has two variants of its natural footprint and, where that is more
  than one cell, a compact 1x1 variant; the natural ones are tried
  first, anchored so the whole footprint stands on its room's floor,
  clear of every doorway and the cell either side, the approach and every
  other fixture -- refused or moved, never clipped -- and at most
  `generation.props.max_solid_percent_of_room_floor` of a room's floor is
  solid. A building whose natural footprints leave a region the player
  body cannot reach has its fixtures go compact one at a time -- the one
  whose compact variant alone clears it, else each in turn until it is
  clear -- those that had already fallen back staying compact. A tag no
  def carries is a
  typed `FixtureUnplaceable`, never a fixture left out.
- **The street.** Pavement is each edge's two bands
  (`generation.props.*_pavement_cells`), the rest carriageway; a crossing
  street's carriageway keeps its cells. Every cell of it carries
  `pavement` and `footway` (a doorstep carries `pavement` alone), so the
  lighting row is stated over the street's own pavement. Furniture stands only on
  pavement, never on a building's footprint, the approach or a cell
  beside it, and leaves a walkable pavement cell in every cross-section
  (a lamp may stand on a one-cell lane pavement: the carriageway beside it
  is walkable). Three sources of density, each a rule, so clustering is a
  consequence and never a mechanism: *cadence* (the `street_is_lit` row:
  lamps every `generation.props.lamp_cadence_cells` on the kerb-side row
  of each side of a street, the two sides staggered half a cadence, kept
  `min_spacing` apart; then any footway cell still out of `max_distance`
  of a lamp gets one on the nearest free footway cell, judged exactly as
  the row judges -- site-wide, catchment lines ignored -- and a cell no
  footway cell can cover is a counted skip, never a lamp in a yard);
  *ambient* (singles, and now and then a pair: benches, trees, planters,
  offered per 100 cells of building-side run from
  `generation.props.ambient_per_100_cells_at_density_min` at the periphery
  to `..._max` at the core -- provisional, to be re-judged the day the
  city is walkable); *companions* (the `waste_per_three_seating` row,
  allocated the way pass 5 places a distributed institution: every seat
  within `max_distance` of a bin in its own block, each bin where it covers
  the most uncovered seats and `min_spacing` from the others, and when the
  count would pass the row's upper bound the bins covering the fewest
  seats go with the seats nothing else covers). A def that carries a tag
  any row names as a subject or a required fixture is never ambient: it
  stands only where its row owes it.
- **Seats at a table.** A seated table (the round tables; the stool owes
  none) owes chairs beside it (`table_set_has_a_chair`,
  `..._second_chair`: distribution rows over the `seated_table` tag, judged district-wide because the layout pass judges
  every other kind per building before any chair stands). A chair is
  underfoot (no collider), on a free floor cell next to the table, or on
  the nearest free cell within the row's reach, never beside a doorway
  and never on another prop's cell; a table with no free cell in reach is
  a counted skip (`attendants_unplaced`), and the row then fires in
  `check_rules` rather than a chair stand on a fixture. A room's light is
  a standing lamp or a glass lamp, underfoot with no collider: a
  wall-hung light is a wall-layer row, which this pass cannot stand
  without moving `room_has_a_light` off the room area.
- **Carriers, never consequence.** Every prop is placed in its empty,
  default state: an empty bin, a till holding no cash, bare shelves, no
  litter, no poster, no boarded window. Those states have authors in the
  sim. A dressing def never carries a pass-6 anchor tag, so a room never
  gains a second till or a bed nobody's program owed.
- **Reachability.** `District::check` appends `check_reachability`: each
  building's rows over its footprint and the first approach cell, and each
  pavement band that carries furniture over its band, the face row behind
  it and the first carriageway row. A window whose every free cell is
  reachable over whole cells passes (sound while the player body fits a
  cell and no collider leaves its own footprint -- both tested, with a
  differential against the exact check); any other window is rasterised
  through the real colliders and `enclosed_regions` (on the body-eroded
  grid, so a sliver a collider leaves beside a wall is not a region) and
  `narrow_passages` at the player body must report nothing. The
  invariants judge with their own oracle, never the shortcut. Never the
  whole district at sub-cell resolution.
- **Skips are typed and counted** (`PropSkips`): a compact fallback, a
  building re-placed with compact fixtures, a table with no free cell for
  its chair, a shopfront with no clear stretch of
  street wall, a street piece with no fitting cell. None fails generation.
- **Known debt, for the story that makes a district live:** a bed is 1x3
  over 16x48 art because the atlas loader refuses a several-row sprite
  that is not exactly its footprint tall; a 1x2 bed with the headboard
  overhanging the wall needs that overhang supported client-side.
- **Not in this story:** upper storeys and anything above floor 0, dressing
  beyond the toilet and a table's chairs (a fridge, a wardrobe, a sofa, a
  bath), litter and every other consequence state, named signage and
  tenancy, back gardens, seasonal or time-of-day dressing, anything on the
  subway floor, and a client consuming the rows (placements do not reach
  the client here). **Owed to the story that makes a district live:** the
  ground, floor and threshold objects -- the rows are walls, fixtures,
  shopfronts and furniture, so a district written from them alone has no
  floor under its rooms and no doorway arch; and the rows per chunk are to
  be measured before any are written (a shell or rejected building is one
  wall row per footprint cell, the largest single contributor).
  **Known debt:** a glazing unit is drawn along `x`, so a building fronting
  east or west gets none: about 31% of the buildings holding a counter
  over seeds 0..7, and with the few whose street wall has no clear
  stretch, roughly a third of shops (2002 counters, 1352 shopfronts)
  do not read as shops from the pavement.
- **Evidence:** [`docs/generation/props-seed-1.svg`](generation/props-seed-1.svg),
  [`-seed-2`](generation/props-seed-2.svg), [`-seed-3`](generation/props-seed-3.svg)
  -- a core street window and a periphery street window at viewport scale
  (40x22 cells: pavement, carriageway, footprints, every prop as its
  footprint rect tinted by def with its collider hatched), then a contact
  sheet of dressed interiors by kind (each prop's footprint tinted by def,
  collider hatched) and a legend of every def shown; same regen-and-diff
  guard as the rows above.

### Macro routing graph

`District::graph` derives it from the finished district (`sim::routing::graph`), once, and
`District::check` validates it. Transit nodes are the street network's junctions and dead ends plus
a split on a street's centreline where a building's approach meets it. Each enterable building adds
one entrance node on its door and, when its interior floor area (the sum of its rooms) reaches
`routing.graph.internal_node_min_interior_cells`, one internal node at the centre of its largest
room snapped to a free tile. Edges join consecutive nodes along a street, an entrance to its split,
and an entrance to its internal node; each costs the walking estimate between its endpoints, and
nothing else. Portal nodes and edges come from floor transitions, which generation emits none of
yet; each portal endpoint links to the nearest walking node on its floor, and the check
holds the whole graph to one connected component. The size is stamped in the `macro graph` block below, against the bands in
`sim::routing::graph`.

## Measured ceilings

Every measured figure lives only in a stamped block below, whose label is
in `bounds::generation_stamp::MEASURED_BLOCKS`. A block is raw
`measure-generation` output pasted inside a fenced code block, headed by
`<label> at GENERATION_VERSION=<n> fingerprint=<hex>`. The fingerprint
(FNV-1a) covers every generator input: the `generation.*` balance rows,
the rule rows and the building types.
`bounds/tests/generation_sweep_current.rs` fails, naming the block and its
re-run command, for a block that is missing, unregistered, stamped twice
with different stamps, stale in version or fingerprint, stamped outside a
fence, or lacking its `implied 4096-case` line when it is proptest-gated;
for any line of this file that quotes a number against
`GENERATION_VERSION`; for any comment in `defs/`,
`server/sim/src/generation/` or the generation proptests that restates a
version, a seed count or a `measured minimum <n>` figure; and for any
`generation.*` balance key that is neither in a block's `ceilings` nor in
`NOT_MEASURED` with a reason. Comments point at a block label, never
restate its figures.

Three gates, none to be loosened: a pass-code change without a version
bump turns the goldens red; a version bump turns the stamps red; a retune
turns the fingerprint red. A red stamp means re-run the block's command
and re-state every ceiling it backs in the same PR.

Two kinds of block. *Proptest-gated* blocks (`detour-bounds sweep`, `band
sweep`, `rows sweep`, `region-loss sweep`, `interiors sweep`) back
per-seed bounds that CI judges on arbitrary cities: they carry the miss
count over `seed_from_ids` seeds and the failure probability implied for
the block's own CI case count -- 4,096 proptest cases, or the 96-city
shared pool the pass-6 and whole-district invariants judge
(`MeasuredBlock::ci_cases`, the marker `implied <n>-case`) -- with the
rule-of-three bound when there are no misses. A sweep over `n` cities
bounds the per-city rate by `3 / n`, so a 96-city CI run fails with
probability at most `1 - (1 - 3/n)^96`: `n >= 24,000` keeps it at about
1.2%, and the `interiors sweep` runs 30,000. The `coverage` CI job runs
the same checks at its own, smaller counts (256 proptest cases, an
8-city pool; pinned to `ci.yml` by a test) and every block prints both
counts under its header; for a per-city ceiling a smaller count only
lowers the failure probability. The pooled enterable-share band is a
statistic over one pool, so its figure changes with the pool size: the
block reports it over consecutive pools of every size CI judges it at,
against a band that is the committed one at 96 cities and widens by
`sqrt(96 / pool)` below it (`guards::pooled_share_band_x1000`), the same
number of standard errors at every size. *Fixed-seed* blocks (`exhaustive loop`,
`pooled evidence`) are deterministic facts with no miss rate. The per-seed guard figures a proptest asserts are computed by one
function (`sim::generation::guards`) that the proptest and the sweep both
call.

**Margin rule.** A design target (a `target_*` count, the 2x bar, the
land-use shares) is never re-centred on a measurement; only the guard
around it is measured. A bound on an emergent quantity is the worst
observed over the sweep, scaled by 1.25 on the side that can worsen,
rounded away from the pass direction to a round step. The 5.5-sigma form
(mean plus 5.5 standard deviations) is kept only where a key's comment
derives it so from a genuine mean-plus-spread distribution: building,
workplace and profession counts, and the open-plot and envelope-size
bands of the `exhaustive loop` block. A bound that a sweep finds
violated is a pass defect, fixed in the pass, not by widening the bound;
a retune carries the pinned worst seed, as a fixed-seed regression test,
before the fix lands.

Seeds are drawn through `seed_from_ids` with each sweep's own salt over
the full `u64` space, and threaded sweeps reduce in seed-index order, so a
block is reproducible bar thread count and wall-clock.

### detour-bounds sweep

`cargo run -p bounds --release --bin measure-generation -- detour 1000000`

```text
detour-bounds sweep at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 1000000 seeds, 32 threads, passes 1-2 only
CI judges these ceilings at 4096 cases in the test job and 256 in the coverage job
  detour max()-contract (14-node sample): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
  p99_detour_fill_percent = 95% (64-node sample): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
  peripheral_low_band_floor_percent = 60% (per-city low/high band mean block area): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
peripheral low/high band mean block area, 10 lowest per-seed ratios (ascending):
  82.1% at seed 16892314924458794616
  86.0% at seed 6608802717960552687
  90.6% at seed 14325606440077469114
  94.0% at seed 11873867015526339073
  94.0% at seed 6501764767737910739
  94.7% at seed 12817518641139574010
  94.9% at seed 3904633251627043261
  96.2% at seed 18346756138553029793
  98.3% at seed 5988394195923993529
  98.6% at seed 5909227263422883727
p99 detour fill, top 10 per-seed worsts (ascending):
  75% at seed 5988837546137498753
  75% at seed 8972464458946417216
  75% at seed 11439090712527978101
  75% at seed 13505970753572999287
  75% at seed 13776647893606566841
  75% at seed 14403150150629229023
  76% at seed 1328008260854036307
  76% at seed 3051248002231336362
  78% at seed 12074391603333713495
  84% at seed 11161877730662506814
detour_ratio_pct_sampled_at_or_beyond_takeover (400 cells) top 10 per-seed worsts (ascending):
  169% at seed 15136973595406656132
  169% at seed 15419962683491853639
  169% at seed 18310960759582978189
  170% at seed 5244034360721249388
  170% at seed 7463611480761118332
  170% at seed 9172990292326436060
  170% at seed 9925152223027798400
  171% at seed 4929245716913353663
  178% at seed 4832727318219098284
  189% at seed 4059475806152703678
detour-bounds sweep wall-clock: 218.0s (0.218ms/seed)
```

### band sweep

`cargo run -p bounds --release --bin measure-generation -- bands 1000000`

```text
band sweep at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 1000000 seeds, all five passes (salt 0xb0f05ee4)
CI judges these ceilings at 4096 cases in the test job and 256 in the coverage job
land_use_share_commercial deviation from its key (18%), permille of the site: min=-17 p1=-14 p50=-1 p99=13 max=17 mean=-0.6 stddev=6.0
  5.5-sigma share tolerance implied: 3.32 percentage points
land_use_share_industrial deviation from its key (14%), permille of the site: min=-17 p1=-14 p50=-1 p99=13 max=17 mean=-0.7 stddev=5.8
  5.5-sigma share tolerance implied: 3.21 percentage points
land_use_share_institutional deviation from its key (7%), permille of the site: min=-44 p1=-29 p50=0 p99=6 max=6 mean=-1.2 stddev=6.5
  5.5-sigma share tolerance implied: 3.55 percentage points
  land-use share band (share_tolerance_pct): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
building_count: min=766 p1=829 p50=889 p99=948 max=1009 mean=889.1 stddev=25.5
  5.5-sigma building tolerance implied: 15.7% of the 893 target
building_count extremes over the band sweep: min 766 at seed 12323584470636640542, max 1009 at seed 161806487886316638 (pinned in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)
  building-count band (count_tolerance_percent): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
workplace_count: min=226 p1=284 p50=342 p99=401 max=463 mean=342.3 stddev=25.0
  5.5-sigma workplace tolerance implied: 40.1% of the 343 target
  workplace-count band (workplace_count_tolerance_percent): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
core_citizens_per_screen: min=19 p1=27 p50=38 p99=50 max=63 mean=37.8 stddev=5.2
  busy core (busy_screen_min_citizens = 18): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
edge_percent_of_core: min=3 p1=7 p50=18 p99=40 max=78 mean=18.9 stddev=7.0
  quiet edge (quiet_edge_max_percent_of_core = 95%): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
legibility_min_shop_mix_percent closest qualifying pair per seed: min=9 p1=23 p50=49 p99=65 max=85 mean=48.4 stddev=8.3
  legibility_min_shop_mix_percent = 8%: 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
legibility_pole_shop_mix_percent closest qualifying pair per seed: min=28 p1=39 p50=51 p99=67 max=86 mean=51.5 stddev=6.1
  legibility_pole_shop_mix_percent = 25%: 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
legibility_min_distance_percent closest qualifying pair per seed: min=100 p1=100 p50=100 p99=100 max=100 mean=100.0 stddev=0.0
  legibility_min_distance_percent = 50%: 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
  district character (min_corners, min_apart_neighbourhoods, legible_step, min_home_cells via poor_band_max = 25): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
institutional_pockets: min=3 p1=3 p50=4 p99=6 max=8 mean=4.5 stddev=0.7
largest_institutional_pocket_share_basis_points: min=87 p1=117 p50=205 p99=234 max=234 mean=206.4 stddev=17.3
  institutional pockets (institutional_min_pockets = 3, institutional_max_pocket_share_percent = 6%, no two touching): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
profession_depth_per_city: min=44 p1=55 p50=61 p99=67 max=67 mean=61.4 stddev=2.3
  profession_count_per_city_min = 36: 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
band sweep wall-clock: 156.1s (0.156ms/seed)
```

### exhaustive loop

`cargo run -p bounds --release --bin measure-generation`

```text
exhaustive loop at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 50000 seeds at 512x512 cells
building_count: min=778 p1=829 p50=889 p99=949 max=990 mean=889.2 stddev=25.6
building_count extremes: min 778 at seed 11805315485014167829, max 990 at seed 11123925265906853341 (pin both in invariants.rs's PINNED_BUILDING_COUNT_SEEDS)
rejected_percent: min=0 p1=0 p50=0 p99=0 max=0 mean=0.0 stddev=0.0
rejections by reason: too_narrow=0 too_shallow=0
open plots with a short side under open_min_side_cells: 0 (0 of them whole sliver blocks from pass 2)
open_percent_by_count: min=0 p1=0 p50=1 p99=3 max=4 mean=1.5 stddev=0.6
open_percent_by_area: min=1 p1=7 p50=17 p99=29 max=38 mean=17.4 stddev=4.9
unplotted_percent: min=0 p1=0 p50=0 p99=0 max=0 mean=0.0 stddev=0.0
mean_width_cells_x10: min=103 p1=106 p50=110 p99=114 max=117 mean=110.1 stddev=1.9
mean_depth_cells_x10: min=101 p1=105 p50=112 p99=118 max=124 mean=111.6 stddev=2.8
detour_excess_cells_sampled_14node: min=0 p1=0 p50=0 p99=92 max=312 mean=3.4 stddev=17.2
detour_excess_cells_sampled_14node worst: 312 at seed 4595557621078204092 ((67, 40)-(512, 38))
detour_excess_cells_exhaustive max: 320 at seed 610140160610395379 ((486, 53)-(512, 474)) -- the number max_detour_excess_cells's own margin rule is applied to; pin the seed (with this exhaustive figure) in streets::PINNED_DETOUR_SEEDS if it moves
detour_excess_cells_exhaustive top 10 per-seed worsts (ascending):
  294 at seed 12004126622565142029 ((139, 37)-(408, 0))
  296 at seed 116551616410019364 ((109, 512)-(460, 480))
  298 at seed 14239178388419496175 ((123, 463)-(421, 512))
  300 at seed 2513967929251121005 ((97, 33)-(448, 0))
  300 at seed 3802514444151385145 ((253, 512)-(479, 478))
  302 at seed 16760756817975736266 ((76, 512)-(489, 486))
  306 at seed 12819133835454577505 ((263, 469)-(472, 512))
  310 at seed 6482608135473407511 ((181, 0)-(437, 26))
  316 at seed 4595557621078204092 ((159, 0)-(418, 38))
  320 at seed 610140160610395379 ((486, 53)-(512, 474))
detour_excess_cells_exhaustive_both_endpoints_interior max: 312 at seed 4595557621078204092 ((108, 40)-(418, 38)) -- the player-felt figure: the worst pair with neither endpoint on the site boundary
detour_ratio_pct_exhaustive_at_or_beyond_takeover (400 cells) max: 176% at seed 4595557621078204092 ((108, 40)-(512, 38)) -- the only range where the ratio term is the binding half of the max()-contract, so the only figure max_detour_percent owes margin over (story 15.10, Derek's direction)
detour_ratio_pct_exhaustive_at_or_beyond_takeover top 10 per-seed worsts (ascending):
  169% at seed 8751012638812695494 ((0, 72)-(27, 464))
  170% at seed 8027958254937089344 ((85, 512)-(474, 494))
  171% at seed 15639043849596958433 ((77, 481)-(450, 512))
  171% at seed 3224251154164115518 ((483, 429)-(512, 52))
  171% at seed 11335347611331606093 ((76, 23)-(458, 0))
  171% at seed 610140160610395379 ((486, 53)-(512, 474))
  171% at seed 893143956151306943 ((88, 512)-(473, 494))
  173% at seed 3802514444151385145 ((85, 512)-(459, 478))
  173% at seed 12819133835454577505 ((101, 469)-(472, 512))
  176% at seed 4595557621078204092 ((108, 40)-(512, 38))
dwelling_count: min=434 p1=469 p50=548 p99=627 max=686 mean=548.9 stddev=33.5
workplace_count: min=245 p1=286 p50=342 p99=403 max=447 mean=342.3 stddev=25.3
seeds (0..5000) with a real rule violation: 0
distribution row actual/expected ratio, pooled and per-seed worst, over seeds with a nonzero expected count (0..5000):
  depot_present: pooled actual/expected 100.0% (actual sum 5000, expected sum 5000), worst single seed 100.0% at seed 257705055944448381 (committed tolerance_percent allows down to 75%)
  council_present: pooled actual/expected 100.0% (actual sum 5000, expected sum 5000), worst single seed 100.0% at seed 257705055944448381 (committed tolerance_percent allows down to 75%)
  hospital_present: pooled actual/expected 100.0% (actual sum 5000, expected sum 5000), worst single seed 100.0% at seed 257705055944448381 (committed tolerance_percent allows down to 75%)
  welfare_office_present: pooled actual/expected 58.8% (actual sum 17544, expected sum 29855), worst single seed 20.0% at seed 17533667317742863027 (committed tolerance_percent allows down to 75%)
  shelter_present: pooled actual/expected 45.1% (actual sum 26400, expected sum 58552), worst single seed 18.2% at seed 10430750330835762333 (committed tolerance_percent allows down to 75%)
  cafe_present: pooled actual/expected 100.0% (actual sum 52423, expected sum 52423), worst single seed 100.0% at seed 257705055944448381 (committed tolerance_percent allows down to 80%)
per-tag placed count, min and pooled mean over 0..5000:
  tag 18: min=434 mean=548.93
  tag 19: min=6 mean=11.79
  tag 20: min=1 mean=1.00
  tag 21: min=1 mean=1.00
  tag 22: min=1 mean=1.00
  tag 23: min=1 mean=3.51
  tag 24: min=2 mean=5.28
  tag 25: min=104 mean=178.14
  tag 26: min=8 mean=10.48
  tag 27: min=1 mean=10.20
  tag 28: min=33 mean=86.56
  tag 29: min=1 mean=2.68
  tag 30: min=1 mean=6.69
  tag 31: min=75 mean=187.72
  tag 32: min=169 mean=302.10
  tag 33: min=4 mean=59.11
per-profession pooled mean employer count (below 5 shown first):
  councillor: 1.00
  surgeon: 1.00
  trainer: 3.84
  bookseller: 4.60
  bank_teller: 4.61
  loan_officer: 4.61
  concierge: 4.82
  tailor: 5.42
  bartender: 6.04
  market_porter: 6.69
  market_vendor: 6.69
barista_employers_per_city: min=8 p1=9 p50=10 p99=12 max=13 mean=10.5 stddev=0.7
professions_employed_by_5_plus_workplaces_per_city (Scale Baseline target ~69): min=49 p1=55 p50=61 p99=66 max=67 mean=61.4 stddev=2.3

missing-tag sweep: 5000 seeds (distinct from every sweep above -- `cargo run -p bounds --release --bin measure-generation -- <n>` to change the count)
distribution rows -- seeds with target >= 1 but 0 actually placed:
  depot_present: 0 of 5000 (rate 0.000000%), offending seeds: []
  council_present: 0 of 5000 (rate 0.000000%), offending seeds: []
  hospital_present: 0 of 5000 (rate 0.000000%), offending seeds: []
  welfare_office_present: 0 of 5000 (rate 0.000000%), offending seeds: []
  shelter_present: 0 of 5000 (rate 0.000000%), offending seeds: []
  cafe_present: 0 of 5000 (rate 0.000000%), offending seeds: []
ad hoc presence tags (never distributed) -- seeds with 0 placed:
  shop: 0 of 5000 (rate 0.000000%), offending seeds: []
```

### rows sweep

`cargo run -p bounds --release --bin measure-generation -- rows 1000000`

```text
rows sweep at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 1000000 seeds, 32 threads
CI judges these ceilings at 96 cases in the test job and 8 in the coverage job
  committed rules hold (inv_generation_committed_rules_hold_for_any_seed): 0 of 1000000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 96-case CI failure probability <= 0.0288%)
  cafe_present: pooled mean placed 10.49, fewest in one district 7, owed somewhere but none placed in 0 districts
  council_present: pooled mean placed 1.00, fewest in one district 1, owed somewhere but none placed in 0 districts
  depot_present: pooled mean placed 1.00, fewest in one district 1, owed somewhere but none placed in 0 districts
  hospital_present: pooled mean placed 1.00, fewest in one district 1, owed somewhere but none placed in 0 districts
  shelter_present: pooled mean placed 5.31, fewest in one district 1, owed somewhere but none placed in 0 districts
  welfare_office_present: pooled mean placed 3.52, fewest in one district 1, owed somewhere but none placed in 0 districts
```

### region-loss sweep

`cargo run -p bounds --release --bin measure-generation -- regions 1000000`

```text
region-loss sweep at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 1000000 seeds, passes 1-2 only (salt 0xb0f05ee5)
CI judges these ceilings at 4096 cases in the test job and 256 in the coverage job
  seeds with any region carried by no block: 20769 of 1000000 (first: Some(11091164158115210688)) -- by design, a block takes its majority use
  every institutional region carried by no block (inv_generation_an_institutional_region_is_carried_by_a_block): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
```

### pooled evidence

`cargo run -p bounds --release --bin measure-generation -- pooled`

```text
pooled evidence at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: seeds 0..256 pooled, evidence seeds 1, 2, 3
pooled low-band / high-band mean block area over seeds 0..256: 289% (peripheral_pooled_min_ratio_percent = 150%)
pooled chopped share of low-band blocks over seeds 0..256: 1886 of 5600 (33%)
evidence seed 1: low-band / high-band mean block area 2.65x (Artie's bar 2x)
evidence seed 2: low-band / high-band mean block area 2.24x (Artie's bar 2x)
evidence seed 3: low-band / high-band mean block area 2.56x (Artie's bar 2x)
pooled shuttered share of the bottom affluence third's commercial frontage: 3357 of 23299 (14%, shuttered_bottom_third_min_percent = 12); top third shuttered: 0 of 18065
catchment floor bite, row shelter_present: 901 of 1024 (seed, catchment) pairs (87%, catchment_floor_min_bite_percent = 60)
catchment floor bite, row welfare_office_present: 805 of 1024 (seed, catchment) pairs (78%, catchment_floor_min_bite_percent = 60)
pooled edge over core: 18% (quiet_edge_pooled_max_percent_of_core = 50%)
pooled core over city mean screen: 190% (busy_core_over_city_min_percent = 150%); city mean screen 19.6 citizens
```

### interiors sweep

`cargo run -p bounds --release --bin measure-generation -- interiors`

```text
interiors sweep at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: 30000 seeds, 32 threads (salt 0xb0f05ee7)
CI judges these ceilings at 96 cases in the test job and 8 in the coverage job
enterable_count: min=766 p1=805 p50=868 p99=932 max=973 mean=868.5 stddev=27.3
enterable_share_percent: min=92 p1=95 p50=97 p99=99 max=100 mean=97.2 stddev=1.2
shell_count: min=0 p1=3 p50=20 p99=44 max=61 mean=20.6 stddev=10.4
rejected_count: min=0 p1=0 p50=0 p99=0 max=1 mean=0.0 stddev=0.0
rejected_percent_of_attempted: min=0 p1=0 p50=0 p99=0 max=0 mean=0.0 stddev=0.0
max_layout_attempts_used: min=4 p1=6 p50=8 p99=8 max=8 mean=7.9 stddev=0.4
max_room_aspect_x100: min=300 p1=300 p50=300 p99=300 max=300 mean=300.0 stddev=0.0
dwelling_enterable_percent_of_placed: min=99 p1=100 p50=100 p99=100 max=100 mean=100.0 stddev=0.0
dwelling_percent_of_enterable_set: min=50 p1=56 p50=63 p99=70 max=75 mean=62.7 stddev=2.9
shop_enterable_percent_of_placed: min=99 p1=100 p50=100 p99=100 max=100 mean=100.0 stddev=0.0
shop_percent_of_enterable_set: min=9 p1=13 p50=18 p99=24 max=28 mean=18.3 stddev=2.4
cafe_enterable_percent_of_placed: min=100 p1=100 p50=100 p99=100 max=100 mean=100.0 stddev=0.0
cafe_percent_of_enterable_set: min=0 p1=1 p50=1 p99=1 max=1 mean=1.0 stddev=0.0
back_room_enterable_percent_of_placed: min=100 p1=100 p50=100 p99=100 max=100 mean=100.0 stddev=0.0
back_room_percent_of_enterable_set: min=2 p1=4 p50=7 p99=10 max=13 mean=7.3 stddev=1.4
wall_cells_per_city: min=39113 p1=42377 p50=47077 p99=51252 max=53747 mean=47020.5 stddev=1905.7
floor_cells_per_city: min=45667 p1=50780 p50=57694 p99=63777 max=67731 mean=57601.3 stddev=2815.3
threshold_cells_per_city: min=3162 p1=3422 p50=3807 p99=4155 max=4403 mean=3802.9 stddev=157.3
fixture_cells_per_city: min=7892 p1=8489 p50=9379 p99=10190 max=10797 mean=9371.8 stddev=365.5
layout attempts needed (u32::MAX = rejected): {1: 23646369, 2: 1202362, 3: 547904, 4: 286316, 5: 158236, 6: 90868, 7: 51550, 8: 72092, 4294967295: 2}
check-chain failures by verdict: {}
buildings laid with a program shorter than the longest that fit, by type (of laid): {"bottling_plant": 35, "builders_yard": 40, "clinic": 35, "condo_block": 2491, "cottage": 10855, "depot": 47, "fire_station": 451, "food_plant": 35, "market_hall": 1, "police_station": 413, "print_works": 18, "recycling_facility": 38, "terrace_house": 18502, "transit_office": 488, "vehicle_repair_garage": 26, "villa": 8293, "warehouse": 190, "welfare_office": 1, "workshop": 22} of {"bakery": 304085, "bank_branch": 139940, "bookshop": 140286, "bottling_plant": 358074, "builders_yard": 429241, "butcher": 304450, "cafe": 314739, "cinema": 315041, "clinic": 283919, "clothes_shop": 163106, "condo_block": 1775470, "corner_shop": 690317, "cottage": 3339704, "council": 30001, "depot": 30001, "fire_station": 283606, "food_plant": 393850, "general_retail": 507954, "greengrocer": 303759, "gym": 116090, "hairdresser": 305948, "hardware_shop": 227505, "hospital": 30001, "hotel": 144552, "launderette": 146405, "library": 281999, "market_hall": 199992, "office_block": 304326, "pharmacy": 228774, "police_station": 284134, "post_office": 252848, "print_works": 250522, "pub": 180935, "recycling_facility": 428587, "restaurant": 116298, "school": 283885, "shelter": 159589, "supermarket": 315662, "terrace_house": 8360021, "transit_office": 283443, "vehicle_repair_garage": 267069, "villa": 2306992, "warehouse": 80809, "welfare_office": 105674, "workshop": 286094}
buildings rejected, by type: {"corner_shop": 2}
  generate succeeds (check chain): 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  layout attempts at most max_layout_attempts = 8: 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  rejected share at most max_rejected_percent = 5%: 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  enterable count at least min_enterable_count = 100: 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  no room past max_room_aspect = 3:1: 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  required kinds spread (min enterable percent per kind [90, 90, 90, 90], max_kind_share_percent = 85%): 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
  an enterable dwelling in the lowest density band: 0 of 30000 misses (rate 0.000000%), implied 96-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 30000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.010000% (implied 96-case CI failure probability <= 0.9555%)
pooled_enterable_share_x1000_per_96_city_pool: min=97360 p1=97414 p50=97680 p99=97951 max=98033 mean=97678.6 stddev=118.3
  pooled enterable share within [97.000, 99.000]% (96-city pools; enterable_target_percent = 98% +- 1% at 96): 0 of 312 misses (rate 0.000000%), implied 1-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 312 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.961538% (implied 1-case CI failure probability <= 0.9615%)
pooled_enterable_share_x1000_per_8_city_pool: min=96042 p1=96691 p50=97683 p99=98588 max=99082 mean=97678.1 stddev=415.5
  pooled enterable share within [94.536, 101.464]% (8-city pools; enterable_target_percent = 98% +- 1% at 96): 0 of 3750 misses (rate 0.000000%), implied 1-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 3750 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.080000% (implied 1-case CI failure probability <= 0.0800%)
```

### macro graph

`cargo run -p bounds --release --bin measure-generation -- graph`

```text
macro graph at GENERATION_VERSION=14 fingerprint=4009cf20f2108cf8: seeds 0..32 at the committed site, 0..4 at 1024
committed site (512 x 512, 32 seeds): nodes min 1697 mean 1843 max 1963; edges min 1744 mean 1895 max 2016; internal nodes 13% of entrances
growth target (1024 x 1024, 4 seeds): nodes min 7086 mean 7371 max 7730; edges min 7309 mean 7604 max 8002; internal nodes 13% of entrances
```

## Density is per screen

The unit of a density curve is the viewport, not the city (`docs/gdd.md`'s
"density is local"; the tile size the viewport is measured in is
`render.tile_size_px`, `defs/balance/render.toml` -- not restated here
as a number, so the two can never drift). Density curves are recorded
as *props visible per screen of street* along the centre-to-periphery
axis, a consequence of the Density parameter above, never a city-wide
ratio and never a second meaning of "density". The numbers themselves
arrive with the pass that consumes them, settled against full-viewport
screenshots -- not invented here (`generation.props.ambient_per_100_cells_*`,
provisional: about 8 street props per core screen, lamps excluded, fewer
at the edge). Two constraints on the curve are about
look, not tuning, and hold from this document on:

- The periphery gets *fewer* props, never missing ground or broken
  joins -- sparse reads as quiet, a gap reads as a bug.
- Density is clustered with purpose (bins by benches, lamps on a regular
  cadence), never uniform scatter -- noise reads as generated, rhythm
  reads as real.

## Walk the district (A5 judgement, story 3.16)

Seed `city.seed` (20260713), the one seed walked: the committed city,
streamed from the module's own rows and walked on foot at the shipped
speed with real key presses (`npm run test:e2e:review`; stills and the
recording are `docs/generation/walk/`, the route and timings
`docs/spikes/3.16-walk-the-district.md`). Any seed is walked with
`scripts/dev/walk-district.sh <seed>`. The district was walked without
citizens (Epic 5): that absence is set aside, and nothing was faked to fill it.

**Verdict on the built environment: not yet worth walking.** The geometry
earns the walk -- arterials read wider than side streets, a lamp and a
planter cadence runs the length of a pavement, the core packs tighter than
the edge, and the route a player takes is 1.01-1.05 of the straight line --
but the four things below fail the five tests Artie set, and each reopens
content rather than being accepted for now.

**Verdict on the generator, apart from the empty city: the layout rules hold.**
Edge-to-core-to-edge is 527 steps for a 509-cell crossing (stretch 1.04),
every cell of the site and margin has one ground row, 100+ buildings are
enterable, furnished and reachable from the arrival (`district_world.rs`).

Findings, each disposed:

- **Roads stop at the site boundary** (north edge, from the arrival
  street, `02-first-street-screen`): the carriageway and pavement end on a
  hard line and the margin beyond is plain open ground. *Reopens* the
  ground catalogue: the road and pavement ground rows continue through the
  margin (`city.ground.margin_cells`), content in `defs/`, no generator branch.
- **Open ground is one flat green** between buildings and past the site
  (`08-site-edge`, `04-affluence-step`): no void and no seam, but nothing
  from `2_City_Terrains` varies it. *Accepted* for the edge (it is complete
  and never the canvas background); *reopens* `city.ground.open_object_id`
  as a terrain choice for block interiors.
- **Facades do not vary along a block face and building age has no
  carrier** (`04`, `05`, `07`): every wall is the one flat grey swatch, so
  the age step at (158, 381) cannot be told from either side. *Filed as a
  finding against the rule content*: the facade-variant carrier
  (`4_Generic_Buildings`) is not realised; age is not legible on the walk.
  Nothing was substituted.
- **The affluence step reads, the age step does not** (`04-affluence-step`
  at (329, 256), sharpest affluence step 71; `07-age-step`, sharpest age
  step 82): shop mix and shuttered share differ across the arterial; the
  facades do not. See the previous finding.
- **No container, stair or floor transition exists in the district**:
  the generator places none, so what the street fixture proved for
  transitions, containers and the footbridge is not re-proven. *Claims* the
  must-never-be-seen row for a district with no vertical connection until a
  rule story places stairs.
- **Interior walls are flat swatches and a building's front is drawn
  grey from outside** (`03`, `06`): readable, not yet attractive.
  *Accepted* until the facade carrier lands.
- **Core direction is legible only by density and road width**: from a
  random screen the core is told by the denser, wider-roaded frames; no
  sharper cue exists and none is added (no minimap, no marker).
- **A walker on screen over a chunk the bubble has not yet held**
  (`l3-agreement.spec.ts`, fixme): one frame at a chunk border, rate under
  0.2%. *Reopens* the bubble margin, tracked with the L3 story.

## Targets

The Scale Baseline (`docs/gdd.md`, NFR14) is the acceptance target for
the rule set as a whole. The numbers themselves are cited there, not
restated here -- `docs/gdd.md` wins if the two are ever found to
disagree.

| Target | Owning pass |
| --- | --- |
| Site extent | Land use / Street network |
| Building count | Building envelope |
| Workplace count | Building type |
| Enterable interior count | Interior layout |
| Profession count and employer depth | Building type (job definition) |
| Citizen count | Outside generation -- the sim's own population, seeded onto generated workplaces/dwellings |

## parameters
| balance key | status | pass | intent |
| --- | --- | --- | --- |
| generation.site_extent_cells | committed | Land use | the site's own square extent, in world cells |
| generation.land_use.coarse_cell_size_cells | committed | Land use | world cells per coarse land-use cell; the site extent must be a whole multiple of it |
| generation.land_use.min_leaf_cells | committed | Land use | the minimum size, on both axes, of a recursively-subdivided land-use district -- the guaranteed lower bound on a region's own area |
| generation.land_use.max_leaf_cells | committed | Land use | a district larger than this on either axis is split again |
| generation.land_use.split_jitter_pct | committed | Land use | how far a district split position may jitter from the rect's own midpoint |
| generation.land_use.max_recursion_depth | committed | Land use | a safety cap on recursive district-subdivision depth |
| generation.land_use.density_min | committed | Land use | density at the site's own edge |
| generation.land_use.density_max | committed | Land use | density at the field's own peak |
| generation.land_use.density_peak_offset_min_pct | committed | Land use | the density peak's own minimum offset from the site's geometric centre, as a percent of half the site extent (NFR8: never a perfectly concentric field) |
| generation.land_use.density_peak_offset_max_pct | committed | Land use | the density peak's own maximum offset from the site's geometric centre, same unit |
| generation.land_use.share_residential_pct | committed | Land use | the residential share of the land-use mix, by area |
| generation.land_use.share_commercial_pct | committed | Land use | the commercial share of the land-use mix, by area |
| generation.land_use.share_industrial_pct | committed | Land use | the industrial share of the land-use mix, by area |
| generation.land_use.share_institutional_pct | committed | Land use | the institutional share of the land-use mix, by area; the four shares sum to a whole |
| generation.land_use.share_tolerance_pct | committed | Land use | the percentage points a non-residential use's realised area share may sit from its own `share_*_pct` key, for any seed |
| generation.land_use.institutional_min_pockets | committed | Land use | the minimum number of mutually non-adjacent institutional components a site must show -- "a school, a clinic and a town hall do not share a campus" |
| generation.land_use.institutional_max_pocket_share_percent | committed | Land use | no single institutional component may exceed this percent of the site's own coarse-cell count |
| generation.neighbourhood.building_age_min | committed | Land use | the building-age dial's newer end -- an integer, never a year |
| generation.neighbourhood.building_age_max | committed | Land use | the building-age dial's older end |
| generation.neighbourhood.affluence_min | committed | Land use | the affluence dial's poorer end; `[[building_type]]` affluence bands and `reads = "affluence"` rows read this range |
| generation.neighbourhood.affluence_max | committed | Land use | the affluence dial's richer end |
| generation.neighbourhood.extreme_share_percent | committed | Land use | the percent of neighbourhoods drawn in an end third of a dial rather than its middle third -- wide steps between neighbours, never a smooth ramp |
| generation.neighbourhood.legible_step | committed | Land use | the smallest gap on one dial between two neighbourhoods that reads as two different places; each dial's two end thirds are at least this far apart |
| generation.neighbourhood.poor_band_max | committed | Land use | affluence at or below this is the bottom band; every district holds one such neighbourhood with dwellings |
| generation.neighbourhood.min_corners | committed | Land use | the fewest of the four age/affluence corners a district shows, so the two dials never move as one axis |
| generation.neighbourhood.min_apart_neighbourhoods | committed | Land use | a district holds at least this many neighbourhoods pairwise a legible step apart on some dial |
| generation.neighbourhood.min_home_cells | committed | Land use | a bottom-band neighbourhood counts as somewhere affordable to begin only with at least this many residential coarse cells |
| generation.neighbourhood.building_age_spread | committed | Land use | a building's own age sits within this of its neighbourhood's |
| generation.neighbourhood.state_weight_age | committed | Land use | the weight of newness in a building's initial physical state |
| generation.neighbourhood.state_weight_affluence | committed | Land use | the weight of affluence in the same -- old and poor is worn, old and rich is kept |
| generation.neighbourhood.desirability_state_floor | committed | Land use | a block mean physical state at or below this is wholly undesirable; desirability rises from 0 here to 100 at fully kept |
| generation.neighbourhood.min_patch_span_viewports | committed | Land use | no neighbourhood patch is narrower than this many viewports either way, unless merging further would leave fewer patches than `min_corners` |
| generation.neighbourhood.viewport_width_cells | committed | Land use | cells across one screen (1080p, 3x zoom, `render.tile_size_px`) |
| generation.neighbourhood.viewport_height_cells | committed | Land use | cells down one screen |
| generation.neighbourhood.dwelling_tag_id | committed | Land use | the id of the tag marking one home, by which crowding finds a dwelling; tag ids are append-only and a test holds that it names `dwelling`. The first sim system outside generation that needs to find dwellings moves the marker onto the tag itself |
| generation.neighbourhood.max_end_stranded_professions | committed | Land use | at most this many professions are hosted only by types a bottom-third (or only a top-third) affluence neighbourhood cannot hold -- trades that follow a town's money; no launch job may be one |
| generation.neighbourhood.citizens_per_dwelling | committed | Land use | a term of the street-crowding proxy, not an occupancy: what a dwelling adds to a screen |
| generation.neighbourhood.citizens_per_post | committed | Land use | a term of the same proxy: what one workplace post adds to a screen |
| generation.neighbourhood.busy_screen_min_citizens | committed | Land use | per-seed guard: a commercial core at the top of the density range supports at least this many crowding units a screen |
| generation.neighbourhood.busy_core_over_city_min_percent | committed | Land use | pooled over seeds 0..256, a core screen is at least this percent of the city's own mean screen |
| generation.neighbourhood.quiet_edge_max_percent_of_core | committed | Land use | per-seed guard against a wild deviation: a residential edge supports at most this percent of the same district's core |
| generation.neighbourhood.quiet_edge_pooled_max_percent_of_core | committed | Land use | the real bound: pooled over seeds 0..256 a residential edge supports at most this percent of the core |
| generation.neighbourhood.nfr15a_screen_citizens_tenths | committed | Land use | NFR15a's one citizen per 52.4 cells as a screen figure in tenths (17.6), the target a pooled whole screen is held to |
| generation.neighbourhood.nfr15a_tolerance_percent | committed | Land use | the percent a pooled whole screen may sit from `nfr15a_screen_citizens_tenths` |
| generation.neighbourhood.legibility_min_distance_percent | committed | Land use | two neighbourhoods a legible step apart on building age differ in their buildings' ages by at least this total-variation percent (building age is the sim-side carrier of the age dial) |
| generation.neighbourhood.legibility_min_shops | committed | Land use | a pair is compared on shop mix only when each holds at least this many commercial-frontage buildings |
| generation.neighbourhood.legibility_min_shop_mix_percent | committed | Land use | floor: two neighbourhoods a legible step apart on affluence differ in their commercial-frontage type mix by at least this total-variation percent |
| generation.neighbourhood.legibility_pole_shop_mix_percent | committed | Land use | two neighbourhoods in opposite end thirds of affluence differ in their realised frontage mix by at least this total-variation percent |
| generation.neighbourhood.shuttered_bottom_third_min_percent | committed | Land use | over seeds 0..256, at least this percent of the bottom affluence third's commercial frontage is shuttered (no post), and none of the top third's |
| generation.neighbourhood.pole_min_share_percent | committed | Land use | at each end third of affluence, at least this percent of the commercial fill weight sits on types the opposite end third cannot hold |
| generation.neighbourhood.position_independence_max_distance_percent | committed | Land use | identical dials and density hold the same buildings wherever they sit: the west and east halves of the site differ by at most this total-variation percent |
| generation.streets.arterial_count_ns_min | committed | Street network | the minimum north-south arterial count -- seeded uniformly in `[..._min, ..._max]`, never a fixed count |
| generation.streets.arterial_count_ns_max | committed | Street network | the maximum north-south arterial count |
| generation.streets.arterial_count_ew_min | committed | Street network | the minimum east-west arterial count |
| generation.streets.arterial_count_ew_max | committed | Street network | the maximum east-west arterial count |
| generation.streets.arterial_width_cells | committed | Street network | an arterial's own carriageway-plus-pavement width |
| generation.streets.street_width_cells | committed | Street network | a street-tier segment's own carriageway-plus-pavement width |
| generation.streets.lane_width_cells | committed | Street network | a lane-tier segment's own carriageway-plus-pavement width |
| generation.streets.arterial_jitter_pct | committed | Street network | how far an arterial may jitter from its own even band position |
| generation.streets.block_size_min_cells | committed | Street network | target block side length at the field's own maximum density |
| generation.streets.block_size_max_cells | committed | Street network | target block side length at the field's own minimum density |
| generation.streets.min_block_depth_cells | committed | Street network | the minimum margin a recursive split must leave on each side |
| generation.streets.max_block_depth_min_cells | committed | Street network | a harder ceiling than the density target, applied to a block's own *shorter* side, at the field's own maximum density: a block whose short side still exceeds this gets a further lane-tier split |
| generation.streets.max_block_depth_max_cells | committed | Street network | the same ceiling's own value at the field's own minimum density -- interpolated like `block_size_min/max_cells`, so the periphery's own larger blocks are not cancelled by a flat ceiling |
| generation.streets.max_street_splits_per_superblock | committed | Street network | how many street-tier (not lane-tier) cuts one superblock may take before an over-target block is split with a lane instead -- keeps the core from reading as half asphalt; commercial blocks are exempt (always street tier) |
| generation.streets.junction_min_separation_cells | committed | Street network | the minimum net gap, carriageway edge to carriageway edge, between two junctions on the same street line -- a split that cannot land clean against this is refused outright, never merely snapped clear |
| generation.streets.split_jitter_pct | committed | Street network | how far a block split position may jitter from the rect's own midpoint |
| generation.streets.max_recursion_depth | committed | Street network | a safety cap on recursive block-subdivision depth |
| generation.streets.max_lane_splits | committed | Street network | a safety cap on the extra lane-tier splits one over-deep block may take (bypassed while the block still encloses a region or swallows one's land use -- AC2's "never stranded" is a hard bound) |
| generation.streets.min_distinct_block_sizes | committed | Street network | the minimum number of distinct block widths, and separately heights, a city must show ("not a perfect grid") |
| generation.streets.max_detour_percent | committed | Street network | the site-scale-free long-range detour claim 3.11's pathfinding estimator relies on: `network <= max(manhattan + max_detour_excess_cells, manhattan * max_detour_percent / 100)`, for every sampled pair, no distance threshold of its own |
| generation.streets.max_detour_excess_cells | committed | Street network | the additive Manhattan-fitness ceiling (world cells), applied to every sampled pair regardless of distance |
| generation.streets.p99_detour_fill_percent | committed | Street network | the 99th-percentile detour fill (a pair's network distance as a percent of its own max()-contract allowance), over one city's own sampled pairs, must not exceed this -- `max_detour_percent`/`max_detour_excess_cells` bound the single worst pair at 100%; under 100 |
| generation.streets.peripheral_low_band_floor_percent | committed | Street network | per-city anti-inversion floor: the low-density (periphery) mean block area must be at least this percent of the high-density (core) mean |
| generation.streets.peripheral_pooled_min_ratio_percent | committed | Street network | pooled over a fixed seed range, summed low-band mean area over summed high-band mean area must be at least this percent -- the guard that actually fails a density-blind generator |
| generation.streets.thin_strip_long_side_percent | committed | Street network | how far a thin strip (short side under half the local target block size) may run along its long side before it is cut, as a percent of that target -- a boundary strip splits into halves near the target, never into pieces shorter than it |
| generation.plots.frontage_min_cells | committed | Plot subdivision | AC1: a plot fronts a street iff it shares at least this many world cells of edge length with a street-abutting side of its own block; corner-point contact is landlocked |
| generation.plots.high_density_threshold | committed | Plot subdivision | the density at or above which a block's own build line sits flush on the pavement (setback 0, party walls); shared with the building-envelope pass's own side-gap step |
| generation.plots.setback_periphery_cells | committed | Plot subdivision | the one shared build-line setback every plot on a below-threshold block sits behind |
| generation.plots.residential_width_min_cells | committed | Plot subdivision | the rhythm-module width band a residential block face draws its plot widths from, minimum end |
| generation.plots.commercial_width_min_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_width_min_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_width_min_cells | committed | Plot subdivision | same, institutional |
| generation.plots.residential_width_max_cells | committed | Plot subdivision | the same residential band's maximum end |
| generation.plots.commercial_width_max_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_width_max_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_width_max_cells | committed | Plot subdivision | same, institutional |
| generation.plots.residential_row_depth_cells | committed | Plot subdivision | a residential plot's own depth from its block face inward |
| generation.plots.commercial_row_depth_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_row_depth_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_row_depth_cells | committed | Plot subdivision | same, institutional |
| generation.plots.max_core_depth_cells | committed | Plot subdivision | the most a block's own leftover core may reach on either axis before it becomes an explicit `open` plot rather than being absorbed into the rows as rear yard -- at the density peak |
| generation.plots.max_core_depth_periphery_cells | committed | Plot subdivision | the same ceiling at the periphery, interpolated by density between the two: deep rear gardens there, a small yard at the core |
| generation.plots.open_min_side_cells | committed | Plot subdivision | the minimum short side of any `open` plot this pass creates of its own accord -- a residue narrower than this is never a plot of its own |
| generation.plots.max_open_percent_by_count | committed | Plot subdivision | the maximum percent of a district's plots that may be `open`, by count -- asserted per city |
| generation.plots.max_open_percent_by_area | committed | Plot subdivision | the same ceiling by plotted area |
| generation.plots.max_unplotted_percent | committed | Plot subdivision | the maximum percent of every block's summed area that may belong to no plot at all, citywide |
| generation.envelopes.wall_thickness_cells | committed | Building envelope | the wall ring's own thickness, both axes -- interior usable floor is the footprint minus two of these per axis |
| generation.envelopes.residential_min_interior_width_cells | committed | Building envelope | the minimum usable interior width a residential footprint must clear, checked against the interior net |
| generation.envelopes.commercial_min_interior_width_cells | committed | Building envelope | same, commercial |
| generation.envelopes.industrial_min_interior_width_cells | committed | Building envelope | same, industrial |
| generation.envelopes.institutional_min_interior_width_cells | committed | Building envelope | same, institutional |
| generation.envelopes.residential_min_interior_depth_cells | committed | Building envelope | the same residential minimum's depth |
| generation.envelopes.commercial_min_interior_depth_cells | committed | Building envelope | same, commercial |
| generation.envelopes.industrial_min_interior_depth_cells | committed | Building envelope | same, industrial |
| generation.envelopes.institutional_min_interior_depth_cells | committed | Building envelope | same, institutional |
| generation.envelopes.max_width_cells | committed | Building envelope | the outer envelope ceiling, both axes, shared across every land use |
| generation.envelopes.max_depth_cells | committed | Building envelope | the outer envelope ceiling's own depth |
| generation.envelopes.side_gap_periphery_cells | committed | Building envelope | the total gap between two neighbouring envelopes on a below-threshold block -- half inset from each side; 0 at or above the threshold (party walls) |
| generation.envelopes.size_trim_max_cells | committed | Building envelope | the most a footprint's depth may trim back from filling its plot's available depth, for variety -- width is never trimmed |
| generation.envelopes.mean_width_cells | committed | Building envelope | AC3's own mean footprint width (12): the pooled mean over the fixed seed range 0..256 must sit within the tolerance below, every single city's own mean within a weak band four times as wide |
| generation.envelopes.mean_width_tolerance_cells | committed | Building envelope | the tolerance around the mean width |
| generation.envelopes.mean_depth_cells | committed | Building envelope | AC3's own mean footprint depth (11), same two bands |
| generation.envelopes.mean_depth_tolerance_cells | committed | Building envelope | the tolerance around the mean depth |
| generation.envelopes.min_distinct_sizes | committed | Building envelope | NFR8/AC3's anti-cheat floor: the minimum number of distinct (width, depth) footprint pairs a district must show |
| generation.envelopes.target_count_per_million_cells | committed | Building envelope | AC4's own building-count target -- the Scale Baseline's ~894 at 512x512, stated per one million site cells and scaled by real site area, never a measurement |
| generation.envelopes.count_tolerance_percent | committed | Building envelope | AC4's per-seed tolerance band around the scaled target, as a percent -- the wild-deviation guard |
| generation.envelopes.mean_count_tolerance_percent | committed | Building envelope | AC4's pooled band: the mean placed count over the fixed seed range 0..256 must sit within this percent of the scaled target |
| generation.envelopes.max_rejected_plot_percent | committed | Building envelope | the maximum percent of attempted plots the envelope pass may reject, asserted per city |
| generation.building_types.target_workplaces_per_million_cells | committed | Building type | AC4's own workplace-count target -- the Scale Baseline's ~344 at 512x512 (`docs/gdd.md`), stated per one million site cells and scaled by real site area, never a measurement |
| generation.building_types.workplace_count_tolerance_percent | committed | Building type | AC4's per-seed tolerance band around the scaled workplace target, as a percent |
| generation.building_types.workplace_mean_count_tolerance_percent | committed | Building type | AC4's pooled band: the mean workplace count over the fixed seed range 0..256 must sit within this percent of the scaled target |
| generation.building_types.target_profession_count | committed | Building type | the pooled target for the count of professions held by at least `min_employers_per_profession` distinct placed workplaces -- the GDD's own ~69, never re-centred on a measurement |
| generation.building_types.profession_count_mean_tolerance_percent | committed | Building type | the pooled band around `target_profession_count`, as a percent -- the profession catalog itself totals exactly `target_profession_count` rows, two of which stay structurally singleton by design, and institutional land is a small, fixed share of the site (an earlier pass's own limit, not this pass's); the measured pooled mean sits under `target_profession_count` for those reasons, with margin |
| generation.building_types.profession_count_per_city_min | committed | Building type | a weak, any-seed floor on the count of professions held by at least `min_employers_per_profession` distinct placed workplaces in one city -- the per-city half the pooled mean above says nothing about |
| generation.building_types.min_employers_per_profession | committed | Building type | the GDD's own "5+ employers each" -- the minimum distinct placed workplaces a profession must be held by to count toward the target above; a singleton institution's own post is deliberately excluded |
| generation.catchment_floor_min_bite_percent | committed | Building type | over the fixed seed range 0..256, at least this percent of (seed, catchment) pairs owe a scoped row a floor of at least one subject -- a retune never turns the floor back into zero |
| generation.catchment_extent_cells | committed | Building type | the fixed-extent, world-absolute square (world cells) a `scope = "catchment"` `[[distribution]]` row is judged and allocated over -- 256 at launch, the four quadrants of a 512x512 site |
| generation.interiors.max_layout_attempts | committed | Interior layout | how many times one building's layout may be rebuilt before it is `Rejected` -- the loop is never unbounded |
| generation.interiors.min_enterable_count | committed | Interior layout | FR114's floor on the enterable count (`docs/gdd.md`'s Scale Baseline); `generate` fails below it |
| generation.interiors.max_rejected_percent | committed | Interior layout | the maximum percent of attempted layouts that may be `Rejected`, asserted per city |
| generation.interiors.enterable_target_percent | committed | Interior layout | the enterable share of placed buildings, pooled over the shared city pool (96 cities in the test job, 8 in the coverage job) |
| generation.interiors.enterable_target_tolerance_percent | committed | Interior layout | the pooled band's half-width around the target above at 96 cities, widened by `sqrt(96 / pool)` for a smaller pool |
| generation.interiors.dwelling_min_enterable_percent | committed | Interior layout | the minimum percent of placed dwellings that must be enterable |
| generation.interiors.shop_min_enterable_percent | committed | Interior layout | the same minimum for shops |
| generation.interiors.cafe_min_enterable_percent | committed | Interior layout | the same minimum for cafes |
| generation.interiors.back_room_min_enterable_percent | committed | Interior layout | the same minimum for institutional back rooms (a staff room in a type sited on institutional land use) |
| generation.interiors.max_kind_share_percent | committed | Interior layout | no required kind may exceed this share of the enterable set |
| generation.props.arterial_pavement_cells | committed | Prop placement | an arterial's pavement band on each side, in cells; the rest of its width is carriageway |
| generation.props.street_pavement_cells | committed | Prop placement | the same for a street-tier segment |
| generation.props.lane_pavement_cells | committed | Prop placement | the same for a lane-tier segment (one cell: furniture other than a lamp never stands on it) |
| generation.props.lamp_cadence_cells | committed | Prop placement | the distance between lamps along one side of a street, the two sides staggered half a cadence; the `street_is_lit` row's `min_spacing` keeps the ones that would crowd a junction out |
| generation.props.ambient_per_100_cells_at_density_min | committed | Prop placement | **provisional** -- ambient street furniture offered per 100 cells of building-side run at the periphery |
| generation.props.ambient_per_100_cells_at_density_max | committed | Prop placement | **provisional** -- the same at the core, interpolated by density; re-judged the day the city is walkable |
| generation.props.max_solid_percent_of_room_floor | committed | Prop placement | the most of a room's floor solid colliders may cover; past it a fixture stands at its compact footprint |

## placement
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| lighting_ground_floor_only | committed | Prop placement | cell | - | a lamp -- a street lamp or a room's light -- standing on an upper-storey ledge instead of at street level; pass 7 places on floor 0 only, so it holds by construction and is judged over every placed lamp |

## distribution
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| waste_per_three_seating | committed | Prop placement | site | - | seating with no bin anywhere nearby, or every bin clumped in one corner while the rest of the street collects litter; pass 7 stands benches as ambient singles and pairs and allocates a bin to every seat within `max_distance`, in the same block, under the row's own ratio band; scoped `site` because distribution's own coverage math already is -- "Does not fit"'s distribution gap below is this row's own answer to how it behaves when the site grows |
| table_set_has_a_chair | committed | Prop placement | site | - | a seated table with no chair within `max_distance` -- a dining room nobody can sit in; stated as a distribution, not a requirement, because the layout pass judges every other kind over its own building before any chair stands |
| table_set_has_a_second_chair | committed | Prop placement | site | - | the same row again: two rows, two seats ("Does not fit", "N of X beside every Y") |
| street_is_lit | committed | Prop placement | site | - | a street with no lighting at all, or lamps at irregular spacing: every footway cell (a cell of the street's own pavement, never a doorstep) has a street lamp within `max_distance`, no two closer than `min_spacing`, and the count sits in the ratio band; stated over the `street_light` tag, so a room's own light never counts as street lighting |
| depot_present | committed | Building type | site | - | a depot per roughly `ratio` dwellings, never clustered with another depot -- "the district has a depot" (AC2); one per district is what a depot is, so a district that grows past the next multiple of `ratio` is owed another, built by the development chain; no coverage ceiling (the walk to one is content) |
| council_present | committed | Building type | site | - | same shape, the council |
| hospital_present | committed | Building type | site | - | same shape, the hospital |
| welfare_office_present | committed | Building type | catchment | Affluence | each catchment holds welfare offices at a real ratio of its own dwellings, thinning as the catchment's affluence rises, spaced apart -- they sit where land is cheap, and the walk to them is content, never guaranteed near; a catchment owing under one holds none |
| shelter_present | committed | Building type | catchment | Affluence | same shape, shelters -- thinning as affluence rises |
| cafe_present | committed | Building type | site | - | story 15.9: a cafe per roughly `ratio` dwellings, on ordinary commercial land -- "the district has a cafe" (AC2), guaranteed by construction rather than by the ordinary weighted fill's own luck, since a real launch job (barista, FR14) depends on it; `site` because a cafe needs commercial land, which gathers in a catchment or two, so a catchment row could not demand one where there is none |

## coherence
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| indoor_props_never_on_the_street | committed | Prop placement | room | - | an interior-sheet prop (an object carrying `indoor`) standing in an area that has street pavement in it; pass 7 also reads the pair to know which side of the door each def is on |
| outdoor_props_never_indoors | committed | Prop placement | room | - | an exterior-sheet prop (an object carrying `outdoor`) standing in an area that has a floor in it |
| no_counter_in_a_stairwell | committed | Interior layout | room | - | a till or service counter sharing an area with a stairwell; the pass lays out the ground floor only, so no stairwell exists for it to fire on yet |
| no_high_rise_within_a_low_rise_block | committed | Building type | building | - | AC1, "no skyscraper among villas": a `form_high` building never shares a block with a `form_low` one -- the form-class scale is `defs/tags/generation.toml`'s own vocabulary, never a type key |

## adjacency
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| door_never_blocked_by_a_fixture | committed | Interior layout | cell | - | a fixture standing on any cell beside a threshold, inside or out -- a door a prop blocks |
| road_never_touches_wall | committed | Building envelope | cell | - | the carriageway running straight into a building wall with no pavement between them |
| road_never_touches_ground | committed | Building envelope | cell | - | asphalt bleeding directly into bare ground with no pavement edge |
| floor_never_touches_bare_ground | committed | Building envelope | cell | - | an interior floor tile exposed straight to bare ground, as if the wall around it were missing |
| floor_never_touches_pavement_directly | committed | Building envelope | cell | - | an interior floor tile touching street pavement with no wall or threshold sealing the room |
| floor_never_touches_road_directly | committed | Building envelope | cell | - | an interior floor tile opening straight onto the road |
| doorway_formed_between_walls | committed | Building envelope | cell | - | a gap in a wall run that reads as a hole, never a door -- no threshold, or the wrong tiles either side of it |
| wall_is_part_of_a_straight_run_or_a_corner | committed | Building envelope | cell | - | a lone wall stub standing in the open, joining nothing |
| entrance_opens_onto_pavement | committed | Building envelope | cell | - | a building's own front door opening onto another building's wall or into an interior room instead of the street |

## requirement
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| walled_room_has_waste_bin | committed | Prop placement | room | - | an area holding seating with no waste bin in it: a block's street furniture, since pass 7 stands no indoor seating, and a cluster of benches is never stood without its bin |
| counter_faces_a_shopfront | committed | Prop placement | building | - | a shopfront with no counter behind it: pass 7 stands one glazing unit on the street wall of every building holding a counter, so a shop reads as a shop from the pavement; was an adjacency row, stated over the building because the counter stands against the far wall, not the glass |
| bathroom_has_a_toilet | committed | Prop placement | room | - | a washing room with a basin and no toilet -- the dressing debt story 3.5 recorded |
| room_has_a_door | committed | Interior layout | room | - | a sealed room a player can see into but never enter |
| building_has_an_entrance | committed | Building envelope | building | - | a building with no door anywhere on its own perimeter |
| footprint_sized_for_interior_usability | committed | Interior layout | room | - | a laid-out room too cramped to use: fewer than four floor cells, two walkable cells either way; the static half (a type whose own minimum interior cannot hold its program) is refused at defs build |
| room_has_a_light | committed | Interior layout | room | - | a room with no light fixture in it |
| business_has_stock_space | committed | Interior layout | room | - | a staff room -- the back room of any type with posts -- with no stock fixture: an empty container, never an item |
| bedroom_has_a_bed | committed | Interior layout | room | - | a sleeping room with no bed |
| kitchen_has_a_cooker | committed | Interior layout | room | - | a cooking room with no cooker |
| bathroom_has_a_basin | committed | Interior layout | room | - | a washing room with no basin |
| living_room_has_a_table_set | committed | Interior layout | room | - | a dining room with no table set |
| shop_floor_has_a_counter | committed | Interior layout | room | - | a room open to the public that trades with no till or service counter in it |
| cafe_has_two_table_sets | committed | Interior layout | room | - | a seated-service room with fewer than two table sets |
| office_has_a_desk | committed | Interior layout | room | - | a working room with no desk |
| workroom_has_a_workbench | committed | Interior layout | room | - | a making room with no workbench |

## Must never be seen

Seeded now as intents, not rules. `Status` is `claimed` exactly when
`Claimed by` names at least one key and every key it names is
`committed` in a kind table above under the section `Expected kind`
names; `unclaimed` otherwise -- checked mechanically, not by eye.

| Visual failure | Expected kind | Claimed by | Status |
| --- | --- | --- | --- |
| Two premises of the same chain adjacent to or facing each other on one street | distribution | | unclaimed |
| A cell with no ground drawable at all | adjacency | | unclaimed |
| A kerb that stops mid-run, leaving a bare seam | adjacency | | unclaimed |
| Pavement that ends mid-block with no terminating piece | adjacency | | unclaimed |
| A road that dead-ends into a wall with no terminating piece | adjacency | | unclaimed |
| A door that opens directly onto the road | adjacency | | unclaimed |
| A door that opens onto another wall | adjacency | | unclaimed |
| A door blocked by a prop sitting on its own threshold cell | adjacency | door_never_blocked_by_a_fixture | claimed |
| Street furniture placed on the carriageway | placement | | unclaimed |
| Pavement furniture leaving less than one walkable cell of pavement | adjacency | | unclaimed |
| The same facade repeated side by side with no variation, beyond what a real terrace would do | distribution | | unclaimed |
| The same prop sprite repeated side by side with no variation | distribution | | unclaimed |
| A shopfront with no counter behind it | requirement | shop_floor_has_a_counter + counter_faces_a_shopfront | claimed |
| A building with no entrance anywhere on its own perimeter | requirement | building_has_an_entrance | claimed |
| Interior-sheet props placed on the street | coherence | indoor_props_never_on_the_street | claimed |
| Exterior-sheet props placed indoors | coherence | outdoor_props_never_indoors | claimed |
| A street with no lighting at all | distribution | street_is_lit | claimed |
| Lamps at irregular spacing along a street | distribution | street_is_lit | claimed |
| A land-use boundary cutting through the middle of a block, rather than running along a street | adjacency | | unclaimed |
| Two parallel streets close enough to leave a sliver block no plot can use | adjacency | | unclaimed |
| A street that jogs sideways within less than a minimum block length | coherence | | unclaimed |
| A road that stops a few tiles short of the site edge instead of exiting cleanly through it | adjacency | | unclaimed |
| A uniform, symmetric empty ring around the site's own periphery | distribution | | unclaimed |
| A plot with no street frontage | adjacency | | unclaimed |
| A building standing off its block face's shared build line | coherence | | unclaimed |
| A 1-cell slit between two buildings | adjacency | | unclaimed |
| Land inside a block that belongs to no plot | requirement | | unclaimed |
| A building whose entrance faces the block interior or a side passage | adjacency | | unclaimed |
| A vacant gap in an otherwise continuous high-density street wall | coherence | | unclaimed |
| A stair entered over its own drawn post, railing or end wall | adjacency | | unclaimed |
| A stair climbed against the direction its art rises, or walked at a different width on the two floors it joins | coherence | | unclaimed |
| A stair whose treads stop short of the foot of its own railing, with floor showing between them | coherence | | unclaimed |
| A neighbourhood parameter (building age or affluence) changing part-way along one block face, or through the middle of a block | coherence | | unclaimed |
| Character alternating block by block, with no patch of one character larger than a screen | distribution | | unclaimed |
| An entire commercial block face of shuttered units inside the dense core | distribution | | unclaimed |

The `defs/rules/city.toml` rows and the `defs/rules/grammar.toml`
rows above are placeholders and grammar primitives, not a claim on this
catalogue: `entrance_opens_onto_pavement` and `doorway_formed_between_walls`
guard individual room/building composition, not a whole generated
street, so the rows they overlap stay `unclaimed` until a real
generation-pass rule claims them -- `building_has_an_entrance` is the
one exception, because "a building has no entrance" is the same claim
at either scale.

Until a rule claims them, five of the pass 3-4 rows are guarded by a
proptest invariant each (`server/sim/tests/invariants.rs`) rather than
by nothing: "A plot with no street frontage" by
`inv_generation_every_plot_fronts_a_street`; "A 1-cell slit between two
buildings" by `inv_generation_envelope_gaps_are_zero_or_at_least_two`
(every pair of envelopes in a block, both axes, whichever face each
belongs to); "Land inside a block that belongs to no plot" by
`inv_generation_unplotted_percent_bounded` (an explicit `open` core is a
plot) and `inv_generation_open_plots_are_never_slivers`; "A vacant gap in
an otherwise continuous high-density street wall" by
`inv_generation_no_open_plot_on_a_built_face_at_high_density`; and a
building under its own class's floor (8x8 outer for residential, the
smallest) by `inv_generation_envelope_size_within_its_class_band`.

## Does not fit

- **Room-to-room reachability cannot be a rule.** "From the entrance every
  public room is reachable without crossing a staff or private room" is a
  property of the room graph, which none of the five kinds can state
  (adjacency sees four neighbours, a requirement counts cells in an area).
  It holds by construction -- every back room is reached from the front
  room through its own doorway, or through a room of its own access in
  front of it -- and is checked over tags by
  `inv_generation_public_rooms_are_reachable_without_crossing_staff_or_
  private`, never a per-type branch in the pass.
- **"Every fixture keeps a reachable walkable cell beside it" cannot be a
  rule either,** for the same reason: a cell beside a fixture is
  reachable only through the room graph. It holds by construction --
  the pass keeps every fixture's lane to the doorway -- and is checked by
  `inv_generation_every_emitted_interior_validates_clean`.

- **"N of X beside every Y" is two copies of one row.** A table set owes
  two chairs: `table_set_has_a_chair` and `table_set_has_a_second_chair`,
  the same distribution row twice. A ratio counts `per` cells per subject
  and cannot say "N subjects per one `per`"; and a requirement row has no
  owner pass, so a row pass 7 owes cannot be a requirement without pass 6
  refusing every building before any chair stands. The two chair rows are
  the stopgap: the next "two of X beside every Y" is a signal to fix the
  engine, not a third copy.

A rule that cannot be expressed as one of the five kinds over tags for
any other reason is written here too, with why -- a signal that a
system is missing, never licence for a bespoke branch in the generator
or a sixth kind added quietly.
