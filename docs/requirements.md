# Requirements

Every functional and non-functional requirement for BrowserCity, one line each. This file is the only place a requirement is stated; the GDD and the UX specification describe the game, and the GitHub issues carry the work.

## Functional

### Time and the core loop

- **FR1** — One in-city day equals 60 real minutes; one in-city hour equals 2.5 real minutes
- **FR2** — The in-city clock is detached from real-world time, so a player rotates through all in-city hours across their real week
- **FR3** — The clock advances continuously whether or not any client is connected; the server never spins down
- **FR4** — The player's day is composed of sleep (8 in-city hours), work (8h), commute (2h) and own-time (6h)
- **FR5** — The core loop runs wake -> commute -> shift -> paid -> spend -> rent -> sleep, and repeats
- **FR6** — The commute costs in-city minutes each leg and is the player's primary sensor on the city's state
- **FR7** — The commute has a floor of roughly 20 in-city minutes per leg; it can never reach zero
- **FR8** — At sleep the player may either log off (understudy takes the life) or stay up and work a borrowed night shift

### Shift work and procedure

- **FR9** — Every playable job runs a four-beat template: ritual open (~30 in-city min), rhythmic duties (~3h), discretionary middle (~4h), ritual close (~30 min)
- **FR10** — Props carry state, and that state is visible on the object itself, never in a UI readout (till change, stamp ink, grinder hopper, bin lorry fill)
- **FR11** — Multi-step procedures are performed on world objects in sequence, not selected from a menu
- **FR12** — A procedure can be performed badly - missed bins, short-changing, a bad shot, harsh braking - and the world reflects it
- **FR13** — No job carries a score. Self-imposed standards (cleaning the lobby) are never required, tracked or rewarded, but do change the world
- **FR14** — Five playable jobs ship at launch: convenience shop till, security guard (empty building), sanitation/bin round, night bus driver, cafe barista
- **FR15** — Freedom scales inversely with supervision; the least supervised post is the most interesting one
- **FR16** — Procedures are built so that some may physically require two people; the principle ships, the content does not
- **FR17** — Routine jobs are a fixed sequence of steps over local state, with decisions expressible as procedure branches
- **FR18** — Decider jobs are agenda selection over non-local information - a citizen whose work-time option set is matters instead of procedure steps

### Rent, money and the time economy

- **FR19** — Rent falls due every 7 in-city days, whether or not the player earned
- **FR20** — Entry wage is 10 per in-city hour (80/day, 560/week gross); starting edge-flat rent is 250/week; food and necessities ~90/week
- **FR21** — Rent can be split through a shared tenancy (flatshare), halving the metronome from 250 to 125 per week
- **FR22** — Missing rent triggers Ruin By Process - notice, escalation, judgment, enforcement - each link a job somebody holds and a moment the player can intervene, negotiate, pay or appeal
- **FR23** — There is no eviction fail-state, no death, no scoring and no state from which a player cannot return
- **FR24** — Destitution is inhabitable: welfare offices and shelters are simulated institutions with player-holdable roles
- **FR25** — Injury costs days and savings and routes the player through hospital institutions (paramedic, triage, nurse, surgeon, admin, billing)
- **FR26** — A bike costs 450 one-time and halves the walking commute to 30 in-city minutes each way
- **FR27** — A transit pass costs 20/week; closer flats cost roughly +130/week rent
- **FR28** — Transport mode acts as an edge-cost modifier on the macro routing graph, so the transport ladder is a shortest-path problem over the same graph the AI routes on
- **FR29** — Money exists only as stored time; no system may introduce a resource that competes with time as the scarce thing

### The verb vocabulary

- **FR30** — Presence verbs are supported - sit, order, wait, watch - as actions whose entire payload is being somewhere
- **FR31** — Civic verbs are supported - bin the bottle, hold the door, give up the seat - operating on single world objects
- **FR32** — Binning a bottle reverses the litter loop at the scale of one object, giving the player a hand in the physical-carrier law
- **FR33** — Conversation is loitering: chosen sentence by sentence, priced in minutes, with no dialogue tree and no branching script
- **FR34** — Dignity work is supported - the ramp, the ticket, the correct change - as small competent courtesies to specific people

### Reciprocal occupancy

- **FR35** — A citizen body has exactly one driver, and the driver is swappable between SelfL2, Understudy and Player
- **FR36** — On disconnect an AI understudy holds the player's life with a fixed, non-configurable, conservative mandate: works, pays rent, eats, sleeps, banks the surplus, never gambles, never quits
- **FR37** — The understudy is additive only. It never subtracts, replaces, consumes, degrades or rearranges. Necessities are paid as a cost line, not consumed from the player's inventory
- **FR38** — For any absence duration, the player's inventory is a superset of what they left and no owned item's state has degraded
- **FR39** — The absent character reconciles as a record and settles on return; payslips and receipts survive as additive physical objects
- **FR40** — The trace of an absence is the changed world - a new hoarding, an advanced chain - not the player's possessions and not a summary readout
- **FR41** — The understudy earns the same wage the player would, never more and never less
- **FR42** — Staying up past bedtime offers the player a few available night posts, chosen non-diegetically, sized by a tiredness cap
- **FR43** — Borrowed night shifts are anonymous, do not accumulate, and place consequence on the NPC rather than the player. They are always available and always pay
- **FR44** — Any unheld institutional post is backfilled by that citizen's own L2 continuing - AI backfill is not a separate mechanism
- **FR45** — Handover between drivers happens mid-procedure in both directions, snapping to the current step boundary; the procedure state machine is the shared substrate
- **FR46** — The discretionary middle is discretionary within the procedure's state space; a player may perform a procedure badly but never outside it
- **FR47** — No system may punish logging off. Services degrade only when someone chooses it, never because the server was quiet

### Citizens and the simulation

- **FR48** — Every citizen has a home, a job, a schedule, stable preferences and ends of their own
- **FR49** — L2 advances every citizen identically at transitions via a scheduled table; nobody ticks
- **FR50** — A citizen decides by a calendar of obligations plus a utility evaluator over 4-5 bars (money, rest, hunger, social, pursuit drive) weighted by habit and traits
- **FR51** — Every citizen carries a small fixed trait vector - caution, ambition, diligence, sociability, frugality - used as weights in the same evaluator that scores an evening and an inbox
- **FR52** — Decisions are made one step at a time using current belief. No plans, no committed chains for bodies, no invalidation logic
- **FR53** — Citizens act on stale belief and re-decide on the spot when reality contradicts it; externally visible state is observed on passing, not on entering
- **FR54** — No knowledge is broadcast anywhere in the system; information travels through physical carriers - a sign, a colleague at handover, a council notice
- **FR55** — Citizen memory is keyed on business rather than location, written only on surprise, self-clearing when reality returns to the default, and LRU-capped at ~50 places
- **FR56** — Far agents carry no coordinates; position derives from At(node) or InTransit(route, t_depart, t_arrive)
- **FR57** — Populating a region is a spatio-temporal query, not a promotion: which agents' route segments or located activities intersect region R at time t
- **FR58** — Bodies instantiate only in observed regions, with a margin beyond the viewport and hysteresis on despawn so citizens walk in rather than pop in
- **FR59** — Subscriptions prefetch along intent rather than position; a known destination and arrival time warm the destination region during transit
- **FR60** — NPC own-time and player lateral pursuits draw on one catalogue and one system
- **FR61** — A citizen's appearance is a stable tuple of five layer indices (body, eyes, outfit, hairstyle, accessory), deterministic from citizen id, so the same barista looks the same forever
- **FR62** — The outfit layer is role-driven, so occupation is readable by looking at a street
- **FR63** — NPCs route on the navmesh at tile level and never perform sub-tile collision
- **FR64** — L3 drives steering, local avoidance, gait and flavour behaviour for instantiated bodies only, client-side, and never writes to the ledger
- **FR65** — Flavour behaviour and animation phase are seeded from stable ids so all clients show the same frame at the same time

### L1, institutions and matters

- **FR66** — L1 supplies only exogenous inputs - external commodity prices, in-migration, weather - and has no access to player state
- **FR67** — There is no city-wide wage and no city-wide price. Employers set offered wages on job postings; businesses set their own prices
- **FR68** — Labour market self-balancing emerges from many employers each responding to their own unfilled posts
- **FR69** — A matter is an item of institutional business scoped to a jurisdiction (a profession) and to a place, business, department or the city
- **FR70** — Matters arrive through exactly four fluxes, each with a person and a physical carrier: citizen-filed, worker escalation, inter-institutional request, and calendar
- **FR71** — A routine job's procedure step detecting an out-of-range condition emits an escalation - a threshold has no author, but a worker noticing does
- **FR72** — A decider on shift scores the open matters in their jurisdiction, picks one and acts
- **FR73** — Matter scoring weighs severity, age (rising, so nothing starves), cost against available budget, jurisdiction fit, disposition, and who raised it - the last term reading the decider's own citizen memory
- **FR74** — Approve, Deny, Defer and Escalate are all first-class decider actions
- **FR75** — A decision record carries the action, a reason code and the severity at the time of the decision; re-raising the same request scores near zero unless current severity exceeds that mark by a margin
- **FR76** — A denial closes the chain but does nothing to the evidence; complaints keep arriving because the condition persists
- **FR77** — Denial produces four trait-weighted responses: wait, escalate to a different jurisdiction, substitute a cheaper mechanism, or reroute permanently
- **FR78** — Deferred matters are the demand signal the calendar's budget review drains
- **FR79** — Matters expire after N in-city weeks if unresolved and unrefreshed
- **FR80** — Complaint filing probability has a floor, so habituation cannot starve the signal entirely
- **FR81** — Institutional chains run investigation -> approval -> budget -> procurement -> logistics -> labour, as durable multi-step workflows surviving restarts, deploys and multi-day latency
- **FR82** — Each chain link is an occupation with its own work loop, holdable by an AI citizen or a player, with no mechanical seam between them
- **FR83** — Response time - how fast the ambulance arrives - is determined by a budget decision made in a building the player has never entered
- **FR84** — The plastic-bottle reference chain runs end to end: sanitation budget shortfall -> unemptied bin -> dropped bottle -> street degrades -> complaints filed -> budget chain opens
- **FR85** — Litter licenses litter, reversibly - by the sanitation chain and by any citizen who bins the bottle

### Stock, logistics and money mechanics

- **FR86** — Items are defined types carrying a unit, perishability and bulk
- **FR87** — Stock is held by a holder - a business instance, a citizen, a vehicle, a building or a municipal facility - and sits on the business instance, not the room and not the brand
- **FR88** — Recipes convert input items plus labour minutes into output items
- **FR89** — Stock quantities change only inside a work-procedure step or a consumption event, never by fiat
- **FR90** — A procedure step finding stock below threshold emits an order; an order is a chain instance (placed -> accepted -> picked -> loaded -> in transit -> delivered) performed by existing occupations
- **FR91** — A supplier whose own stock depletes orders from outside the city at an externally-set price - the only legitimate exogenous number
- **FR92** — Physical cash is ordinary stock and denominations are items, so a till can run short of change and the payment procedure branches on it
- **FR93** — Bank money is a balance per holder, used for evaluation; card payment settles against the account with no cash movement
- **FR94** — Containers hold items on a rotation-capable grid, with item footprints reused unchanged from world footprints
- **FR95** — An item is in exactly one of two states: placed in the world, or held by a container. There is no parent relationship
- **FR96** — Bulk quantities are held inside a discrete container instance - a sack occupying 1x2 and holding 340g
- **FR97** — NPCs pack containers with first-fit on the real grid, never an abstract volume check
- **FR98** — A delivery vehicle has a grid, so loading a round is a packing problem and a badly packed van simply fits less

### Progression

- **FR99** — Institutional advancement is gated twice - by qualification and by vacancy
- **FR100** — Qualification is bought with minutes taken from own-time (evening classes, courses, licences), never with money alone
- **FR101** — A vacancy is an actual open post in an actual institution, opening when someone leaves, and requires an application
- **FR102** — Progression carriers are diegetic: the certificate on the wall, the licence in the wallet, the name on a roster, a set of keys
- **FR103** — Three lateral pursuits ship in v1: cooking, collecting and a sport or club, each with its own physical carrier and economic interaction
- **FR104** — There is no experience bar, no level, no skill tree, no net-worth display and no counters anywhere
- **FR105** — Job access tiers are the project's primary scope valve and are configurable as a dial
- **FR106** — Positional consequence persists: decisions made in a role outlast the player's presence in it

### City generation and the world

- **FR107** — Everything is procedurally generated from a city seed - street layout, plot subdivision, building exteriors, and interiors. Nothing is hand-placed
- **FR108** — Seed plus rule-set version reproduces the same city; the city is generated once and persisted, never re-rolled
- **FR109** — The city records the rule-set version it was generated under, and rule changes do not regenerate it
- **FR110** — Generation runs multi-pass, coarse to fine: land use -> street network -> plot subdivision -> building envelope -> building type -> interior layout -> prop placement
- **FR111** — Generation rules are data in `defs/`, evaluated by a generic engine, across five constraint kinds: placement, distribution, coherence, adjacency and requirement
- **FR112** — The generator applies the rules and the validation harness checks output against the same rules, reading one source
- **FR113** — Neighbourhood character derives from four generator parameters: density, building age, affluence and land-use mix
- **FR114** — 100+ interiors are enterable at MVP
- **FR115** — Building footprints are sized by interior usability, not street frontage alone
- **FR116** — Institutions are placed as generated types under placement constraints: depot, council, hospital, welfare office, shelters, shops, cafes
- **FR117** — World addressing is (x, y, floor, layer); collision tests only within an entity's current floor, with explicit transition cells at stairs, ladders, ramps and manholes
- **FR118** — Interiors live in the same tilemap at their building's footprint - no separate spaces, no portals, and doors are ordinary walkable cells
- **FR119** — Cells carry a building/room ownership id, used for wall retraction, room grammar and enclosure culling
- **FR120** — Near-side wall retraction hides the walls of the building the player occupies
- **FR121** — Windows are semi-transparent wall tiles; interior furniture behind them renders normally
- **FR122** — The subway floor is culled until entered, at which point the street floor above is culled instead
- **FR123** — Depth sorting uses the key (y, layer_rank, x, object_id) over one y-sorted pool after three flat passes; objects are never sliced
- **FR124** — Floor is a vertical screen offset, not a sort key
- **FR125** — Multi-cell props decompose into per-cell drawables, each with its own anchor
- **FR126** — Tilemap rows are placed object instances at their anchor cell; a multi-cell prop is one row and extent comes from `object_def`
- **FR127** — Object footprints are capped at approximately 8x8; larger structures compose from multiple objects
- **FR128** — Absence of a collider is walkability; there is no separate walkable flag, and `collider` must be contained within `footprint`
- **FR129** — The nav graph is a generation output, versioned and incrementally patchable, reproducible from seed plus patch log
- **FR130** — The macro routing graph carries edge costs denominated in minutes, and its source nodes advertise provisions, serving as the index of what the city offers
- **FR131** — Utility scoring uses Manhattan distance converted to minutes, computed fresh, with no cached distances and no graph traversal in the scoring path
- **FR132** — One A* runs for the chosen destination only, after the choice; commute routes are cached on the citizen and recomputed only on disturbance
- **FR133** — A cached route is the belief: a citizen hitting a newly blocked edge re-routes and overwrites; a citizen computing a fresh route uses the patched graph
- **FR134** — Interiors collapse to an entrance node in the macro graph, plus an internal node for large buildings
- **FR135** — The client never sees the macro graph; it holds derived walkability and receives a citizen's chosen route in their L2 state

### Client, netcode and boot

- **FR136** — Simulation is authoritative server-side; the browser is a thin client that renders and takes input
- **FR137** — Player movement and collision are fully client-authoritative, with no server-side plausibility checking in v1
- **FR138** — Player position is one row per player, overwritten in place, serving simultaneously as the hot rendering channel and the durable state; start at 10 Hz
- **FR139** — Multiple concurrent clients stand in one city and see each other move
- **FR140** — Reconnection has no seam - the player returns exactly where cause and elapsed time put them
- **FR141** — Identity is anonymous-first, issued by SpacetimeDB during the WebSocket handshake and stored in localStorage, with optional OIDC linking later
- **FR142** — A character-to-identity mapping table (one character, N identities) exists from the first schema
- **FR143** — The player is prompted to link an account at a natural diegetic moment, since clearing browser data would otherwise orphan an unlinked character permanently
- **FR144** — First visit shows an inline DOM name prompt in the HTML shell, interactive at first paint with zero game assets loaded, while the full payload streams behind it
- **FR145** — The player is controllable within 1 second of submitting their name; first-ever spawn is the player's flat interior, with the street streaming behind the door
- **FR146** — Return visits show no prompt and reach controllable in under 1 second, spawning wherever cause and elapsed time put the character
- **FR147** — A `defs_version` handshake at connect covers asset definitions and schema/protocol version, refreshing a stale client on mismatch
- **FR148** — Input produces intents, not actions: a click resolves to an object instance, checks reachability against `interact_at`, and emits an intent whose meaning is the procedure's business
- **FR149** — Movement is WASD/arrow keys, continuous, on an oblique tile grid; keybindings live in localStorage behind an options menu
- **FR150** — All UI is DOM except transient, object-bound container views drawn in canvas; nothing persistent, global or abstract is ever drawn into the canvas
- **FR151** — The DOM UI surface is exactly the boot name prompt, an options menu (audio, display, controls) and connection-state notices
- **FR152** — Anything informational that belongs to the fiction is rendered in the world - job boards, council notices, a certificate on the wall
- **FR153** — Ambient audio beds crossfade by environment, neighbourhood character and time of day, with interior/exterior transition by low-pass filter
- **FR154** — Diegetic music is a positional emitter (a radio, a busker); there is no music system and no composed score
- **FR155** — Earshot is deliberately larger than the viewport, so a tram heard but not seen is evidence the city is running
- **FR156** — Audio reads the same derived state as the renderer; there is no separate audio simulation

### Growth

- **FR157** — New neighbourhoods are generated adjacent to district one, keyed to active player population, so there is always somewhere affordable to begin
- **FR158** — Growth is delivered by a development chain: survey -> approval -> budget -> procurement -> construction
- **FR159** — Construction is physically visible - sites, hoardings, converted buildings, buildings appearing over time
- **FR160** — New neighbourhoods run under the current rule-set version, so a district extended later may look visibly different
- **FR161** — New businesses arise from an L2 own-time decision by a citizen with savings weighing unmet local demand, vacant premises rent, capital and qualifications
- **FR162** — New citizens arrive through in-migration, exogenous and modulated by the city's attractiveness to people outside it

### UX surfaces

- **FR173** — An object the pointer is over is affordance-marked when it declares an interaction and the player is within its `interact_at` - a transient highlight drawn on that object's own drawables, plus a browser cursor change. Reachable-but-unhovered objects get no treatment; hovered-but-unreachable objects get the cursor only, never the highlight
- **FR174** — The player carries an item in hand, visible on the character sprite, with no view of any kind. Hands hold one item
- **FR175** — The player has no inventory. Carried items live in a bag, which is a world object with its own grid from `object_def`, viewed exactly as any other container - so nothing persistent, global or abstract is ever drawn
- **FR176** — A container view is drawn in canvas in the game's own pixel style, anchored to the container it belongs to, one at a time, with no capacity readout; an item that does not fit is shown by not fitting
- **FR177** — While the payload streams, the name prompt is the page - no loading screen, spinner or progress bar. The page title and favicon name the city
- **FR178** — A character is driven by exactly one tab. The most recent tab holds the character; an earlier tab is told plainly that the character is being driven elsewhere and is not controllable
- **FR179** — A browser refresh behaves as a reconnection rather than a restart. Connection loss mid-procedure snaps the procedure state machine to its current step boundary and resumes there
- **FR180** — Handover teaches a procedure the player has not performed before: the outgoing worker walks the steps in the world on the actual props. Repetition is available by talking to a colleague and costs minutes like any conversation
- **FR181** — The opening minutes run flat, door, commute, shift-with-handover, payment, rent - ordered system beats rather than scripted content

### Tooling and observability

- **FR163** — Time control - a clock multiplier and the ability to jump the clock - is available in development builds
- **FR164** — A causality inspector answers "why is this citizen here?" from L2 state, route, current matter and last decision
- **FR165** — Debug overlays render collision footprints, navmesh, chunk boundaries, sort order and citizen routes
- **FR166** — A matter/chain inspector shows an institution's inbox and its chains' states
- **FR167** — A determinism harness regenerates from seed and diffs the result
- **FR168** — Debug tooling is compiled in behind a flag not exposed in production, and presented in a deliberately non-diegetic style
- **FR169** — A scheduled reducer samples per-table row counts and bytes on a slow cadence into a metrics table
- **FR170** — An external watcher subscribes to that metrics table and alerts when a table exceeds its declared threshold or total storage crosses the review trigger
- **FR171** — The same observability pipeline serves table growth, TeV per reducer class, the five gameplay metrics and the outstanding benchmarks
- **FR172** — The five gameplay metrics are instrumented: voluntary time in the discretionary middle, perceived aliveness at one connected player, return rate after absence, minute-spend split, and unprompted noticing

## Non-functional

### Performance and platform

- **NFR1** — Cold boot to player-controllable in under 1 second, measured from navigation on a mid-range laptop over a typical domestic connection, including load, with no character creation ceremony
- **NFR2** — Sustained 60 FPS at 1080p over a 10-minute session including a busy street at rush hour and an interior transition
- **NFR3** — The server tick is continuous and never spins down; the city simulates with zero clients connected
- **NFR4** — Reconnection has zero seam; nothing is suspended, so nothing needs resuming
- **NFR5** — Browser exclusive and non-negotiable - no install, no plugin, no download gate
- **NFR6** — Mouse and keyboard only; no controller and no touch support in v1
- **NFR7** — A busy street at rush hour must read as busy and a residential street at 3am must read as quiet; aliveness is measured per screen, not per database
- **NFR8** — District edges must read as character rather than as budget; emptiness must look intentional
- **NFR9** — Individual agents must be encounterable often enough to become familiar
- **NFR10** — AI citizens must carry the entire feeling of aliveness at one connected player; player count must never be the source of the city feeling populated
- **NFR11** — Client-side L3 for ~200 agents in a busy bubble must stay within roughly 2 ms per frame; exceeding it overturns D-L3
- **NFR12** — Simultaneously bound atlas textures must stay under the GPU texture-unit limit (target ~8)

### Cost and capacity

- **NFR13** — Monthly server spend is bounded and self-funded, sustained for years before revenue, on Maincloud Pro ($25/mo, ~120M calls, ~500 GB egress, ~40 GB storage)
- **NFR14** — Launch scale is 512 x 512 cells (~435 m square), ~5,000 citizens, ~42 L2 transactions/sec, ~108M calls/month — inside Maincloud Pro's allowance with zero overage. The 1024-squared district and its ~20,000 citizens remain the growth target
- **NFR15a** — Local citizen density is held constant across all map sizes at 1 citizen per 52.4 cells (~26,400 per km squared). Aliveness is per screen, so shrinking the map reduces the number of busy streets, never the busy-ness of one
- **NFR15** — Storage carries a hard wall of ~40 GB and a review trigger at 10 GB; the launch estimate is ~200 MB
- **NFR16** — Egress must stay within budget by keeping L3 client-simulated (~2.4 GB/month) rather than assigning ownership (~520-1,040 GB/month)
- **NFR17** — TeV per reducer class is instrumented from day one so scaling decisions rest on measurement, not on published conversions

### Correctness and integrity

- **NFR18** — Every state change has an author. Any reducer that both detects a condition and changes the world without a citizen in between is wrong by construction
- **NFR19** — The Truth Test holds: the event would have happened identically had no player ever come. Nothing is authored into being by proximity
- **NFR20** — Every bounded quantity tends toward an equilibrium the non-player simulation actively tries to reach; a quantity that drifts with nothing pursuing it is incomplete and does not ship
- **NFR21** — Consequence needs a physical carrier - and so does knowledge. No morality meters, reputation auras, approval scores or invisible simulation
- **NFR22** — Progression is carried diegetically. There is no HUD with net worth, balances, counters or objective markers
- **NFR23** — L3 may never write to the ledger; micro state is non-authoritative and discardable, and despawn snaps to the ledger
- **NFR24** — There is no mechanical seam between a role held by a player and the same role held by an AI citizen
- **NFR25** — Generation is deterministic under integer/fixed-point arithmetic, ordered collections, a pinned RNG and versioned rule sets
- **NFR26** — Client-derived values that must agree across clients are seeded from stable ids, never from local RNG

### Maintainability and schema

- **NFR27** — Systems are uniform, data-driven and heavily testable, so that agents can extend and validate them. This is a design-level requirement, not an implementation preference
- **NFR28** — `sim/` is pure and never reads a table; `reducers/` read tables, call pure functions and write tables. This is the only boundary in the project that can be violated silently
- **NFR29** — Property tests over `sim/` run thousands of simulated citizen-weeks in CI with no database
- **NFR30** — No code is shared between `server/` and `client/`; the two footprint parsers are deliberate
- **NFR31** — `defs/` is the only source of truth; both targets consume generated output, never each other, under one `defs_version`
- **NFR32** — The client writes only player position and intents; everything else is server-authoritative
- **NFR33** — The schema is additive only: primary keys and unique constraints are permanent and must be correct in the first commit; columns are appended with defaults; new concepts are new tables with read-through backfill
- **NFR34** — Anything that might ever need scheduling must be created as a scheduled table; a normal table can never become one
- **NFR35** — Tables stay narrow, for frequency-split, wholesale-replacement and migration-blast-radius reasons together
- **NFR36** — Extensible sets use `u32` codes plus a companion data table, never enums, because a new variant must be a row insert rather than a migration
- **NFR37** — Every table declares a bound, either game-mechanical or an engineering ceiling, machine-readable and registered with the metrics sampler. An unbounded table is a bug
- **NFR38** — Incremental (lazy) migration is the standard workflow, not the emergency one
- **NFR39** — The world must be backed up before every migration, and the restore must have been tested
- **NFR40** — There is no server-side event bus; if a system needs to know something, it reads a table
- **NFR41** — Server reducers return `Result` and never panic in normal flow; aborting is always better than writing inconsistent state
- **NFR42** — The client degrades to not-drawing, never to crashing; a bad row, an unknown `def_id` or a failed asset load must never kill the frame
- **NFR43** — If a person in the world could observe it and shrug, it is not an error. Empty till, no beans, denied budget, closed cafe, blocked route and stalled chain are content, not errors
- **NFR44** — Logging is by exception, not by event, with structured fields; logs and observability are separate systems and must not be merged
- **NFR45** — Balance parameters live in tables and are runtime-tunable; constants are compiled; definitions are baked under `defs_version`
- **NFR46** — Live parameters and seed values are visibly marked, because tuning a seed value on a running world has no effect
