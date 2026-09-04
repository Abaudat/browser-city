---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/gdds/gdd-BrowserCity-2026-08-25/gdd.md
  - _bmad-output/planning-artifacts/architecture/architecture-BrowserCity-2026-08-25/architecture.md
---

# BrowserCity - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for BrowserCity, decomposing the requirements from the GDD, UX Design if it exists, and Architecture requirements into implementable stories.

**Source note.** Two input documents only: the GDD (2026-08-25) and the Architecture (2026-08-25, complete, 21 decisions). No UX Design Specification exists for this project. An earlier design-level epic charter lived at `gdds/gdd-BrowserCity-2026-08-25/epics.md`; it was superseded by this document and has since been removed. Where the architecture's findings superseded it, this document folded those findings in rather than inheriting the earlier structure. These files are the sole authoritative epic breakdown: this index for the global sections, and one `epic-N.md` per epic.

## Requirements Inventory

### Functional Requirements

**Time and the core loop**

FR1: One in-city day equals 60 real minutes; one in-city hour equals 2.5 real minutes.
FR2: The in-city clock is detached from real-world time, so a player rotates through all in-city hours across their real week.
FR3: The clock advances continuously whether or not any client is connected; the server never spins down.
FR4: The player's day is composed of sleep (8 in-city hours), work (8h), commute (2h) and own-time (6h).
FR5: The core loop runs wake -> commute -> shift -> paid -> spend -> rent -> sleep, and repeats.
FR6: The commute costs in-city minutes each leg and is the player's primary sensor on the city's state.
FR7: The commute has a floor of roughly 20 in-city minutes per leg; it can never reach zero.
FR8: At sleep the player may either log off (understudy takes the life) or stay up and work a borrowed night shift.

**Shift work and procedure**

FR9: Every playable job runs a four-beat template: ritual open (~30 in-city min), rhythmic duties (~3h), discretionary middle (~4h), ritual close (~30 min).
FR10: Props carry state, and that state is visible on the object itself, never in a UI readout (till change, stamp ink, grinder hopper, bin lorry fill).
FR11: Multi-step procedures are performed on world objects in sequence, not selected from a menu.
FR12: A procedure can be performed badly - missed bins, short-changing, a bad shot, harsh braking - and the world reflects it.
FR13: No job carries a score. Self-imposed standards (cleaning the lobby) are never required, tracked or rewarded, but do change the world.
FR14: Five playable jobs ship at launch: convenience shop till, security guard (empty building), sanitation/bin round, night bus driver, cafe barista.
FR15: Freedom scales inversely with supervision; the least supervised post is the most interesting one.
FR16: Procedures are built so that some may physically require two people; the principle ships, the content does not.
FR17: Routine jobs are a fixed sequence of steps over local state, with decisions expressible as procedure branches.
FR18: Decider jobs are agenda selection over non-local information - a citizen whose work-time option set is matters instead of procedure steps.

**Rent, money and the time economy**

FR19: Rent falls due every 7 in-city days, whether or not the player earned.
FR20: Entry wage is 10 per in-city hour (80/day, 560/week gross); starting edge-flat rent is 250/week; food and necessities ~90/week.
FR21: Rent can be split through a shared tenancy (flatshare), halving the metronome from 250 to 125 per week.
FR22: Missing rent triggers Ruin By Process - notice, escalation, judgment, enforcement - each link a job somebody holds and a moment the player can intervene, negotiate, pay or appeal.
FR23: There is no eviction fail-state, no death, no scoring and no state from which a player cannot return.
FR24: Destitution is inhabitable: welfare offices and shelters are simulated institutions with player-holdable roles.
FR25: Injury costs days and savings and routes the player through hospital institutions (paramedic, triage, nurse, surgeon, admin, billing).
FR26: A bike costs 450 one-time and halves the walking commute to 30 in-city minutes each way.
FR27: A transit pass costs 20/week; closer flats cost roughly +130/week rent.
FR28: Transport mode acts as an edge-cost modifier on the macro routing graph, so the transport ladder is a shortest-path problem over the same graph the AI routes on.
FR29: Money exists only as stored time; no system may introduce a resource that competes with time as the scarce thing.

**The verb vocabulary**

FR30: Presence verbs are supported - sit, order, wait, watch - as actions whose entire payload is being somewhere.
FR31: Civic verbs are supported - bin the bottle, hold the door, give up the seat - operating on single world objects.
FR32: Binning a bottle reverses the litter loop at the scale of one object, giving the player a hand in the physical-carrier law.
FR33: Conversation is loitering: chosen sentence by sentence, priced in minutes, with no dialogue tree and no branching script.
FR34: Dignity work is supported - the ramp, the ticket, the correct change - as small competent courtesies to specific people.

**Reciprocal occupancy**

FR35: A citizen body has exactly one driver, and the driver is swappable between SelfL2, Understudy and Player.
FR36: On disconnect an AI understudy holds the player's life with a fixed, non-configurable, conservative mandate: works, pays rent, eats, sleeps, banks the surplus, never gambles, never quits.
FR37: The understudy is additive only. It never subtracts, replaces, consumes, degrades or rearranges. Necessities are paid as a cost line, not consumed from the player's inventory.
FR38: For any absence duration, the player's inventory is a superset of what they left and no owned item's state has degraded.
FR39: The absent character reconciles as a record and settles on return; payslips and receipts survive as additive physical objects.
FR40: The trace of an absence is the changed world - a new hoarding, an advanced chain - not the player's possessions and not a summary readout.
FR41: The understudy earns the same wage the player would, never more and never less.
FR42: Staying up past bedtime offers the player a few available night posts, chosen non-diegetically, sized by a tiredness cap.
FR43: Borrowed night shifts are anonymous, do not accumulate, and place consequence on the NPC rather than the player. They are always available and always pay.
FR44: Any unheld institutional post is backfilled by that citizen's own L2 continuing - AI backfill is not a separate mechanism.
FR45: Handover between drivers happens mid-procedure in both directions, snapping to the current step boundary; the procedure state machine is the shared substrate.
FR46: The discretionary middle is discretionary within the procedure's state space; a player may perform a procedure badly but never outside it.
FR47: No system may punish logging off. Services degrade only when someone chooses it, never because the server was quiet.

**Citizens and the simulation**

FR48: Every citizen has a home, a job, a schedule, stable preferences and ends of their own.
FR49: L2 advances every citizen identically at transitions via a scheduled table; nobody ticks.
FR50: A citizen decides by a calendar of obligations plus a utility evaluator over 4-5 bars (money, rest, hunger, social, pursuit drive) weighted by habit and traits.
FR51: Every citizen carries a small fixed trait vector - caution, ambition, diligence, sociability, frugality - used as weights in the same evaluator that scores an evening and an inbox.
FR52: Decisions are made one step at a time using current belief. No plans, no committed chains for bodies, no invalidation logic.
FR53: Citizens act on stale belief and re-decide on the spot when reality contradicts it; externally visible state is observed on passing, not on entering.
FR54: No knowledge is broadcast anywhere in the system; information travels through physical carriers - a sign, a colleague at handover, a council notice.
FR55: Citizen memory is keyed on business rather than location, written only on surprise, self-clearing when reality returns to the default, and LRU-capped at ~50 places.
FR56: Far agents carry no coordinates; position derives from At(node) or InTransit(route, t_depart, t_arrive).
FR57: Populating a region is a spatio-temporal query, not a promotion: which agents' route segments or located activities intersect region R at time t.
FR58: Bodies instantiate only in observed regions, with a margin beyond the viewport and hysteresis on despawn so citizens walk in rather than pop in.
FR59: Subscriptions prefetch along intent rather than position; a known destination and arrival time warm the destination region during transit.
FR60: NPC own-time and player lateral pursuits draw on one catalogue and one system.
FR61: A citizen's appearance is a stable tuple of five layer indices (body, eyes, outfit, hairstyle, accessory), deterministic from citizen id, so the same barista looks the same forever.
FR62: The outfit layer is role-driven, so occupation is readable by looking at a street.
FR63: NPCs route on the navmesh at tile level and never perform sub-tile collision.
FR64: L3 drives steering, local avoidance, gait and flavour behaviour for instantiated bodies only, client-side, and never writes to the ledger.
FR65: Flavour behaviour and animation phase are seeded from stable ids so all clients show the same frame at the same time.

**L1, institutions and matters**

FR66: L1 supplies only exogenous inputs - external commodity prices, in-migration, weather - and has no access to player state.
FR67: There is no city-wide wage and no city-wide price. Employers set offered wages on job postings; businesses set their own prices.
FR68: Labour market self-balancing emerges from many employers each responding to their own unfilled posts.
FR69: A matter is an item of institutional business scoped to a jurisdiction (a profession) and to a place, business, department or the city.
FR70: Matters arrive through exactly four fluxes, each with a person and a physical carrier: citizen-filed, worker escalation, inter-institutional request, and calendar.
FR71: A routine job's procedure step detecting an out-of-range condition emits an escalation - a threshold has no author, but a worker noticing does.
FR72: A decider on shift scores the open matters in their jurisdiction, picks one and acts.
FR73: Matter scoring weighs severity, age (rising, so nothing starves), cost against available budget, jurisdiction fit, disposition, and who raised it - the last term reading the decider's own citizen memory.
FR74: Approve, Deny, Defer and Escalate are all first-class decider actions.
FR75: A decision record carries the action, a reason code and the severity at the time of the decision; re-raising the same request scores near zero unless current severity exceeds that mark by a margin.
FR76: A denial closes the chain but does nothing to the evidence; complaints keep arriving because the condition persists.
FR77: Denial produces four trait-weighted responses: wait, escalate to a different jurisdiction, substitute a cheaper mechanism, or reroute permanently.
FR78: Deferred matters are the demand signal the calendar's budget review drains.
FR79: Matters expire after N in-city weeks if unresolved and unrefreshed.
FR80: Complaint filing probability has a floor, so habituation cannot starve the signal entirely.
FR81: Institutional chains run investigation -> approval -> budget -> procurement -> logistics -> labour, as durable multi-step workflows surviving restarts, deploys and multi-day latency.
FR82: Each chain link is an occupation with its own work loop, holdable by an AI citizen or a player, with no mechanical seam between them.
FR83: Response time - how fast the ambulance arrives - is determined by a budget decision made in a building the player has never entered.
FR84: The plastic-bottle reference chain runs end to end: sanitation budget shortfall -> unemptied bin -> dropped bottle -> street degrades -> complaints filed -> budget chain opens.
FR85: Litter licenses litter, reversibly - by the sanitation chain and by any citizen who bins the bottle.

**Stock, logistics and money mechanics**

FR86: Items are defined types carrying a unit, perishability and bulk.
FR87: Stock is held by a holder - a business instance, a citizen, a vehicle, a building or a municipal facility - and sits on the business instance, not the room and not the brand.
FR88: Recipes convert input items plus labour minutes into output items.
FR89: Stock quantities change only inside a work-procedure step or a consumption event, never by fiat.
FR90: A procedure step finding stock below threshold emits an order; an order is a chain instance (placed -> accepted -> picked -> loaded -> in transit -> delivered) performed by existing occupations.
FR91: A supplier whose own stock depletes orders from outside the city at an externally-set price - the only legitimate exogenous number.
FR92: Physical cash is ordinary stock and denominations are items, so a till can run short of change and the payment procedure branches on it.
FR93: Bank money is a balance per holder, used for evaluation; card payment settles against the account with no cash movement.
FR94: Containers hold items on a rotation-capable grid, with item footprints reused unchanged from world footprints.
FR95: An item is in exactly one of two states: placed in the world, or held by a container. There is no parent relationship.
FR96: Bulk quantities are held inside a discrete container instance - a sack occupying 1x2 and holding 340g.
FR97: NPCs pack containers with first-fit on the real grid, never an abstract volume check.
FR98: A delivery vehicle has a grid, so loading a round is a packing problem and a badly packed van simply fits less.

**Progression**

FR99: Institutional advancement is gated twice - by qualification and by vacancy.
FR100: Qualification is bought with minutes taken from own-time (evening classes, courses, licences), never with money alone.
FR101: A vacancy is an actual open post in an actual institution, opening when someone leaves, and requires an application.
FR102: Progression carriers are diegetic: the certificate on the wall, the licence in the wallet, the name on a roster, a set of keys.
FR103: Three lateral pursuits ship in v1: cooking, collecting and a sport or club, each with its own physical carrier and economic interaction.
FR104: There is no experience bar, no level, no skill tree, no net-worth display and no counters anywhere.
FR105: Job access tiers are the project's primary scope valve and are configurable as a dial.
FR106: Positional consequence persists: decisions made in a role outlast the player's presence in it.

**City generation and the world**

FR107: Everything is procedurally generated from a city seed - street layout, plot subdivision, building exteriors, and interiors. Nothing is hand-placed.
FR108: Seed plus rule-set version reproduces the same city; the city is generated once and persisted, never re-rolled.
FR109: The city records the rule-set version it was generated under, and rule changes do not regenerate it.
FR110: Generation runs multi-pass, coarse to fine: land use -> street network -> plot subdivision -> building envelope -> building type -> interior layout -> prop placement.
FR111: Generation rules are data in `defs/`, evaluated by a generic engine, across five constraint kinds: placement, distribution, coherence, adjacency and requirement.
FR112: The generator applies the rules and the validation harness checks output against the same rules, reading one source.
FR113: Neighbourhood character derives from four generator parameters: density, building age, affluence and land-use mix.
FR114: 100+ interiors are enterable at MVP.
FR115: Building footprints are sized by interior usability, not street frontage alone.
FR116: Institutions are placed as generated types under placement constraints: depot, council, hospital, welfare office, shelters, shops, cafes.
FR117: World addressing is (x, y, floor, layer); collision tests only within an entity's current floor, with explicit transition cells at stairs, ladders, ramps and manholes.
FR118: Interiors live in the same tilemap at their building's footprint - no separate spaces, no portals, and doors are ordinary walkable cells.
FR119: Cells carry a building/room ownership id, used for wall retraction, room grammar and enclosure culling.
FR120: Near-side wall retraction hides the walls of the building the player occupies.
FR121: Windows are semi-transparent wall tiles; interior furniture behind them renders normally.
FR122: The subway floor is culled until entered, at which point the street floor above is culled instead.
FR123: Depth sorting uses the key (y, layer_rank, x, object_id) over one y-sorted pool after three flat passes; objects are never sliced.
FR124: Floor is a vertical screen offset, not a sort key.
FR125: Multi-cell props decompose into per-cell drawables, each with its own anchor.
FR126: Tilemap rows are placed object instances at their anchor cell; a multi-cell prop is one row and extent comes from `object_def`.
FR127: Object footprints are capped at approximately 8x8; larger structures compose from multiple objects.
FR128: Absence of a collider is walkability; there is no separate walkable flag, and `collider` must be contained within `footprint`.
FR129: The nav graph is a generation output, versioned and incrementally patchable, reproducible from seed plus patch log.
FR130: The macro routing graph carries edge costs denominated in minutes, and its source nodes advertise provisions, serving as the index of what the city offers.
FR131: Utility scoring uses Manhattan distance converted to minutes, computed fresh, with no cached distances and no graph traversal in the scoring path.
FR132: One A* runs for the chosen destination only, after the choice; commute routes are cached on the citizen and recomputed only on disturbance.
FR133: A cached route is the belief: a citizen hitting a newly blocked edge re-routes and overwrites; a citizen computing a fresh route uses the patched graph.
FR134: Interiors collapse to an entrance node in the macro graph, plus an internal node for large buildings.
FR135: The client never sees the macro graph; it holds derived walkability and receives a citizen's chosen route in their L2 state.

**Client, netcode and boot**

FR136: Simulation is authoritative server-side; the browser is a thin client that renders and takes input.
FR137: Player movement and collision are fully client-authoritative, with no server-side plausibility checking in v1.
FR138: Player position is one row per player, overwritten in place, serving simultaneously as the hot rendering channel and the durable state; start at 10 Hz.
FR139: Multiple concurrent clients stand in one city and see each other move.
FR140: Reconnection has no seam - the player returns exactly where cause and elapsed time put them.
FR141: Identity is anonymous-first, issued by SpacetimeDB during the WebSocket handshake and stored in localStorage, with optional OIDC linking later.
FR142: A character-to-identity mapping table (one character, N identities) exists from the first schema.
FR143: The player is prompted to link an account at a natural diegetic moment, since clearing browser data would otherwise orphan an unlinked character permanently.
FR144: First visit shows an inline DOM name prompt in the HTML shell, interactive at first paint with zero game assets loaded, while the full payload streams behind it.
FR145: The player is controllable within 1 second of submitting their name; first-ever spawn is the player's flat interior, with the street streaming behind the door.
FR146: Return visits show no prompt and reach controllable in under 1 second, spawning wherever cause and elapsed time put the character.
FR147: A `defs_version` handshake at connect covers asset definitions and schema/protocol version, refreshing a stale client on mismatch.
FR148: Input produces intents, not actions: a click resolves to an object instance, checks reachability against `interact_at`, and emits an intent whose meaning is the procedure's business.
FR149: Movement is WASD/arrow keys, continuous, on an oblique tile grid; keybindings live in localStorage behind an options menu.
FR150: All UI is DOM except transient, object-bound container views drawn in canvas; nothing persistent, global or abstract is ever drawn into the canvas.
FR151: The DOM UI surface is exactly the boot name prompt, an options menu (audio, display, controls) and connection-state notices.
FR152: Anything informational that belongs to the fiction is rendered in the world - job boards, council notices, a certificate on the wall.
FR153: Ambient audio beds crossfade by environment, neighbourhood character and time of day, with interior/exterior transition by low-pass filter.
FR154: Diegetic music is a positional emitter (a radio, a busker); there is no music system and no composed score.
FR155: Earshot is deliberately larger than the viewport, so a tram heard but not seen is evidence the city is running.
FR156: Audio reads the same derived state as the renderer; there is no separate audio simulation.

**Growth**

FR157: New neighbourhoods are generated adjacent to district one, keyed to active player population, so there is always somewhere affordable to begin.
FR158: Growth is delivered by a development chain: survey -> approval -> budget -> procurement -> construction.
FR159: Construction is physically visible - sites, hoardings, converted buildings, buildings appearing over time.
FR160: New neighbourhoods run under the current rule-set version, so a district extended later may look visibly different.
FR161: New businesses arise from an L2 own-time decision by a citizen with savings weighing unmet local demand, vacant premises rent, capital and qualifications.
FR162: New citizens arrive through in-migration, exogenous and modulated by the city's attractiveness to people outside it.

**UX surfaces**

*(Added 2026-08-29 from the UX Specification. These surfaces had no owner in any document; FR175 additionally resolves a contradiction between D19's grid inventories and D17's canvas rule.)*

FR173: An object the pointer is over is affordance-marked when it declares an interaction and the player is within its `interact_at` - a transient highlight drawn on that object's own drawables, plus a browser cursor change. Reachable-but-unhovered objects get no treatment; hovered-but-unreachable objects get the cursor only, never the highlight.
FR174: The player carries an item in hand, visible on the character sprite, with no view of any kind. Hands hold one item.
FR175: The player has no inventory. Carried items live in a bag, which is a world object with its own grid from `object_def`, viewed exactly as any other container - so nothing persistent, global or abstract is ever drawn.
FR176: A container view is drawn in canvas in the game's own pixel style, anchored to the container it belongs to, one at a time, with no capacity readout; an item that does not fit is shown by not fitting.
FR177: While the payload streams, the name prompt is the page - no loading screen, spinner or progress bar. The page title and favicon name the city.
FR178: A character is driven by exactly one tab. The most recent tab holds the character; an earlier tab is told plainly that the character is being driven elsewhere and is not controllable.
FR179: A browser refresh behaves as a reconnection rather than a restart. Connection loss mid-procedure snaps the procedure state machine to its current step boundary and resumes there.
FR180: Handover teaches a procedure the player has not performed before: the outgoing worker walks the steps in the world on the actual props. Repetition is available by talking to a colleague and costs minutes like any conversation.
FR181: The opening minutes run flat, door, commute, shift-with-handover, payment, rent - ordered system beats rather than scripted content.

**Tooling and observability**

FR163: Time control - a clock multiplier and the ability to jump the clock - is available in development builds.
FR164: A causality inspector answers "why is this citizen here?" from L2 state, route, current matter and last decision.
FR165: Debug overlays render collision footprints, navmesh, chunk boundaries, sort order and citizen routes.
FR166: A matter/chain inspector shows an institution's inbox and its chains' states.
FR167: A determinism harness regenerates from seed and diffs the result.
FR168: Debug tooling is compiled in behind a flag not exposed in production, and presented in a deliberately non-diegetic style.
FR169: A scheduled reducer samples per-table row counts and bytes on a slow cadence into a metrics table.
FR170: An external watcher subscribes to that metrics table and alerts when a table exceeds its declared threshold or total storage crosses the review trigger.
FR171: The same observability pipeline serves table growth, TeV per reducer class, the five gameplay metrics and the outstanding benchmarks.
FR172: The five gameplay metrics are instrumented: voluntary time in the discretionary middle, perceived aliveness at one connected player, return rate after absence, minute-spend split, and unprompted noticing.

### NonFunctional Requirements

**Performance and platform**

NFR1: Cold boot to player-controllable in under 1 second, measured from navigation on a mid-range laptop over a typical domestic connection, including load, with no character creation ceremony.
NFR2: Sustained 60 FPS at 1080p over a 10-minute session including a busy street at rush hour and an interior transition.
NFR3: The server tick is continuous and never spins down; the city simulates with zero clients connected.
NFR4: Reconnection has zero seam; nothing is suspended, so nothing needs resuming.
NFR5: Browser exclusive and non-negotiable - no install, no plugin, no download gate.
NFR6: Mouse and keyboard only; no controller and no touch support in v1.
NFR7: A busy street at rush hour must read as busy and a residential street at 3am must read as quiet; aliveness is measured per screen, not per database.
NFR8: District edges must read as character rather than as budget; emptiness must look intentional.
NFR9: Individual agents must be encounterable often enough to become familiar.
NFR10: AI citizens must carry the entire feeling of aliveness at one connected player; player count must never be the source of the city feeling populated.
NFR11: Client-side L3 for ~200 agents in a busy bubble must stay within roughly 2 ms per frame; exceeding it overturns D-L3.
NFR12: Simultaneously bound atlas textures must stay under the GPU texture-unit limit (target ~8).

**Cost and capacity**

NFR13: Monthly server spend is bounded and self-funded, sustained for years before revenue, on Maincloud Pro ($25/mo, ~120M calls, ~500 GB egress, ~40 GB storage).
NFR14: Launch scale is **512 x 512 cells (~435 m square), ~5,000 citizens, ~42 L2 transactions/sec, ~108M calls/month** — inside Maincloud Pro's allowance with zero overage. The 1024-squared district and its ~20,000 citizens remain the growth target. *(Revised 2026-08-29 from the architecture's 256-squared figure, which was derived from a cost ceiling and does not satisfy the commute arithmetic — see Scale Baseline under Additional Requirements.)*
NFR15a: Local citizen density is held constant across all map sizes at **1 citizen per 52.4 cells (~26,400 per km squared)**. Aliveness is per screen, so shrinking the map reduces the number of busy streets, never the busy-ness of one.
NFR15: Storage carries a hard wall of ~40 GB and a review trigger at 10 GB; the launch estimate is ~200 MB.
NFR16: Egress must stay within budget by keeping L3 client-simulated (~2.4 GB/month) rather than assigning ownership (~520-1,040 GB/month).
NFR17: TeV per reducer class is instrumented from day one so scaling decisions rest on measurement, not on published conversions.

**Correctness and integrity**

NFR18: Every state change has an author. Any reducer that both detects a condition and changes the world without a citizen in between is wrong by construction.
NFR19: The Truth Test holds: the event would have happened identically had no player ever come. Nothing is authored into being by proximity.
NFR20: Every bounded quantity tends toward an equilibrium the non-player simulation actively tries to reach; a quantity that drifts with nothing pursuing it is incomplete and does not ship.
NFR21: Consequence needs a physical carrier - and so does knowledge. No morality meters, reputation auras, approval scores or invisible simulation.
NFR22: Progression is carried diegetically. There is no HUD with net worth, balances, counters or objective markers.
NFR23: L3 may never write to the ledger; micro state is non-authoritative and discardable, and despawn snaps to the ledger.
NFR24: There is no mechanical seam between a role held by a player and the same role held by an AI citizen.
NFR25: Generation is deterministic under integer/fixed-point arithmetic, ordered collections, a pinned RNG and versioned rule sets.
NFR26: Client-derived values that must agree across clients are seeded from stable ids, never from local RNG.

**Maintainability and schema**

NFR27: Systems are uniform, data-driven and heavily testable, so that agents can extend and validate them. This is a design-level requirement, not an implementation preference.
NFR28: `sim/` is pure and never reads a table; `reducers/` read tables, call pure functions and write tables. This is the only boundary in the project that can be violated silently.
NFR29: Property tests over `sim/` run thousands of simulated citizen-weeks in CI with no database.
NFR30: No code is shared between `server/` and `client/`; the two footprint parsers are deliberate.
NFR31: `defs/` is the only source of truth; both targets consume generated output, never each other, under one `defs_version`.
NFR32: The client writes only player position and intents; everything else is server-authoritative.
NFR33: The schema is additive only: primary keys and unique constraints are permanent and must be correct in the first commit; columns are appended with defaults; new concepts are new tables with read-through backfill.
NFR34: Anything that might ever need scheduling must be created as a scheduled table; a normal table can never become one.
NFR35: Tables stay narrow, for frequency-split, wholesale-replacement and migration-blast-radius reasons together.
NFR36: Extensible sets use `u32` codes plus a companion data table, never enums, because a new variant must be a row insert rather than a migration.
NFR37: Every table declares a bound, either game-mechanical or an engineering ceiling, machine-readable and registered with the metrics sampler. An unbounded table is a bug.
NFR38: Incremental (lazy) migration is the standard workflow, not the emergency one.
NFR39: The world must be backed up before every migration, and the restore must have been tested.
NFR40: There is no server-side event bus; if a system needs to know something, it reads a table.
NFR41: Server reducers return `Result` and never panic in normal flow; aborting is always better than writing inconsistent state.
NFR42: The client degrades to not-drawing, never to crashing; a bad row, an unknown `def_id` or a failed asset load must never kill the frame.
NFR43: If a person in the world could observe it and shrug, it is not an error. Empty till, no beans, denied budget, closed cafe, blocked route and stalled chain are content, not errors.
NFR44: Logging is by exception, not by event, with structured fields; logs and observability are separate systems and must not be merged.
NFR45: Balance parameters live in tables and are runtime-tunable; constants are compiled; definitions are baked under `defs_version`.
NFR46: Live parameters and seed values are visibly marked, because tuning a seed value on a running world has no effect.

### Additional Requirements

*(From the Architecture document - technical requirements that shape epic and story creation.)*

**Starter template / project scaffold — impacts Epic 1 Story 1**

- **There is no off-the-shelf greenfield template.** The architecture specifies an explicit scaffold sequence that Epic 1 Story 1 must perform: `spacetime init --lang rust --project-path ./server browsercity`, then `npm create vite@latest client -- --template vanilla-ts`, then `npm install pixi.js spacetimedb`, then `spacetime generate --lang typescript --out-dir client/src/net/bindings`. Iteration is `spacetime dev` (hot reload); deployment is `spacetime publish`.
- Prerequisites: Rust toolchain via rustup with `rustup target add wasm32-unknown-unknown`; the SpacetimeDB CLI (**the Windows install method must be confirmed from current docs** — the shell installer is the documented Unix path); Node.js with a package manager. `ModernTileset/` (23,519 PNGs, 135 MB) is already in the repository.
- The directory structure is prescribed in full: `defs/`, `server/src/{tables,sim,reducers,clock,config,debug}`, `client/src/{boot,net,world,render,entities,l3,input,ui,audio,debug}`, `tools/{atlas-packer,footprint,defs-build,character-parts}`.
- **`defs/` and `tools/defs-build/` must be built before content** — one source, two generated consumers, one `defs_version`.
- **Fix the permanent decisions first.** Primary keys, unique constraints and any table that might ever need scheduling cannot be changed later.

**Technology stack, pinned**

- Server: SpacetimeDB v2.8.3, module in Rust. Client: PixiJS v8.19.0 + TypeScript via the `spacetimedb` npm package (`@clockworklabs/spacetimedb-sdk` is deprecated).
- Rendering via WebGPU with WebGL fallback; `@pixi/tilemap` for tilemaps; no physics engine; scene, input and audio hand-rolled; Web Audio directly or a very thin wrapper.
- SpacetimeDB releases roughly weekly, and recent releases have touched primitives this design depends on directly.
- Hosting: Maincloud Pro, with $100 of existing credits covering the opening months. Self-hosting is a live fallback, not a rejected option.
- AI tooling: `spacetime mcp`, the official SpacetimeDB Claude plugin, Context7 for current-documentation lookup, and the official PixiJS agent skills.

**Gating spikes and benchmarks — must be scheduled as stories**

- **B7 — scheduled-reducer timing fidelity.** Highest priority. The entire far-agent model rests on it and it has been patched twice in a month. Must run before the L2 work depends on it.
- **B6 — backup/restore semantics.** Confirm Maincloud's backup frequency, retention and whether the developer can trigger and restore; build a DIY logical export via `spacetime sql` on a schedule; **test the restore — before the world contains anything worth losing.**
- **B3 — boot budget, measured.** D6's boot design is arithmetic, not evidence.
- **B1** — per-transaction overhead and cost, Alarm Clock vs batched sweep. **B2** — real L2 event rate including discretionary time and chunk crossings (feeds A2). **B4** — player position write rate vs perceived smoothness. **B8** — confirm bound-texture count stays under the GPU limit on target hardware.

**Scale Baseline — settled 2026-08-29, measured against the tileset**

These figures are load-bearing for generation, economy, labour-market and performance stories. They replace the architecture's 256-squared launch figure, which satisfied the cost budget but not the commute.

*Measured from `ModernTileset/`:*

| Quantity | Value | Derivation |
|---|---|---|
| Metres per cell | **~0.85 m** | Dominant vehicle sprite is 80x48 = 5x3 cells; a real car is ~4.4 m long |
| Typical building footprint | **~132 cells (12x11)** | The tileset's own premade interiors: condo flat 14x6, generic home 14x13, ice-cream shop 12x10, TV studio 11x10, villa 9x13, gym 19x15, museum 16x22. Per D1 the interior *is* the street footprint |
| Modular facade module | **7 cells wide** | 112x48 / 112x80 / 112x96 / 112x112 dominate `5_Floor_Modular_Building_Singles` |

*Settled world figures at 512 x 512:*

| Quantity | Value |
|---|---|
| Map | 512 x 512 cells = 262,144 cells = ~435 m square |
| Viewport | **3x integer zoom at 1080p** -> 640x360 logical -> **40 x 22.5 cells**; character renders at 48x96 screen px |
| Map in screens | ~12.8 wide x ~22.8 tall = ~291 screenfuls |
| Citizens | ~5,000 (density 1 per 52.4 cells, ~26,400/km squared — Paris-to-Manhattan) |
| Buildings | ~894 (45% land coverage at 132 cells each) |
| Enterable interiors | 100+ target is ~11% of building stock — never the binding constraint at any map size |
| Workplaces | ~344 (55% employment, ~8 staff per workplace) |
| Professions supporting a wage market | **~69** (at a minimum of 5 employers each) |
| L2 rate | ~42 transactions/sec -> ~108M calls/month -> $25/mo, no overage |
| Edge-to-edge traverse | ~233 real seconds (~93 in-city minutes) on foot |

*Derived requirement — player movement speed:*

- **Walking speed is 2.2 cells/sec (35 px/sec world, ~106 screen px/sec at 3x).** This is not a free choice: it is what makes the GDD's commute arithmetic true on a 512-cell map. Starting commute path is ~333 cells (edge flat to central workplace, grid routing) = **60 in-city minutes** exactly as specified.
- The transport ladder therefore holds intact: **bike (2x speed) -> 30 in-city min; transit pass (3x) -> 20 in-city min**, landing precisely on the design's stated floor.
- Consequence: one viewport width takes ~18 real seconds to cross, and a starting commute traverses ~8 screenfuls. Slow by action-game standards and correct for this design, where the commute is the sensor.
- **Any change to map size or walking speed must be made together**, since `commute_in_city_minutes = 0.26 x map_width / walk_speed`.

*Aliveness, which is scale-invariant and therefore unaffected by this revision:*

| Scene | Visible on screen | In the body zone |
|---|---|---|
| Quiet residential street | ~2 | ~5 |
| Average street | ~4 | ~12 |
| Arterial at rush hour | ~22 | ~65 |
| High street / transit interchange | ~38 | ~112 |

The architecture's ~200-agent L3 budget carries roughly 2x headroom over the worst realistic case. What the map size changes is the **number** of simultaneously busy streets: ~25 at 512-squared, against ~6 at 256-squared and ~99 at the full district.

**Findings the architecture handed back to design — these restructure the epic list**

1. **Stock and logistics is absent from the existing epic breakdown and is now load-bearing.** It is L1's substrate, so it comes first among the economy systems. It also makes "the till runs short of change" fall out rather than being special-cased, and turns logistics into a job rather than a background system.
2. **A3's chain-link gap is far cheaper to close than the GDD assumed.** A decider is not a different kind of agent — it is a citizen whose work-time option set is matters instead of procedure steps, using the same utility evaluator. A player-holdable decision link is an addition, not a rebuild.
3. **The architectural dependency order disagrees with the epic order, and the first job epic already needs NPC capability regardless.** The shop till requires customers, so it implicitly depends on Phase 3 NPC capability independently of any resequencing argument.
4. **Social continuity across long absence.** At 24 in-city days per real day, a fortnight offline is roughly an in-city year. Recognisability and the geographic social graph are the exposed surface; a labour-churn model where established citizens are sticky is wanted.
5. **Labour-market depth vs population — ANSWERED by the Scale Baseline.** The GDD's ~100 professions was thin at the architecture's 1,000-2,000 citizens (10-20 people each). At the settled 512-squared / ~5,000-citizen scale there are ~344 workplaces, supporting **~69 professions at 5+ employers each** — enough for FR68's wage self-balancing to have something to balance. **The v1 profession target is therefore ~65-70, not ~100**, growing toward the GDD's figure as the city extends (FR157). Stories that enumerate professions should be written against 69.

**Architectural dependency order (Phases 0-8)**

- **Phase 0 — Foundations:** boot budget as a standing constraint; world data model (floor, layer, tile stacks, sort anchors); collision model and footprint table format; player movement and collision resolution; SpacetimeDB module and schema skeleton.
- **Phase 1 — Content pipeline:** tile/prop semantics, footprint authoring and validation harness; declaration formats; city generation emitting geometry, occupancy and nav graph.
- **Phase 2 — The wire:** authoritative loop, subscriptions/interest management, reconnection, migration and compaction policy; in-city clock.
- **Phase 3 — One NPC:** L3 micro brain and micro pathing; body instantiation/despawn from records; the L3-never-writes-ledger rule.
- **Phase 4 — A citizen:** L2 macro brain step-by-step; derived positions and region queries.
- **Phase 5 — A population:** L1 boundary; economy and labour market; nav graph patching.
- **Phase 6 — The player's day:** interactable state and procedure machine; reciprocal occupancy.
- **Phase 7 — Institutions:** chain process engine.
- **Phase 8 — Growth:** incremental city extension.

Runtime dependency runs L1 -> L2 -> L3; build order runs L3 -> L2 -> L1.

**Open items carried into story creation**

- **G3** — no frame budget allocated across renderer, L3 and UI against the 60 FPS target. Resolve with B3/B8 measurement.
- **G4** — in-city clock authority: how time is computed, who reads it, whether clients derive it. Small but undecided.
- **A1** — the multi-step procedure interaction model, resolved by prototyping. D16's generic intent layer exists so this can iterate without touching input.
- **D18** — sharding, deferred to measurement.
- **Nav graph patch log compaction** — determinism wants a replayable history, R2 wants it compacted. Periodic re-baselining is the obvious shape but deserves a deliberate decision.
- **Materialised aggregates** — whether any are needed at all is a performance question, deferred to measurement.
- **Census clerk as a producer role for statistics** — v1: no. Revisit at the careers epic.
- **Grid inventory tedium** — watch alongside the A1 procedure prototyping, since the two will be felt together. Dials are grid sizes and how often a packing decision is forced.
- **Hanging objects** — cut from v1.

**Technical risks carried into stories**

A2 (citizen count and cost, reframed as density) · A4 (1-second boot) · A5 (the generator's rules are the entire content pipeline, no hand-authored fallback) · R1 (live schema migration on a never-reset world) · R2 (unbounded state growth) · R3 (generation determinism) · R4 (single-process tick ceiling) · R5 (identity vs the boot budget) · R6 (coordinator drift — L1 is where a director would creep in) · R7 (L2/L3 handover seam) · R8 (nav graph determinism under patching) · R9 (prop metadata as a silent-failure surface) · R10 (SpacetimeDB vendor and maturity risk).

### UX Design Requirements

**Source:** `_bmad-output/planning-artifacts/ux/ux-BrowserCity-2026-08-29/ux.md` *(added 2026-08-29)*.

**The earlier position — that no UX specification was needed — is withdrawn.** That reasoning was sound about UI chrome and wrong about UX. The GDD's design law *"progression is carried diegetically"* and D17's *"all UI is DOM; nothing persistent, global or abstract is drawn into the canvas"* really do make the conventional UI surface almost empty: a boot name prompt, an options menu, connection-state notices, and transient object-bound container views. But UX also covers **how a player knows what is actionable, what the browser page does, and what the opening minutes are** — and the implementation readiness assessment found three such surfaces with no owner in any document, one of which contradicted D17 as written.

The specification is deliberately bounded. It carries no colour palette, typography scale or component library, because the art direction is fixed by the LimeZu tilesets and the DOM surface is three elements. It owns six surfaces:

| # | Surface | Requirements | Epic |
|---|---|---|---|
| 1 | Interactable affordance | FR173 | Epic 1 |
| 2 | What the player carries | FR174, FR175 | Epic 6 |
| 3 | Container view grammar | FR176 | Epic 6 |
| 4 | Page and session behaviour | FR177, FR178, FR179 | Epic 4 |
| 5 | First-session flow and teaching | FR180, FR181 | Epics 7, 8 |
| 6 | Procedure interaction model | A1 — unchanged, prototyped in Epic 8 | Epic 8 |

**Two findings the specification resolves rather than records:**

- **FR175 closes a contradiction.** D19 specifies Tetris-style grid inventories; D17 forbids drawing anything persistent, global or abstract into the canvas. D19 never said what the *player* carries, and a player-as-citizen holding items directly would make their inventory persistent and global — a violation of the project's own structural guarantee at the first inventory screen. The resolution: hands hold one visible item with no view, and everything else lives in a bag, which is an ordinary world object with an ordinary container view.
- **FR173 is a precondition of A1, not part of it.** A player who cannot tell what is clickable cannot report whether procedure feels like handling or clicking; the prototype would measure discovery friction and call it procedure friction. The affordance ships in Epic 1, before the Epic 8 prototype runs.

**Accessibility** has a recorded floor in the specification rather than being left absent. It matters here more than in most games because with no HUD and no text readouts, all state travels through 16×16 pixel art at 3× zoom, so visual legibility is the whole information channel. v1 position: affordance strength tunable in the options menu, colour avoided as the sole carrier of state where cheap, screen-reader support explicitly out of scope as a decision rather than an omission.

The remaining UX-shaped requirements stay where they are: FR144–FR152 for the client surface, FR102 and FR104 for diegetic carriers, FR30–FR34 for the interaction vocabulary, and NFR22.

### FR Coverage Map

All 181 functional requirements map to exactly one epic. Verified programmatically: no requirement is unmapped and none is claimed by two epics.

**Testing policy, decided 2026-08-29.** Development is TDD throughout. **Every FR is covered by one or more tests**, written before the code that satisfies them. An FR's tests are derived from the acceptance criteria of the stories that deliver it — the Given/When/Then clauses in this document are test specifications, not description. Every one of the 200 stories carries acceptance criteria (897 Given clauses, minimum 3 per story), so the path from requirement to test is complete: FR -> epic -> story -> acceptance criteria -> test.

An FR delivered by several stories accumulates tests across all of them; an FR is not done when its code runs but when every acceptance criterion tracing to it is green. The NFR Test Placement Map below is the counterpart for non-functional requirements, which need it stated separately because most are not delivered by any single story.

```
FR1: Epic 4 (The Living Wire) - One in-city day equals 60 real minutes
FR2: Epic 4 (The Living Wire) - The in-city clock is detached from real-world time
FR3: Epic 4 (The Living Wire) - The clock advances continuously whether or not any client is connected
FR4: Epic 7 (The Day Loop) - The player's day is composed of sleep (8 in-city hours), work...
FR5: Epic 7 (The Day Loop) - The core loop runs wake -> commute -> shift -> paid...
FR6: Epic 7 (The Day Loop) - The commute costs in-city minutes each leg and is the player's...
FR7: Epic 7 (The Day Loop) - The commute has a floor of roughly 20 in-city minutes per...
FR8: Epic 9 (Reciprocal Occupancy) - At sleep the player may either log off (understudy takes the...
FR9: Epic 8 (Procedure and Props) - Every playable job runs a four-beat template
FR10: Epic 8 (Procedure and Props) - Props carry state, and that state is visible on the object...
FR11: Epic 8 (Procedure and Props) - Multi-step procedures are performed on world objects in sequence, not selected...
FR12: Epic 8 (Procedure and Props) - A procedure can be performed badly
FR13: Epic 8 (Procedure and Props) - No job carries a score
FR14: Epic 8 (Procedure and Props) - Five playable jobs ship at launch
FR15: Epic 8 (Procedure and Props) - Freedom scales inversely with supervision
FR16: Epic 8 (Procedure and Props) - Procedures are built so that some may physically require two people
FR17: Epic 8 (Procedure and Props) - Routine jobs are a fixed sequence of steps over local state,...
FR18: Epic 10 (Institutions and the Reference Slice) - Decider jobs are agenda selection over non-local information
FR19: Epic 7 (The Day Loop) - Rent falls due every 7 in-city days, whether or not the...
FR20: Epic 7 (The Day Loop) - Entry wage is 10 per in-city hour (80/day, 560/week gross)
FR21: Epic 12 (A Life) - Rent can be split through a shared tenancy (flatshare), halving the...
FR22: Epic 7 (The Day Loop) - Missing rent triggers Ruin By Process
FR23: Epic 7 (The Day Loop) - There is no eviction fail-state, no death, no scoring and no...
FR24: Epic 10 (Institutions and the Reference Slice) - Destitution is inhabitable
FR25: Epic 11 (Transit and the Full Roster) - Injury costs days and savings and routes the player through hospital...
FR26: Epic 12 (A Life) - A bike costs 450 one-time and halves the walking commute to...
FR27: Epic 12 (A Life) - A transit pass costs 20/week
FR28: Epic 12 (A Life) - Transport mode acts as an edge-cost modifier on the macro routing...
FR29: Epic 7 (The Day Loop) - Money exists only as stored time
FR30: Epic 8 (Procedure and Props) - Presence verbs are supported
FR31: Epic 8 (Procedure and Props) - Civic verbs are supported
FR32: Epic 8 (Procedure and Props) - Binning a bottle reverses the litter loop at the scale of...
FR33: Epic 8 (Procedure and Props) - Conversation is loitering
FR34: Epic 8 (Procedure and Props) - Dignity work is supported
FR35: Epic 9 (Reciprocal Occupancy) - A citizen body has exactly one driver, and the driver is...
FR36: Epic 9 (Reciprocal Occupancy) - On disconnect an AI understudy holds the player's life with a...
FR37: Epic 9 (Reciprocal Occupancy) - The understudy is additive only
FR38: Epic 9 (Reciprocal Occupancy) - For any absence duration, the player's inventory is a superset of...
FR39: Epic 9 (Reciprocal Occupancy) - The absent character reconciles as a record and settles on return
FR40: Epic 9 (Reciprocal Occupancy) - The trace of an absence is the changed world
FR41: Epic 9 (Reciprocal Occupancy) - The understudy earns the same wage the player would, never more...
FR42: Epic 9 (Reciprocal Occupancy) - Staying up past bedtime offers the player a few available night...
FR43: Epic 9 (Reciprocal Occupancy) - Borrowed night shifts are anonymous, do not accumulate, and place consequence...
FR44: Epic 9 (Reciprocal Occupancy) - Any unheld institutional post is backfilled by that citizen's own L2...
FR45: Epic 9 (Reciprocal Occupancy) - Handover between drivers happens mid-procedure in both directions, snapping to the...
FR46: Epic 9 (Reciprocal Occupancy) - The discretionary middle is discretionary within the procedure's state space
FR47: Epic 9 (Reciprocal Occupancy) - No system may punish logging off
FR48: Epic 5 (Citizens) - Every citizen has a home, a job, a schedule, stable preferences...
FR49: Epic 5 (Citizens) - L2 advances every citizen identically at transitions via a scheduled table
FR50: Epic 5 (Citizens) - A citizen decides by a calendar of obligations plus a utility...
FR51: Epic 5 (Citizens) - Every citizen carries a small fixed trait vector
FR52: Epic 5 (Citizens) - Decisions are made one step at a time using current belief
FR53: Epic 5 (Citizens) - Citizens act on stale belief and re-decide on the spot when...
FR54: Epic 5 (Citizens) - No knowledge is broadcast anywhere in the system
FR55: Epic 5 (Citizens) - Citizen memory is keyed on business rather than location, written only...
FR56: Epic 5 (Citizens) - Far agents carry no coordinates
FR57: Epic 5 (Citizens) - Populating a region is a spatio-temporal query, not a promotion
FR58: Epic 5 (Citizens) - Bodies instantiate only in observed regions, with a margin beyond the...
FR59: Epic 5 (Citizens) - Subscriptions prefetch along intent rather than position
FR60: Epic 5 (Citizens) - NPC own-time and player lateral pursuits draw on one catalogue and...
FR61: Epic 1 (Foundations and Gating Spikes) - A citizen's appearance is a stable tuple of five layer indices...
FR62: Epic 1 (Foundations and Gating Spikes) - The outfit layer is role-driven
FR63: Epic 5 (Citizens) - NPCs route on the navmesh at tile level and never perform...
FR64: Epic 5 (Citizens) - L3 drives steering, local avoidance, gait and flavour behaviour for instantiated...
FR65: Epic 5 (Citizens) - Flavour behaviour and animation phase are seeded from stable ids so...
FR66: Epic 6 (Stock, Goods and Money) - L1 supplies only exogenous inputs
FR67: Epic 5 (Citizens) - There is no city-wide wage and no city-wide price
FR68: Epic 5 (Citizens) - Labour market self-balancing emerges from many employers each responding to their...
FR69: Epic 10 (Institutions and the Reference Slice) - A matter is an item of institutional business scoped to a...
FR70: Epic 10 (Institutions and the Reference Slice) - Matters arrive through exactly four fluxes, each with a person and...
FR71: Epic 10 (Institutions and the Reference Slice) - A routine job's procedure step detecting an out-of-range condition emits an...
FR72: Epic 10 (Institutions and the Reference Slice) - A decider on shift scores the open matters in their jurisdiction,...
FR73: Epic 10 (Institutions and the Reference Slice) - Matter scoring weighs severity, age (rising
FR74: Epic 10 (Institutions and the Reference Slice) - Approve, Deny, Defer and Escalate are all first-class decider actions
FR75: Epic 10 (Institutions and the Reference Slice) - A decision record carries the action, a reason code and the...
FR76: Epic 10 (Institutions and the Reference Slice) - A denial closes the chain but does nothing to the evidence
FR77: Epic 10 (Institutions and the Reference Slice) - Denial produces four trait-weighted responses
FR78: Epic 10 (Institutions and the Reference Slice) - Deferred matters are the demand signal the calendar's budget review drains
FR79: Epic 10 (Institutions and the Reference Slice) - Matters expire after N in-city weeks if unresolved and unrefreshed
FR80: Epic 10 (Institutions and the Reference Slice) - Complaint filing probability has a floor
FR81: Epic 10 (Institutions and the Reference Slice) - Institutional chains run investigation -> approval -> budget -> procurement ->...
FR82: Epic 10 (Institutions and the Reference Slice) - Each chain link is an occupation with its own work loop,...
FR83: Epic 10 (Institutions and the Reference Slice) - Response time
FR84: Epic 10 (Institutions and the Reference Slice) - The plastic-bottle reference chain runs end to end
FR85: Epic 10 (Institutions and the Reference Slice) - Litter licenses litter, reversibly
FR86: Epic 6 (Stock, Goods and Money) - Items are defined types carrying a unit, perishability and bulk
FR87: Epic 6 (Stock, Goods and Money) - Stock is held by a holder
FR88: Epic 6 (Stock, Goods and Money) - Recipes convert input items plus labour minutes into output items
FR89: Epic 6 (Stock, Goods and Money) - Stock quantities change only inside a work-procedure step or a consumption...
FR90: Epic 6 (Stock, Goods and Money) - A procedure step finding stock below threshold emits an order
FR91: Epic 6 (Stock, Goods and Money) - A supplier whose own stock depletes orders from outside the city...
FR92: Epic 6 (Stock, Goods and Money) - Physical cash is ordinary stock and denominations are items
FR93: Epic 6 (Stock, Goods and Money) - Bank money is a balance per holder, used for evaluation
FR94: Epic 6 (Stock, Goods and Money) - Containers hold items on a rotation-capable grid, with item footprints reused...
FR95: Epic 6 (Stock, Goods and Money) - An item is in exactly one of two states
FR96: Epic 6 (Stock, Goods and Money) - Bulk quantities are held inside a discrete container instance
FR97: Epic 6 (Stock, Goods and Money) - NPCs pack containers with first-fit on the real grid, never an...
FR98: Epic 6 (Stock, Goods and Money) - A delivery vehicle has a grid
FR99: Epic 13 (Careers) - Institutional advancement is gated twice
FR100: Epic 13 (Careers) - Qualification is bought with minutes taken from own-time (evening classes, courses,...
FR101: Epic 13 (Careers) - A vacancy is an actual open post in an actual institution,...
FR102: Epic 13 (Careers) - Progression carriers are diegetic
FR103: Epic 12 (A Life) - Three lateral pursuits ship in v1
FR104: Epic 12 (A Life) - There is no experience bar, no level, no skill tree, no...
FR105: Epic 13 (Careers) - Job access tiers are the project's primary scope valve and are...
FR106: Epic 13 (Careers) - Positional consequence persists
FR107: Epic 3 (The Generated City) - Everything is procedurally generated from a city seed
FR108: Epic 3 (The Generated City) - Seed plus rule-set version reproduces the same city
FR109: Epic 3 (The Generated City) - The city records the rule-set version it was generated under, and...
FR110: Epic 3 (The Generated City) - Generation runs multi-pass, coarse to fine
FR111: Epic 2 (The Content Pipeline) - Generation rules are data in defs/, evaluated by a generic engine,...
FR112: Epic 2 (The Content Pipeline) - The generator applies the rules and the validation harness checks output...
FR113: Epic 3 (The Generated City) - Neighbourhood character derives from four generator parameters
FR114: Epic 3 (The Generated City) - 100+ interiors are enterable at MVP
FR115: Epic 3 (The Generated City) - Building footprints are sized by interior usability, not street frontage alone
FR116: Epic 3 (The Generated City) - Institutions are placed as generated types under placement constraints
FR117: Epic 1 (Foundations and Gating Spikes) - World addressing is (x, y, floor, layer)
FR118: Epic 1 (Foundations and Gating Spikes) - Interiors live in the same tilemap at their building's footprint
FR119: Epic 1 (Foundations and Gating Spikes) - Cells carry a building/room ownership id, used for wall retraction, room...
FR120: Epic 1 (Foundations and Gating Spikes) - Near-side wall retraction hides the walls of the building the player...
FR121: Epic 1 (Foundations and Gating Spikes) - Windows are semi-transparent wall tiles
FR122: Epic 1 (Foundations and Gating Spikes) - The subway floor is culled until entered, at which point the...
FR123: Epic 1 (Foundations and Gating Spikes) - Depth sorting uses the key (y, layer_rank, x, object_id) over one...
FR124: Epic 1 (Foundations and Gating Spikes) - Floor is a vertical screen offset, not a sort key
FR125: Epic 1 (Foundations and Gating Spikes) - Multi-cell props decompose into per-cell drawables, each with its own anchor
FR126: Epic 2 (The Content Pipeline) - Tilemap rows are placed object instances at their anchor cell
FR127: Epic 2 (The Content Pipeline) - Object footprints are capped at approximately 8x8
FR128: Epic 2 (The Content Pipeline) - Absence of a collider is walkability
FR129: Epic 3 (The Generated City) - The nav graph is a generation output, versioned and incrementally patchable,...
FR130: Epic 3 (The Generated City) - The macro routing graph carries edge costs denominated in minutes, and...
FR131: Epic 3 (The Generated City) - Utility scoring uses Manhattan distance converted to minutes, computed fresh, with...
FR132: Epic 3 (The Generated City) - One A runs for the chosen destination only, after the choice
FR133: Epic 5 (Citizens) - A cached route is the belief
FR134: Epic 3 (The Generated City) - Interiors collapse to an entrance node in the macro graph, plus...
FR135: Epic 3 (The Generated City) - The client never sees the macro graph
FR136: Epic 4 (The Living Wire) - Simulation is authoritative server-side
FR137: Epic 1 (Foundations and Gating Spikes) - Player movement and collision are fully client-authoritative, with no server-side plausibility...
FR138: Epic 4 (The Living Wire) - Player position is one row per player, overwritten in place, serving...
FR139: Epic 4 (The Living Wire) - Multiple concurrent clients stand in one city and see each other...
FR140: Epic 4 (The Living Wire) - Reconnection has no seam
FR141: Epic 4 (The Living Wire) - Identity is anonymous-first, issued by SpacetimeDB during the WebSocket handshake and...
FR142: Epic 4 (The Living Wire) - A character-to-identity mapping table (one character, N identities) exists from the...
FR143: Epic 4 (The Living Wire) - The player is prompted to link an account at a natural...
FR144: Epic 4 (The Living Wire) - First visit shows an inline DOM name prompt in the HTML...
FR145: Epic 4 (The Living Wire) - The player is controllable within 1 second of submitting their name
FR146: Epic 4 (The Living Wire) - Return visits show no prompt and reach controllable in under 1...
FR147: Epic 2 (The Content Pipeline) - A defs_version handshake at connect covers asset definitions and schema/protocol version,...
FR148: Epic 1 (Foundations and Gating Spikes) - Input produces intents, not actions
FR149: Epic 1 (Foundations and Gating Spikes) - Movement is WASD/arrow keys, continuous, on an oblique tile grid
FR150: Epic 1 (Foundations and Gating Spikes) - All UI is DOM except transient, object-bound container views drawn in...
FR151: Epic 1 (Foundations and Gating Spikes) - The DOM UI surface is exactly the boot name prompt, an...
FR152: Epic 1 (Foundations and Gating Spikes) - Anything informational that belongs to the fiction is rendered in the...
FR153: Epic 11 (Transit and the Full Roster) - Ambient audio beds crossfade by environment, neighbourhood character and time of...
FR154: Epic 11 (Transit and the Full Roster) - Diegetic music is a positional emitter (a radio, a busker)
FR155: Epic 11 (Transit and the Full Roster) - Earshot is deliberately larger than the viewport
FR156: Epic 11 (Transit and the Full Roster) - Audio reads the same derived state as the renderer
FR157: Epic 14 (Growth) - New neighbourhoods are generated adjacent to district one, keyed to active...
FR158: Epic 14 (Growth) - Growth is delivered by a development chain
FR159: Epic 14 (Growth) - Construction is physically visible
FR160: Epic 14 (Growth) - New neighbourhoods run under the current rule-set version
FR161: Epic 14 (Growth) - New businesses arise from an L2 own-time decision by a citizen...
FR162: Epic 14 (Growth) - New citizens arrive through in-migration, exogenous and modulated by the city's...
FR163: Epic 4 (The Living Wire) - Time control
FR164: Epic 5 (Citizens) - A causality inspector answers "why is this citizen here?" from L2...
FR165: Epic 1 (Foundations and Gating Spikes) - Debug overlays render collision footprints, navmesh, chunk boundaries, sort order and...
FR166: Epic 10 (Institutions and the Reference Slice) - A matter/chain inspector shows an institution's inbox and its chains' states
FR167: Epic 3 (The Generated City) - A determinism harness regenerates from seed and diffs the result
FR168: Epic 1 (Foundations and Gating Spikes) - Debug tooling is compiled in behind a flag not exposed in...
FR169: Epic 4 (The Living Wire) - A scheduled reducer samples per-table row counts and bytes on a...
FR170: Epic 4 (The Living Wire) - An external watcher subscribes to that metrics table and alerts when...
FR171: Epic 4 (The Living Wire) - The same observability pipeline serves table growth, TeV per reducer class,...
FR172: Epic 4 (The Living Wire) - The five gameplay metrics are instrumented
FR173: Epic 1 (Foundations and Gating Spikes) - An object the pointer is over is affordance-marked
FR174: Epic 6 (Stock, Goods and Money) - The player carries an item in hand, visible, with no view
FR175: Epic 6 (Stock, Goods and Money) - The player has no inventory; carried items live in a bag
FR176: Epic 6 (Stock, Goods and Money) - Container view grammar: canvas, object-anchored, one at a time
FR177: Epic 4 (The Living Wire) - While the payload streams, the name prompt is the page
FR178: Epic 4 (The Living Wire) - A character is driven by exactly one tab
FR179: Epic 4 (The Living Wire) - Refresh behaves as reconnection; loss mid-procedure resumes at the step boundary
FR180: Epic 8 (Procedure and Props) - Handover teaches a procedure the player has not performed before
FR181: Epic 7 (The Day Loop) - The opening minutes run flat, door, commute, shift, payment, rent
```

### NFR Test Placement Map

**Policy, decided 2026-08-29:** NFRs are covered by tests. Development is TDD throughout, and **each NFR gets its test in the earliest epic that makes it testable** — not in the epic that happens to introduce the feature it constrains. An NFR whose test would be vacuous at that point (nothing to measure yet) waits only as long as it must.

This map is the NFR counterpart to the FR Coverage Map above. Unlike that map it is deliberately **not one-to-one**: several NFRs are standing constraints that every subsequent epic must keep satisfying, so they carry an enforcement mechanism rather than a single test.

**Test kinds:**

- **Gate** — a spike or benchmark that must pass before dependent work proceeds. Failing it overturns a decision rather than producing a bug.
- **Test** — an ordinary automated test, written first, added in the named epic.
- **Invariant** — an architectural, lint or property test that runs in CI from the named epic onward and fails the build for every later epic too.
- **Review** — not mechanically testable. Enforced by Epic 0's review gate and named in the project context.

| NFR | Constraint | Earliest testable | Kind | How |
|---|---|---|---|---|
| NFR1 | Cold boot to player-controllable < 1s | **Epic 1** | Gate | Story 1.14 already measures the boot budget. Assertion becomes end-to-end in Epic 4 once the real boot sequence (FR144–FR146) exists; the Epic 1 gate is what stops the budget being spent before then |
| NFR2 | Sustained 60 FPS at 1080p | **Epic 1** | Gate | Baseline on the hand-laid test street (Story 1.13). Full assertion — busy street at rush hour, interior transition — lands in Epic 5 once there are ~22 agents to render. Closes open item G3 (no frame budget allocated) |
| NFR3 | Server tick continuous, never spins down | **Epic 4** | Test | Story 4.1 — advance the clock with zero clients connected and assert progress |
| NFR4 | Zero reconnection seam | **Epic 4** | Test | Disconnect, advance time, reconnect; assert position and state consistent with elapsed time |
| NFR5 | Browser exclusive, no install or plugin | **Epic 1** | Invariant | CI builds and boots the client headless in a browser context; no native or plugin dependency may enter the bundle |
| NFR6 | Mouse and keyboard only, no controller or touch | **Epic 1** | Invariant | Story 1.9 owns intents and keybindings; assert no gamepad or touch handler is registered |
| NFR7 | Busy street reads busy, 3am reads quiet | **Epic 5** | Test | Sample visible-agent counts per scene against the aliveness table (~2 quiet residential, ~22 arterial rush hour) |
| NFR8 | District edges read as character, not budget | **Epic 3** | Test | Density falloff assertion over generated output; emptiness must be a generator parameter, not an absence |
| NFR9 | Agents encounterable often enough to be familiar | **Epic 5** | Test | FR61's stable appearance tuple plus route overlap — assert the same citizen recurs on a repeated commute |
| NFR10 | AI carries aliveness at one connected player | **Epic 5** | Gate | The A9 falsification point. Density measured with exactly one client connected |
| NFR11 | Client-side L3 ~200 agents within ~2 ms/frame | **Epic 5** | Gate | Story 5.4 is already written as an explicit falsification gate. Exceeding it overturns D-L3 |
| NFR12 | Bound atlas textures under the GPU limit (~8) | **Epic 2** | Test | Story 2.7 — count simultaneously bound textures across prop and character atlases. Benchmark B8 |
| NFR13 | Monthly spend bounded and self-funded | **Epic 4** | Invariant | TeV instrumentation (NFR17) reports projected monthly cost in CI; assertion becomes meaningful at population in Epic 5 |
| NFR14 | Launch scale 512×512, ~5,000 citizens, ~42 tx/sec | **Epic 5** | Test | Generation supplies the map in Epic 3; the transaction rate is only measurable once citizens run |
| NFR15a | Local density constant at 1 per 52.4 cells | **Epic 5** | Test | Assert density is invariant to map size — shrinking the map must reduce the number of busy streets, never the busy-ness of one |
| NFR15 | Storage hard wall ~40 GB, review trigger 10 GB | **Epic 4** | Invariant | Story 4.12 registers per-table bounds with the metrics sampler; the watcher alerts on threshold breach |
| NFR16 | Egress within budget via client-simulated L3 | **Epic 5** | Test | Measure bytes/client/hour against the ~2.4 GB/month projection |
| NFR17 | TeV per reducer class instrumented from day one | **Epic 1** | Invariant | "From day one" is literal — the instrumentation ships with the first reducer, not with the first performance problem |
| NFR18 | Every state change has an author | **Epic 4** | Invariant | No reducer may both detect a condition and change the world without a citizen in between. Architectural test over `reducers/` |
| NFR19 | The Truth Test | **Epic 5** | Test | Run the simulation with zero players and with one, from the same seed; assert the non-player trajectory is identical |
| NFR20 | Every bounded quantity seeks an equilibrium | **Epic 5** | Property | Property test over `sim/`: for each bounded quantity, assert something actively pursues its equilibrium. A quantity with no pursuer fails the build |
| NFR21 | Consequence needs a physical carrier | **Epic 10** | Review | Partly mechanical (assert no reputation or approval scalar exists on any table) from Epic 5; the full claim is a review-gate judgement |
| NFR22 | Progression carried diegetically, no HUD | **Epic 1** | Invariant | Story 1.11's DOM shell fixes the surface at FR151's three items; assert nothing persistent, global or abstract is drawn to canvas (FR150) |
| NFR23 | L3 never writes to the ledger | **Epic 5** | Invariant | Architectural test — no write path from `client/src/l3/` to any reducer that mutates authoritative state |
| NFR24 | No mechanical seam between player-held and AI-held roles | **Epic 9** | Test | Earliest point both drivers exist. Swap driver mid-procedure in both directions and assert identical world effect |
| NFR25 | Generation determinism | **Epic 3** | Gate | Stories 3.13–3.14 — the determinism harness regenerates from seed and diffs. Must survive an arbitrary patch history (R8) |
| NFR26 | Client-derived values seeded from stable ids | **Epic 5** | Test | Two clients observing the same citizen show the same animation frame at the same time |
| NFR27 | Systems uniform, data-driven, heavily testable | **Epic 0** | Review | The premise of the whole approach. Enforced by the review gate and stated in project context |
| NFR28 | `sim/` pure; `reducers/` read tables | **Epic 1** | Invariant | Named in the document as the only boundary that can be violated silently — therefore the highest-value architectural test in the project |
| NFR29 | Property tests over `sim/` run thousands of citizen-weeks in CI | **Epic 1** | Invariant | Harness exists from Epic 1 (Story 0.9 CI); becomes meaningful at Epic 5 when there are citizen-weeks to simulate |
| NFR30 | No code shared between `server/` and `client/` | **Epic 1** | Invariant | Dependency test. The two footprint parsers are deliberate and must stay separate |
| NFR31 | `defs/` the only source of truth, one `defs_version` | **Epic 2** | Invariant | Story 2.8's handshake; assert neither target imports the other |
| NFR32 | Client writes only position and intents | **Epic 4** | Invariant | Enumerate client-callable reducers and assert the whitelist |
| NFR33 | Schema additive only; keys permanent and correct in the first commit | **Epic 1** | Invariant | Story 1.2. Migration test asserts no primary key or unique constraint ever changes |
| NFR34 | Anything that might need scheduling is a scheduled table | **Epic 1** | Invariant | Story 1.2. A normal table can never become one, so this is checked at schema-definition time |
| NFR35 | Tables stay narrow | **Epic 1** | Invariant | Column-count and write-frequency lint |
| NFR36 | Extensible sets use `u32` codes plus a companion table, never enums | **Epic 1** | Invariant | Schema lint — a new variant must be a row insert, not a migration |
| NFR37 | Every table declares a bound; an unbounded table is a bug | **Epic 4** | Invariant | Story 4.12 — machine-readable bound registered with the metrics sampler. Build fails on an undeclared table |
| NFR38 | Incremental lazy migration is the standard workflow | **Epic 4** | Test | R1. Exercise a read-through backfill against a populated world |
| NFR39 | Backup before every migration; restore tested | **Epic 1** | Gate | Story 1.4 — B6. Explicitly scheduled before the world contains anything worth losing |
| NFR40 | No server-side event bus; read a table | **Epic 1** | Invariant | Architectural test over `server/src/` |
| NFR41 | Reducers return `Result`, never panic in normal flow | **Epic 1** | Invariant | Lint from the first reducer. Aborting always beats writing inconsistent state |
| NFR42 | Client degrades to not-drawing, never to crashing | **Epic 2** | Test | Earliest point an unknown `def_id` is possible. Feed a bad row, an unknown def and a failed asset load; assert the frame survives |
| NFR43 | The shrug test — a person could observe it and shrug | **Epic 6** | Test | Earliest concrete instances: empty till, no beans. Assert these produce content, not error paths |
| NFR44 | Logging by exception, structured; logs separate from observability | **Epic 1** | Invariant | Assert the two pipelines have no shared sink |
| NFR45 | Balance parameters live in tables and are runtime-tunable | **Epic 5** | Invariant | Earliest balance parameters are the labour market's. Assert no economic constant is compiled |
| NFR46 | Live parameters and seed values visibly marked | **Epic 6** | Invariant | Story 6.14 already records that this epic's economic figures are seed values. Assert every such table column carries the marking |

**Distribution of first tests:**

| Epic | NFRs first tested | Notes |
|---|---|---|
| Epic 0 | 1 | NFR27 — review gate only |
| **Epic 1** | **17** | The architectural invariants cluster here, correctly: most are properties of the module and schema, and several (NFR33, NFR34) are unfixable after the first commit |
| Epic 2 | 3 | Asset pipeline and `defs_version` |
| Epic 3 | 2 | Generation determinism and edge character |
| Epic 4 | 8 | The wire, metrics, table bounds, migration |
| Epic 5 | 12 | Everything that needs a population to be measurable |
| Epic 6 | 2 | Stock-dependent |
| Epic 9 | 1 | Needs both drivers to exist |
| Epic 10 | 1 | NFR21 — partly mechanical earlier, fully a review judgement here |

**The load is front-weighted, which is the right shape.** 31 of the 47 NFRs are first tested by the end of Epic 4, before the project's expensive falsification points. The seventeen landing in Epic 1 are not a burden to defer: NFR33 and NFR34 in particular describe decisions that **cannot be corrected after the first commit**, so their tests must exist before there is a schema to get wrong.

---

## Epic List

**Epic 0 plus fourteen.** Epic 0 builds the development team itself and is co-implemented by Adrian and the team; epics 1-14 build the game and are dispatched to it, with Adrian as stakeholder rather than developer. Each ends in something a person can do, and each stands alone — later epics build on earlier ones, never the reverse.

**How this differs from the GDD's E1-E13**, and why:

1. **Citizens move before the day loop.** The architecture records that the shop till requires customers, so the first job epic already depended on NPC capability. Building a stubbed customer to preserve the old order would repeat the mistake the GDD itself declined when it rejected a pre-foundation Burger Test spike: *a spike's answer might not transfer*. The Burger Test moves from position 5 to position 7 as a result — the single largest cost of this restructure, flagged for decision.
2. **Stock, Goods and Money is a new epic (6).** The architecture found it absent and load-bearing. It is L1's substrate, it makes "the till runs short of change" fall out rather than be special-cased, and it turns logistics into a job.
3. **Foundation epics are consolidated.** The GDD's E1-E4 all churn the same files (world model, collision, renderer, module skeleton). They become epics 1-4 organised by the boundary they own rather than by the layer they sit in, with the three gating spikes pulled into epic 1.

---

### Epic 0: The Development Team

The six-role agentic team defined by the team charter exists, dispatches itself, gates itself on budget, reviews its own work against the architecture and the vision, and shows Adrian something playable or visible every Friday - without him in the loop.

**Deliverable:** the six roles as durable configurations, Scotty's scheduled session, a budget gate with a broken-gate alarm and a watchdog outside the loop, the dispatch cycle and PR protocol, session lifecycle and cleanup, project context, the consistency review gate, sharded epics with sprint tracking, lead-scope tagging, TDD with a trace matrix, the escalation path, agent tooling, a local dev environment, CI and a definition of done, deploy and the Friday demo, the decision log, a measured cost per story, the epic breakdown moved onto the board as issues, the feedback loop that turns Adrian's demo comments into sized, prioritised stories, and the leads' prompts rewritten to carry judgement rather than a restated protocol.
**Depends on:** nothing. This precedes the product work.
**Specified by:** `agentic-team/high-level-agentic-flow.mmd`, `agentic-team/pr-scope.md` and `scripts/README.md`. The `team-charter.md` that originally specified this epic has been deleted; see the note at the top of `epic-0.md`.
**Performed by:** Adrian and the team together - the only epic in this document for which that is true. From Epic 1 the team is sole developer.

**FRs covered:** none, deliberately. Epic 0 builds no game. It serves NFR18, NFR27, NFR28, NFR29, NFR37 and NFR44, and the GDD's stated dependency on agentic development capacity.

---

### Epic 1: Foundations and Gating Spikes

A player can walk an avatar down a hand-laid test street in a browser tab, and the three measurements that could overturn architectural decisions have been taken before anything depends on them.

**Playable deliverable:** walk a character down a test street, in a browser, with working collision, depth sorting and a settings menu.
**Depends on:** nothing. This is the first epic.
**Carries the risk of:** R5, R10, A4 — and the permanent schema decisions (D12) that cannot be changed later.

**FRs covered:** FR61, FR62, FR117, FR118, FR119, FR120, FR121, FR122, FR123, FR124, FR125, FR137, FR148, FR149, FR150, FR151, FR152, FR165, FR168, FR173

---

### Epic 2: The Content Pipeline

An agent can author world content and have its own work validated, without a human ever placing a tile.

This epic is load-bearing rather than plumbing: the design ships no hand-authored content, so the generator's rules **are** the content pipeline (A5). Everything downstream inherits their quality, and there is no fallback of hand-laying a good street.

**Deliverable:** a scripted block validates against the rules, and a deliberately broken one is correctly rejected with a named violation.

*(Labelled `Deliverable` rather than `Playable deliverable`, as Epic 0 is. A player can do nothing after this epic that they could not do after Epic 1 — the outcome is an agent's, and 9 of this epic's 12 stories are developer- or agent-facing. The epic is load-bearing rather than plumbing, since the generator's rules **are** the content pipeline; only the label would have been wrong. The `Playable deliverable` convention is what makes the other thirteen epics auditable, so it is kept honest here.)*
**Depends on:** Epic 1.
**Carries the risk of:** A5, R9 — wrong footprints fail silently, so invariants rather than review are the detector.

**FRs covered:** FR111, FR112, FR126, FR127, FR128, FR147

---

### Epic 3: The Generated City

A player can walk a whole generated 512x512 district, enter buildings, and find neighbourhoods that read as different from one another.

**Playable deliverable:** walk a generated district from edge to core; enter 100+ interiors; the same seed reproduces the same city.
**Depends on:** Epic 2.
**Carries the risk of:** A5, R3, R8 — determinism must survive an arbitrary patch history.

**FRs covered:** FR107, FR108, FR109, FR110, FR113, FR114, FR115, FR116, FR129, FR130, FR131, FR132, FR134, FR135, FR167

---

### Epic 4: The Living Wire

Two people stand in the same city in under a second, and the city keeps its own time whether or not anybody is connected.

**Playable deliverable:** two browsers in one city seeing each other move; close the tab, return a day later, and arrive where elapsed time put you.
**Depends on:** Epics 1 and 3.
**Carries the risk of:** A4 (the hardest constraint in the project), R1, R2, R4, R5.
**Closes:** open gap G4 (in-city clock authority).

**FRs covered:** FR1, FR2, FR3, FR136, FR138, FR139, FR140, FR141, FR142, FR143, FR144, FR145, FR146, FR163, FR169, FR170, FR171, FR172, FR177, FR178, FR179

---

### Epic 5: Citizens

The city feels populated with one player connected. This epic answers the AI-density hypothesis, which the brief names as the project's real engineering risk — harder than multiplayer.

Stories run in the architecture's build order: **one NPC walks a street believably (L3), then it gets a day (L2), then a population of them has a labour market.** D-L3's falsification gate — does client-side L3 for ~200 agents stay inside ~2 ms per frame — is measured here, before anything depends on it.

**Playable deliverable:** stand on a street at rush hour and watch ~22 people who each have a reason to be there; follow one home; ask the causality inspector why they went.
**Depends on:** Epic 4.
**Carries the risk of:** A2, A9, R6, R7, R10.

**FRs covered:** FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR56, FR57, FR58, FR59, FR60, FR63, FR64, FR65, FR67, FR68, FR133, FR164

---

### Epic 6: Stock, Goods and Money

Things exist in quantities, move only when somebody moves them, and money is a physical object before it is a number.

**New epic — absent from the GDD's breakdown, identified by the architecture as load-bearing.** It is L1's substrate, so it precedes the institutional layer that consumes it.

**Playable deliverable:** watch a cafe's beans deplete as citizens buy coffee, an order chain refill them from a supplier who orders across the city boundary, and a till run short of change.
**Depends on:** Epic 5.
**Carries the risk of:** the grid-inventory tedium recorded in D19 — watch it alongside Epic 8's procedure prototyping, since the two are felt together.

**FRs covered:** FR66, FR86, FR87, FR88, FR89, FR90, FR91, FR92, FR93, FR94, FR95, FR96, FR97, FR98, FR174, FR175, FR176

---

### Epic 7: The Day Loop — the Burger Test, first read

A player can live one day: wake in a flat they can barely afford, walk to work, hold down a shift, get paid, and have rent take its bite.

**This is the project's first falsification point.** Everything after it assumes that mundane work is intrinsically satisfying without SS13's round timer and antagonists.

**Signal-quality note, carried from the GDD:** the shop till is the more engaging first job but the *softer* test — it may satisfy because of customers and feedback, in ways that do not generalise to an unsupervised post. The hard case is deliberately held one epic back rather than dropped.

**Playable deliverable:** wake, commute 60 in-city minutes on foot, work a convenience shop till, get paid, have rent taken. **And a first read on whether that is fun.**
**Depends on:** Epics 5 and 6 — the till needs customers and it needs stock and cash.
**Carries the risk of:** A8, the critical assumption.

**FRs covered:** FR4, FR5, FR6, FR7, FR19, FR20, FR22, FR23, FR29, FR181

---

### Epic 8: Procedure and Props — the Burger Test, the hard case

Work that can be performed well or badly, with nothing scoring you — and an empty post that has to hold a player anyway.

**The second and harder falsification point.** If an unsupervised shift with nothing demanding attention is not satisfying, P4 has failed and the design's foundation is wrong.

**Resolves:** A1, the multi-step procedure interaction model, by prototyping. This is the most important unresolved control question in the design and is not resolvable on paper.

**Playable deliverable:** two jobs with real procedure, each performable well or badly, nothing scoring you — plus solitaire on the guard's computer, and a lobby you can clean that nobody asked you to clean.
**Depends on:** Epic 7.

**FRs covered:** FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR30, FR31, FR32, FR33, FR34, FR180

---

### Epic 9: Reciprocal Occupancy

A player can leave and come back safely, and the night is populated because somebody is always awake in it.

D20 established that the understudy and the night shift are not two systems: a citizen body has one driver, and the driver is swappable.

**Playable deliverable:** log off for a real day, come back, and find your life intact and slightly richer — with the street changed rather than your possessions. Or stay up past bedtime and drive somebody else's night bus.
**Depends on:** Epic 8 — handover is mid-procedure, so the procedure state machine must exist first.
**Carries the risk of:** A7, A10.

**FRs covered:** FR8, FR35, FR36, FR37, FR38, FR39, FR40, FR41, FR42, FR43, FR44, FR45, FR46, FR47

---

### Epic 10: Institutions and the Reference Slice

The plastic-bottle loop runs end to end, and the player reads it on their commute.

This is the vertical slice that exercises institutions, emergence, jobs and physical consequence on a single street — the GDD's named mitigation against the project's headline scope risk.

**Playable deliverable:** a sanitation budget shortfall produces a full bin, produces a dropped bottle, degrades a street, triggers complaints, and opens a budget chain that a finance officer denies — and you watch the whole thing happen on your way to work, without ever entering the building where it was decided.
**Depends on:** Epics 6 and 5 — a chain moves goods, and a decider is a citizen.
**Carries the risk of:** the habituation watch recorded in D14 — if residents stop noticing a bad street, the signal starves.

**FRs covered:** FR18, FR24, FR69, FR70, FR71, FR72, FR73, FR74, FR75, FR76, FR77, FR78, FR79, FR80, FR81, FR82, FR83, FR84, FR85, FR166

---

### Epic 11: Transit and the Full Roster

Five playable jobs, real transit with routes and timetables, and a city that sounds like somewhere with its own business.

**Playable deliverable:** the MVP district — five playable jobs, trams and buses running to a timetable, institutions staffed, and a tram you hear but never see.
**Depends on:** Epic 10.

**FRs covered:** FR25, FR153, FR154, FR155, FR156 *(and completes FR14's job roster: night bus driver and cafe barista)*

---

### Epic 12: A Life

A player with spare minutes has three genuinely different things to spend them on, and a shelf that shows it.

**Playable deliverable:** buy the bike and feel the commute shorten; cook something that comes out well; put the fourth plushie on the shelf; split the rent with somebody and discover your first friendship is a financial instrument.
**Depends on:** Epic 11 — the transit pass needs transit to exist.

**FRs covered:** FR21, FR26, FR27, FR28, FR103, FR104

---

### Epic 13: Careers

A player can spend their evenings qualifying for a post, wait for it to open, take it, and make decisions in it that outlast them.

**Closes the A3 gap.** The architecture found this far cheaper than the GDD assumed: a decider is not a different kind of agent, only a citizen whose work-time option set is matters instead of procedure steps. The first player-holdable decision link is an addition, not a rebuild.

**Playable deliverable:** take an evening class out of your own time, wait for a vacancy, get the keys — then approve or deny a budget request that lands on a street you have never walked down.
**Depends on:** Epic 12.

**FRs covered:** FR99, FR100, FR101, FR102, FR105, FR106

---

### Epic 14: Growth

The city grows because the player population grew, so there is always somewhere affordable to begin.

**Playable deliverable:** watch a new neighbourhood get surveyed, approved, budgeted and built — caused by population pressure the player is part of — and walk into it when the hoardings come down.
**Depends on:** Epics 13 and 3 (generation must support incremental extension).
**Carries the risk of:** R3, R8 — the nav graph patch log's determinism-versus-compaction tension is decided here.

**FRs covered:** FR157, FR158, FR159, FR160, FR161, FR162

---

### Sequence

```
0 The Development Team  (the developer's own work)
         |
         v
1 Foundations -> 2 Pipeline -> 3 City -> 4 Wire -> 5 Citizens -> 6 Stock
                                                                    |
        7 Day Loop -> 8 Procedure -> 9 Occupancy -> 10 Institutions <+
                     (Burger Test)
                            |
        11 Transit -> 12 A Life -> 13 Careers -> 14 Growth

|---- foundation ----|-- density --|-- Burger Test --|--- depth ---|
```

**Three falsification points**, unchanged in substance from the GDD: **Epic 5** answers whether AI citizens can carry aliveness at low concurrency; **Epic 7** gives a first read on the Burger Test; **Epic 8** delivers its hard case, the unsupervised empty post. Everything after Epic 8 assumes yes.

---

---

## The epic files

This document holds the global sections. Each epic is its own file, and no role loads more than the one it needs.

| Epic | | Stories |
|---|---|---|
| 0 | [The Development Team](epic-0.md) | 19 |
| 1 | [Foundations and Gating Spikes](epic-1.md) | 15 |
| 2 | [The Content Pipeline](epic-2.md) | 12 |
| 3 | [The Generated City](epic-3.md) | 16 |
| 4 | [The Living Wire](epic-4.md) | 16 |
| 5 | [Citizens](epic-5.md) | 19 |
| 6 | [Stock, Goods and Money](epic-6.md) | 16 |
| 7 | [The Day Loop - the Burger Test, first read](epic-7.md) | 14 |
| 8 | [Procedure and Props - the Burger Test, the hard case](epic-8.md) | 16 |
| 9 | [Reciprocal Occupancy](epic-9.md) | 14 |
| 10 | [Institutions and the Reference Slice](epic-10.md) | 18 |
| 11 | [Transit and the Full Roster](epic-11.md) | 11 |
| 12 | [A Life](epic-12.md) | 9 |
| 13 | [Careers](epic-13.md) | 10 |
| 14 | [Growth](epic-14.md) | 10 |

**Lead scope is recorded per story**, as a `**Leads:**` line under each story heading. Quentin is in scope on every story; Derek, Tim and Artie are conditional. Scotty reads the line rather than deciding it.
