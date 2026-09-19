# Generation Design

Story 3.1 (FR111). This is the home for placement constraints, adjacency
tables, density curves and neighbourhood parameter ranges -- the
document `docs/architecture.md`'s Rules section names as the E3-owned
artifact for rule content. `docs/gdd.md`'s Level Design Framework states
*intent* ("the periphery is deliberately quiet"); this document turns
intent into rules; `defs/rules/*.toml` holds the executable rows. A
claim is stated in exactly one of those three, never two -- in
particular, this document never repeats a number or a tag `defs/`
already carries: a rule entry here is its `key`, its `status`
(`committed`/`planned`), the pass that consumes it and a one-sentence
intent, never the subject/ratio/spacing/direction that make it fire.
Those live only in the `defs/rules/*.toml` row the key names.

A rule arrives here before or with the code that consumes it, never
after (AC2): a `planned` row with no matching `defs/rules/` key is the
normal, expected state of most of this document today; the reverse --
a committed key with no row, or a row still marked `planned` once its
key is committed -- is a red build
(`server/sim/tests/rule_examples.rs`).

The lowercase headings below (`## parameters` and the five `## <kind>`
sections) are machine-read, fixed shape -- exact heading text, one
table each (AC3: the section a rule sits under *is* its own constraint
kind, never a separate column that could disagree with it). Every
other, Title Case section is free prose.

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

## parameters

A neighbourhood is a point in a four-parameter space and nothing more
(FR113). No rule may name a neighbourhood; any "character" archetype
named in prose is an example vector through this space, not an identity
a rule can branch on. These are the same quantities the gentrification
loop (physical state -> desirability -> rent -> demographics) later
mutates -- they are the sim's own quantities, whose *initial* values the
generator sets, not generator-private knobs.

| Parameter | Unit | Range | Visible carrier |
| --- | --- | --- | --- |
| Density | plots per unit street length, integer | not yet ranged in `defs/` | how tightly `modernexteriors` plot footprints pack along a block, and how many `modernexteriors` street props (bins, benches, lamps, trees) appear per screen |
| Building age | integer, newer to older | not yet ranged in `defs/` | `modernexteriors`/`moderninteriors` weathering and facade-family choice -- an older end reads through worn/older facade variants and simpler interiors, a newer end through cleaner facades and denser interior fixtures |
| Affluence | integer, poorer to richer | not yet ranged in `defs/` | shop/interior quality tier and prop density drawn from `moderninteriors`' furnished-vs-sparse room variants; which `modernexteriors` institution and shopfront families can appear at all |
| Land-use mix | integer, residential-dominant to mixed to commercial/industrial-dominant | not yet ranged in `defs/` | the ratio of `modernexteriors` residential, commercial and industrial building families visible along a street |

No range or curve value is invented here to fill this table -- none
exists in `defs/` yet (this story does not create `defs/balance/
generation.toml`). Two neighbourhoods at opposite ends of a parameter
must be tellable apart from a single screenshot with no text; that is
this section's own acceptance test, applied when the first values land.

Curves and ranges are recorded here as a pointer to their own dotted
balance key, once one exists -- never as the value or range itself. The
table below is checked for shape only today (no generation balance key
exists yet); the first row that lands owes this table a guard tying the
documented intent to the `defs/balance/generation.toml` value it
points at, so the two can never drift silently.

| balance key | status | pass | intent |
| --- | --- | --- | --- |

## Passes

The spine is FR110's seven passes, coarse to fine. A pass not yet
implemented gets its heading and contract lines only, never speculative
rules invented to fill it. Rules are never grouped by building or
institution -- Institutions (FR116) are rows in the building-type pass,
expressed over tags exactly like everything else; a heading here named
after one institution would be the accreted-special-case shape this
document exists to prevent.

### Land use

- **Receives:** the city seed and the site bounds.
- **Hands down:** a coarse residential/commercial/industrial/
  institutional split across the site.
- **Reads:** density, land-use mix.
- **Rules consumed:** none committed yet.
- **Evidence:** (a full-viewport screenshot of this pass's own output,
  added when the pass lands.)

### Street network

- **Receives:** the land-use split.
- **Hands down:** the street graph (carriageway, pavement, kerb) blocks
  are subdivided from.
- **Reads:** density.
- **Rules consumed:** none committed yet. `road_never_touches_wall` and
  `road_never_touches_ground` (adjacency, placeholder) constrain the
  building-envelope pass's own output against this pass's roads; see
  that pass.
- **Evidence:** (added when the pass lands.)

### Plot subdivision

- **Receives:** a street-network block.
- **Hands down:** individual plots within the block.
- **Reads:** density, land-use mix.
- **Rules consumed:** none committed yet.
- **Evidence:** (added when the pass lands.)

### Building envelope

- **Receives:** a plot.
- **Hands down:** a building footprint and its sealed exterior shell
  (walls, entrance).
- **Reads:** density, building age.
- **Rules consumed:** `road_never_touches_wall`, `road_never_touches_ground`,
  `floor_never_touches_bare_ground`, `floor_never_touches_pavement_directly`,
  `floor_never_touches_road_directly`, `doorway_formed_between_walls`,
  `wall_is_part_of_a_straight_run_or_a_corner`, `entrance_opens_onto_pavement`,
  `building_has_an_entrance` (all adjacency/requirement, committed --
  the room/building grammar primitives, story 2.9); `footprint_sized_for_interior_usability`
  (requirement, planned -- FR115: a footprint is sized so the interior
  layout pass below can actually fit the rooms it needs, not by street
  frontage alone).
- **Evidence:** (added when the pass lands.)

### Building type

- **Receives:** a sealed envelope.
- **Hands down:** what the building *is* (residential, a named
  institution, a shop family, a workplace).
- **Reads:** affluence, land-use mix.
- **Rules consumed:** none committed yet. Institutions (FR116: depot,
  council, hospital, welfare office, shelters, shops, cafes) are rows
  here, over tags, when a later story adds them -- never a bespoke
  branch or a heading of their own.
- **Evidence:** (added when the pass lands.)

### Interior layout

- **Receives:** a building's own type and envelope.
- **Hands down:** the room grammar's own composition (walls, floor,
  doors) and enterable status.
- **Reads:** affluence.
- **Rules consumed:** `room_has_a_door` (requirement, committed --
  story 2.9); `no_counter_in_a_stairwell` (coherence, committed
  placeholder); `counter_faces_a_shopfront` (adjacency, committed
  placeholder); `walled_room_has_waste_bin` (requirement, committed
  placeholder -- stands in for a future room-completeness rule).
- **Evidence:** (added when the pass lands.)

### Prop placement

- **Receives:** a finished interior or exterior cell set.
- **Hands down:** the placed props a player actually walks past.
- **Reads:** density, affluence, building age.
- **Rules consumed:** `lighting_ground_floor_only` (placement, committed
  placeholder); `waste_per_three_seating` (distribution, committed
  placeholder).
- **Evidence:** (added when the pass lands.)

## Density is per screen

The unit of a density curve is the viewport, not the city (`docs/gdd.md`'s
"density is local", `docs/ux.md`'s 16x16-at-3x framing: one tile is
48 CSS px, so a 1920x1080 screen shows roughly 40x22 tiles). Density
curves are recorded as *props visible per screen of street* along the
centre-to-periphery axis, never as a city-wide ratio. The numbers
themselves arrive with the pass that consumes them, settled against
full-viewport screenshots -- not invented here. Two constraints on the
curve are about look, not tuning, and hold from this story on:

- The periphery gets *fewer* props, never missing ground or broken
  joins -- sparse reads as quiet, a gap reads as a bug.
- Density is clustered with purpose (bins by benches, clutter by
  shopfronts, lamps and trees on a regular cadence), never uniform
  scatter -- noise reads as generated, rhythm reads as real.

## Targets

The Scale Baseline (`docs/gdd.md`, NFR14) is the acceptance target for
the rule set as a whole, cited from there rather than re-decided here.

| Target | Value | Owning pass |
| --- | --- | --- |
| Site | 512x512 cells (~435 m square) | land use / street network |
| Buildings | ~894 | building envelope |
| Workplaces | ~344 | building type |
| Enterable interiors | 100+ (~11% of building stock) | interior layout |
| Professions | ~69, at 5+ employers each | building type (job definition) |
| Citizens | ~5,000 | outside generation -- the sim's own population, seeded onto generated workplaces/dwellings |

## placement

| key | status | pass | intent |
| --- | --- | --- | --- |
| lighting_ground_floor_only | committed | prop placement | **placeholder** -- a street lamp standing on an upper-storey ledge instead of at street level |

## distribution

| key | status | pass | intent |
| --- | --- | --- | --- |
| waste_per_three_seating | committed | prop placement | **placeholder** -- seating with no bin anywhere nearby, or every bin clumped in one corner while the rest of the street collects litter |

## coherence

| key | status | pass | intent |
| --- | --- | --- | --- |
| no_counter_in_a_stairwell | committed | interior layout | **placeholder** -- a shop till standing on a stairwell landing |

## adjacency

| key | status | pass | intent |
| --- | --- | --- | --- |
| counter_faces_a_shopfront | committed | interior layout | **placeholder** -- a till with its back to a blank wall, no shopfront anywhere on its own perimeter |
| road_never_touches_wall | committed | building envelope | the carriageway running straight into a building wall with no pavement between them |
| road_never_touches_ground | committed | building envelope | asphalt bleeding directly into bare ground with no pavement edge |
| floor_never_touches_bare_ground | committed | building envelope | an interior floor tile exposed straight to bare ground, as if the wall around it were missing |
| floor_never_touches_pavement_directly | committed | building envelope | an interior floor tile touching street pavement with no wall or threshold sealing the room |
| floor_never_touches_road_directly | committed | building envelope | an interior floor tile opening straight onto the road |
| doorway_formed_between_walls | committed | building envelope | a gap in a wall run that reads as a hole, never a door -- no threshold, or the wrong tiles either side of it |
| wall_is_part_of_a_straight_run_or_a_corner | committed | building envelope | a lone wall stub standing in the open, joining nothing |
| entrance_opens_onto_pavement | committed | building envelope | a building's own front door opening onto another building's wall or into an interior room instead of the street |

## requirement

| key | status | pass | intent |
| --- | --- | --- | --- |
| walled_room_has_waste_bin | committed | interior layout | **placeholder** -- stands in for a future room-completeness rule; describes nothing a real room looks like yet |
| room_has_a_door | committed | interior layout | a sealed room a player can see into but never enter |
| building_has_an_entrance | committed | building envelope | a building with no door anywhere on its own perimeter |
| footprint_sized_for_interior_usability | planned | building envelope | a building whose frontage looks generous but whose interior is too cramped to hold the room grammar it needs (FR115) |

## Must never be seen

Seeded now as intents, not rules (this does not violate AC2 -- the real
rule, with its own row above, arrives with the pass that claims it).
Each stays `unclaimed` until a pass records the rule that actually
prevents it.

| Visual failure | Expected kind | Status |
| --- | --- | --- |
| Two premises of the same chain adjacent to or facing each other on one street | distribution | unclaimed |
| A cell with no ground drawable, or terrain pieces that do not join -- a kerb that stops, pavement that ends mid-block, a road that dead-ends into a wall with no terminating piece | adjacency | unclaimed |
| A door that opens onto road, onto another wall, or is blocked by a prop on its own threshold cell | adjacency / requirement | unclaimed |
| Street furniture on the carriageway, or pavement furniture leaving less than one walkable cell of pavement | placement / adjacency | unclaimed |
| The same facade or the same prop sprite repeated side by side with no variation, beyond what a real terrace would do | distribution | unclaimed |
| A shopfront with no counter behind it, or a building with no entrance | requirement | unclaimed |
| Interior-sheet props on the street, or exterior-sheet props indoors | coherence | unclaimed |
| A street with no lighting at all, or lamps at irregular spacing | distribution | unclaimed |

The five `defs/rules/city.toml` rows and the `defs/rules/grammar.toml`
rows above are placeholders and grammar primitives, not a claim on this
catalogue -- `entrance_opens_onto_pavement` and `doorway_formed_between_walls`
guard individual room/building composition, not a whole generated
street, so the street-level catalogue rows they overlap stay
`unclaimed` until a real generation-pass rule claims them.

## Does not fit

Empty. When a rule cannot be expressed as one of the five kinds over
tags, it is written here with why -- a signal that a system is missing,
never licence for a bespoke branch in the generator or a sixth kind
added quietly.
