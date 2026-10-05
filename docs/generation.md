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
legible step apart, a legible step between an adjacent pair on age and on
affluence, at least three of the four corners (old/new x poor/rich), and a
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

**Crowding is derived, never a dial or a stored capacity.** The citizens a
screen supports are dwellings (types eligible on residential land) times
`citizens_per_dwelling` plus every post times `citizens_per_post`, over the
buildings whose entrance falls in the window. A screen is
`viewport_width_cells` x `viewport_height_cells` (1080p at 3x zoom and
16 px tiles, 40x22); the weights are set so a whole screen averages NFR15a's
one citizen per 52.4 cells (~17.6). A commercial core at the top of the
density range supports at least `busy_screen_min_citizens`; a residential
edge at the bottom at most `quiet_edge_max_percent_of_core` of the same
district's core. The quiet edge still gets continuous ground and pavement --
fewer things, never missing things.

**Evidence.** [`docs/generation/neighbourhoods-seed-1.svg`](generation/neighbourhoods-seed-1.svg),
[`-2`](generation/neighbourhoods-seed-2.svg), [`-3`](generation/neighbourhoods-seed-3.svg):
four small panels per seed (density, age, affluence, land use) with every
block filled flat over the street network, age and affluence each a
single-hue ramp whose lightness carries the value (never a red/green pair);
then one boundary strip across the district's sharpest adjacent step at
viewport scale -- plots, envelopes by derived class, a type marker on each
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
under a quarter of their local target's area (76% pooled over seeds
0..256 at `GENERATION_VERSION` 8, 33% at 9) and
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
reads by looking, not by a HUD. Measured at `GENERATION_VERSION` 9: 2.65x,
2.24x, 2.56x.

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
harness's own 50,000 mixed seeds, times 1.25, rounded up to a multiple of
8 -- see the key's own comment in `defs/balance/generation.toml` for the
current run's numbers. `GenerationConfig::from_balance` separately
refuses a value over `4 * block_size_max_cells + 2 * arterial_width_cells`
-- a loosening guard that scales with the block keys, never a worst-case
claim.

**What actually protects master.** `inv_generation_detour_ratio_bounded`
runs on arbitrary seeds, in every CI run, but only ever samples the
cheap 14-node width -- its own worst reading at `GENERATION_VERSION` 9
was 312 (seed `4595557621078204092`), 8 cells under the 320-cell
exhaustive figure the key is set from. That gap is not the margin; the
margin is the stated 1.25 factor, nothing else, over a tail that is
still growing: this run's own ten largest per-seed worsts, ascending,
were 294, 296, 298, 300, 300, 302, 306, 310, 316, 320. A future
50,000-seed run finding a new worst above 400 remains possible -- that
is what re-measuring on a retune, and pinning what a random sweep finds,
both exist for.

For scale: the worst pinned seed today (`610140160610395379`, 320
cells exhaustive) is about eight viewport-widths of extra walking for the
worst pair of the worst city found in 50,000 genuinely random draws --
accepted as a rare tail. That figure still has one foot on the site
boundary, though, where the city stops and almost nobody stands; the
same run's own worst pair with *both* endpoints off the boundary --
the player-felt figure -- was 312 cells (seed `4595557621078204092`,
pair `(108, 40)`-`(418, 38)`), 8 under 320. The maze fixture
`a_maze_fails_dead_ends_and_detour` (a U-shaped corridor, no real route
through) overshoots by 600 cells, real margin over the 400-cell
committed value and a stated distance from "our worst real city" to "a
maze", not just a pass/fail. If a future re-measurement moves the
exhaustive max itself past roughly 360, that PR owes the new worst
seed's own picture and Artie's own judgement again on whether the
result still reads as a city.

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

`server/bounds/src/bin/measure_generation.rs`'s own detour-bounds sweep
(its own CLI-configurable seed count) measures the max()-contract's own
miss rate directly, together with `p99_detour_percent`'s (unrelated to
this story's mechanism, and unchanged by it), and prints the worst
sampled ratio among pairs at or beyond the takeover distance -- the only
range where the ratio term is the binding half, so the only figure
`max_detour_percent` owes margin over. Run at 1,000,000 seeds (the
excess-only sweep this deduction rests on, story 15.10's first cycle;
wall-clock 4854.4s, 4.854ms/seed, passes 1-2 only):

```text
detour-bounds sweep: 1000000 seeds, passes 1-2 only
  max_detour_excess_cells (14-node sample): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
  p99_detour_percent (64-node sample): 0 of 1000000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 1000000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.000300% (implied 4096-case CI failure probability <= 1.2213%)
```

The max()-contract's own miss count over that same million seeds is not
separately re-run: exceeding the max() of two terms means exceeding
both, so a max()-contract violation is always also an excess-alone
violation, and the excess ceiling's own miss count above (0 of
1,000,000, unconditional, every pair) already proves the max()-
contract's own miss count is 0 too (Derek's direction, cycle 2). A
second, smaller run over the *current* code (the max()-contract and the
takeover-distance stat did not exist at the million-seed run's own
commit) confirms it at 5,000 seeds. This block is a smoke confirmation
only, not the story's own result -- the derivation above, resting on the
million-seed excess-only run, is:

```text
detour-bounds sweep: 5000 seeds, passes 1-2 only
  detour max()-contract (14-node sample): 0 of 5000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 5000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.060000% (implied 4096-case CI failure probability <= 91.4423%)
  p99_detour_percent (64-node sample): 0 of 5000 misses (rate 0.000000%), implied 4096-case CI failure probability 0.000000%, offending seeds: []
    zero observed misses over 5000 seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: 0.060000% (implied 4096-case CI failure probability <= 91.4423%)
detour_ratio_pct_sampled_at_or_beyond_takeover (416 cells) max: 161% at seed 3218297219535693363
detour_ratio_pct_sampled_at_or_beyond_takeover top 10 per-seed worsts (ascending):
  138% at seed 13484935046058371417
  139% at seed 10851253929785274785
  139% at seed 13953932552307513190
  142% at seed 4317090597060016208
  142% at seed 11584629443515575442
  142% at seed 12779145144319015470
  144% at seed 17004798694150435907
  145% at seed 12948431575908203078
  147% at seed 7693797974521656301
  161% at seed 3218297219535693363
detour-bounds sweep wall-clock: 24.8s (4.956ms/seed)
```

And the existing 50,000-seed exhaustive loop, re-run with the new
takeover-distance filter in place of the old `detour_long_pair_cells`
one:

```text
detour_ratio_pct_exhaustive_at_or_beyond_takeover (416 cells) max: 166% at seed 4798925340619191980 ((484, 69)-(512, 457))
detour_ratio_pct_exhaustive_at_or_beyond_takeover top 10 per-seed worsts (ascending):
  160% at seed 4154807055081904333 ((489, 32)-(512, 426))
  161% at seed 293547434567801483 ((494, 478)-(512, 67))
  161% at seed 8784580503613071542 ((46, 493)-(444, 512))
  161% at seed 15335357752681438835 ((494, 487)-(512, 76))
  161% at seed 11179447352395363997 ((90, 0)-(482, 36))
  161% at seed 12181295007339816141 ((62, 512)-(463, 483))
  162% at seed 4948530257853819072 ((32, 512)-(446, 487))
  163% at seed 8438006389594291483 ((27, 24)-(432, 0))
  165% at seed 9637747922394485167 ((48, 0)-(450, 21))
  166% at seed 4798925340619191980 ((484, 69)-(512, 457))
```

166% exhaustive, 200 committed: real margin over the real long-range
tail, not a re-expression of the excess budget at an arbitrary distance.

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
  low-density neighbourhood in the bottom band still has homes). A band
  that drops a profession under `min_employers_per_profession` is widened,
  never the tolerance. `defs-build`'s coverage check runs over land use x
  density x affluence, so the fill stays total. Building age never gates a
  type: each building records its own age and initial physical state
  instead (`BuildingTypeMap::states`).
- Accepted as built, recorded so nobody relitigates it: one residential
  building = one dwelling for `per` purposes (Tim's unit). It
  understates the dense core's own need -- a `condo_block` owes what a
  `villa` owes -- and a dwellings-per-type count becomes unavoidable
  once citizens are seeded onto housing.
- Accepted as built, story 15.9: cafe is a distributed type
  (`cafe.weight = 0`, `cafe_present` in `defs/rules/generation.toml`),
  not ordinary weighted fill. FR14 makes the barista a launch job, and
  FR116 lists cafes among the placed institutions -- a city with zero
  cafes was a real, if rare (~1 in 120,000 seeds), content defect
  players would read as the game being broken, not a quirk of the site,
  so "at least one cafe" is a real requirement, expressed the way every
  other required kind already is rather than left to the fill's own
  luck. Shops stay ordinary weighted fill, a likelihood and not a
  guarantee: a row over a tag many types share would pick the type by
  hand and erase the variety the fill exists for, and a shopless
  neighbourhood is intended friction. Measured over 300,000 seeds, no
  district was shopless (the fewest held 108 shop-tagged buildings), so no
  invariant asserts one.
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

- **Receives:** a building's own type and envelope.
- **Hands down:** the room grammar's own composition (walls, floor,
  doors) and enterable status.
- **Reads:** affluence.
- **Evidence:** (added when the pass lands.)

### Prop placement

- **Receives:** a finished interior or exterior cell set.
- **Hands down:** the placed props a player actually walks past.
- **Reads:** density, affluence, building age.
- **Evidence:** (added when the pass lands.)

## Density is per screen

The unit of a density curve is the viewport, not the city (`docs/gdd.md`'s
"density is local"; the tile size the viewport is measured in is
`render.tile_size_px`, `defs/balance/render.toml` -- not restated here
as a number, so the two can never drift). Density curves are recorded
as *props visible per screen of street* along the centre-to-periphery
axis, a consequence of the Density parameter above, never a city-wide
ratio and never a second meaning of "density". The numbers themselves
arrive with the pass that consumes them, settled against full-viewport
screenshots -- not invented here. Two constraints on the curve are about
look, not tuning, and hold from this document on:

- The periphery gets *fewer* props, never missing ground or broken
  joins -- sparse reads as quiet, a gap reads as a bug.
- Density is clustered with purpose (bins by benches, clutter by
  shopfronts, lamps and trees on a regular cadence), never uniform
  scatter -- noise reads as generated, rhythm reads as real.

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
| generation.neighbourhood.citizens_per_dwelling | committed | Land use | citizens a dwelling supports; with the post weight, a whole screen averages NFR15a's one per 52.4 cells |
| generation.neighbourhood.citizens_per_post | committed | Land use | citizens one workplace post supports |
| generation.neighbourhood.busy_screen_min_citizens | committed | Land use | a commercial core at the top of the density range supports at least this many citizens a screen |
| generation.neighbourhood.quiet_edge_max_percent_of_core | committed | Land use | a residential edge at the bottom of the density range supports at most this percent of the same district's core |
| generation.neighbourhood.legibility_min_distance_percent | committed | Land use | two neighbourhoods a legible step apart differ in placed building types, ages, states or shop types by at least this total-variation percent on one of them |
| generation.neighbourhood.legibility_min_buildings | committed | Land use | neighbourhoods are compared only when each holds at least this many buildings |
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
| generation.streets.p99_detour_percent | committed | Street network | the 99th-percentile detour ratio, over one city's own sampled pairs, must not exceed this -- `max_detour_percent` alone only bounds the single worst pair |
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

## placement
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| lighting_ground_floor_only | committed | Prop placement | cell | - | **placeholder** -- a street lamp standing on an upper-storey ledge instead of at street level |

## distribution
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| waste_per_three_seating | committed | Prop placement | site | - | **placeholder** -- seating with no bin anywhere nearby, or every bin clumped in one corner while the rest of the street collects litter; scoped `site` because distribution's own coverage math already is -- "Does not fit"'s distribution gap below is this row's own answer to how it behaves when the site grows |
| depot_present | committed | Building type | site | - | a depot per roughly `ratio` dwellings, never clustered with another depot -- "the district has a depot" (AC2); one per district is what a depot is, so a district that grows past the next multiple of `ratio` is owed another, built by the development chain; no coverage ceiling (the walk to one is content) |
| council_present | committed | Building type | site | - | same shape, the council |
| hospital_present | committed | Building type | site | - | same shape, the hospital |
| welfare_office_present | committed | Building type | catchment | Affluence | each catchment holds welfare offices at a real ratio of its own dwellings, thinning as the catchment's affluence rises, spaced apart -- they sit where land is cheap, and the walk to them is content, never guaranteed near; a catchment owing under one holds none |
| shelter_present | committed | Building type | catchment | Affluence | same shape, shelters -- thinning as affluence rises |
| cafe_present | committed | Building type | site | - | story 15.9: a cafe per roughly `ratio` dwellings, on ordinary commercial land -- "the district has a cafe" (AC2), guaranteed by construction rather than by the ordinary weighted fill's own luck, since a real launch job (barista, FR14) depends on it; `site` because a cafe needs commercial land, which gathers in a catchment or two, so a catchment row could not demand one where there is none |

## coherence
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| no_counter_in_a_stairwell | committed | Interior layout | room | - | **placeholder** -- a shop till standing on a stairwell landing |
| no_high_rise_within_a_low_rise_block | committed | Building type | building | - | AC1, "no skyscraper among villas": a `form_high` building never shares a block with a `form_low` one -- the form-class scale is `defs/tags/generation.toml`'s own vocabulary, never a type key |

## adjacency
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| counter_faces_a_shopfront | committed | Interior layout | cell | - | **placeholder** -- a till with its back to a blank wall, no shopfront anywhere on its own perimeter |
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
| walled_room_has_waste_bin | committed | Interior layout | room | - | **placeholder** -- stands in for a future room-completeness rule; describes nothing a real room looks like yet |
| room_has_a_door | committed | Interior layout | room | - | a sealed room a player can see into but never enter |
| building_has_an_entrance | committed | Building envelope | building | - | a building with no door anywhere on its own perimeter |
| footprint_sized_for_interior_usability | planned | Building envelope | building | - | a building whose frontage looks generous but whose interior is too cramped to hold the room grammar it needs |

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
| A door blocked by a prop sitting on its own threshold cell | requirement | | unclaimed |
| Street furniture placed on the carriageway | placement | | unclaimed |
| Pavement furniture leaving less than one walkable cell of pavement | adjacency | | unclaimed |
| The same facade repeated side by side with no variation, beyond what a real terrace would do | distribution | | unclaimed |
| The same prop sprite repeated side by side with no variation | distribution | | unclaimed |
| A shopfront with no counter behind it | requirement | | unclaimed |
| A building with no entrance anywhere on its own perimeter | requirement | building_has_an_entrance | claimed |
| Interior-sheet props placed on the street | coherence | | unclaimed |
| Exterior-sheet props placed indoors | coherence | | unclaimed |
| A street with no lighting at all | distribution | | unclaimed |
| Lamps at irregular spacing along a street | distribution | | unclaimed |
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

The five `defs/rules/city.toml` rows and the `defs/rules/grammar.toml`
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

None open.

A rule that cannot be expressed as one of the five kinds over tags for
any other reason is written here too, with why -- a signal that a
system is missing, never licence for a bespoke branch in the generator
or a sixth kind added quietly.
