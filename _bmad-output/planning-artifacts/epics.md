---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/gdds/gdd-BrowserCity-2026-08-25/gdd.md
  - _bmad-output/planning-artifacts/architecture/architecture-BrowserCity-2026-08-25/architecture.md
---

# BrowserCity - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for BrowserCity, decomposing the requirements from the GDD, UX Design if it exists, and Architecture requirements into implementable stories.

**Source note.** Two input documents only: the GDD (2026-08-25) and the Architecture (2026-08-25, complete, 21 decisions). No UX Design Specification exists for this project. An earlier design-level epic charter lived at `gdds/gdd-BrowserCity-2026-08-25/epics.md`; it was superseded by this document and has since been removed. Where the architecture's findings superseded it, this document folded those findings in rather than inheriting the earlier structure. This file is the sole authoritative epic breakdown.

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

**Epic 0 plus fourteen.** Epic 0 builds the development team itself and is the developer's own work; epics 1-14 build the game and are dispatched to it. Each ends in something a person can do, and each stands alone — later epics build on earlier ones, never the reverse.

**How this differs from the GDD's E1-E13**, and why:

1. **Citizens move before the day loop.** The architecture records that the shop till requires customers, so the first job epic already depended on NPC capability. Building a stubbed customer to preserve the old order would repeat the mistake the GDD itself declined when it rejected a pre-foundation Burger Test spike: *a spike's answer might not transfer*. The Burger Test moves from position 5 to position 7 as a result — the single largest cost of this restructure, flagged for decision.
2. **Stock, Goods and Money is a new epic (6).** The architecture found it absent and load-bearing. It is L1's substrate, it makes "the till runs short of change" fall out rather than be special-cased, and it turns logistics into a job.
3. **Foundation epics are consolidated.** The GDD's E1-E4 all churn the same files (world model, collision, renderer, module skeleton). They become epics 1-4 organised by the boundary they own rather than by the layer they sit in, with the three gating spikes pulled into epic 1.

---

### Epic 0: The Development Team

The solo developer can dispatch work to agents, know what state every story is in, and trust that what comes back respects the architecture's non-negotiable rules.

**Deliverable:** a coordinator session, written project context, a review gate, sprint tracking derived from this document, CI, and a named escalation path.
**Depends on:** nothing. This precedes the product work.
**Performed by:** the developer, not the agentic team - the only epic in this document for which that is true.

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

## Epic 0: The Development Team

The solo developer can dispatch work to agents, know what state every story is in, and trust that what comes back respects the architecture's non-negotiable rules.

**This epic is the developer's own work, not the agentic team's.** It is the only epic in this document whose stories are performed by a person rather than dispatched. It exists because the GDD names agentic development capacity as a hard dependency - *"this is not an optimisation; it is what makes the scope possible for one person"* - and nothing else in the epic list builds it.

**FRs covered: none, deliberately.** Epic 0 builds no game. It serves NFR27 (uniform, data-driven, agent-extensible by construction), NFR28 and NFR29 (the `sim/` purity boundary and the property tests that depend on it), NFR37 (every table declares a bound, checkable in review), NFR44 (logging discipline), and above all NFR18 - *every state change has an author* - which the architecture names as **the rule most likely to be broken and the most damaging**, enforceable only by review.

**Sizing.** These stories are small. The risk is not that they are hard; it is that skipping them is invisible until Epic 5, by which point a hundred stories have been written under conventions nobody wrote down.

### Story 0.1: The Coordinator Session

As the solo developer,
I want one long-lived session that owns the backlog and dispatches work into worktrees,
So that I am directing a team rather than remembering where I left off.

**Acceptance Criteria:**

**Given** work happens across multiple isolated worktrees
**When** the coordinator session is established
**Then** it owns the backlog, knows which story each worktree is working, and can address each by name

**Given** a story is ready to start
**When** the coordinator dispatches it
**Then** an agent begins in its own worktree with the story file, the architecture and the project context already in scope
**And** the coordinator records which worktree holds which story

**Given** an agent finishes, stalls or escalates
**When** the coordinator next wakes
**Then** it can distinguish the three cases without reading the whole transcript

**Given** the developer closes the laptop mid-sprint
**When** they return
**Then** the coordinator can restate current state from durable files rather than from conversation history

### Story 0.2: Project Context for Agents

As the solo developer,
I want the unobvious rules written where every agent will read them,
So that I am not re-explaining the same five constraints in every story.

**Acceptance Criteria:**

**Given** `gds-generate-project-context` produces `project-context.md` from the planning artifacts
**When** it is run against the GDD, the architecture and this epics document
**Then** the output captures the rules an LLM will otherwise get wrong, not a summary of the design

**Given** the architecture names specific failure modes agents are prone to
**When** the context file is written
**Then** it states plainly: `sim/` never reads a table; no reducer detects a condition and acts without a citizen in between; codes not enums; columns append-only with defaults; no server-side event bus; L3 never writes the ledger; client-derived values seeded from stable ids

**Given** the distinguishing error-handling rule is easy to get backwards
**When** the context file is written
**Then** it states that an empty till, a denied budget, a closed cafe and a stalled chain are **content, not errors**
**And** it says why: without the rule, agents will wrap the institutional friction that *is* the story in error handling and log-spam it

**Given** agents read a repository-level instruction file by convention
**When** the context is generated
**Then** it is reachable from that file rather than only from `_bmad-output/`

**Given** the design and architecture will move
**When** either changes materially
**Then** regenerating the context is part of that change, not a later cleanup

### Story 0.3: The Consistency Rules as a Review Gate

As the solo developer,
I want the architecture's own consistency rules turned into a checklist an agent runs against its own diff,
So that the rules enforced only by review are actually reviewed.

**Acceptance Criteria:**

**Given** the architecture lists seven consistency rules and names their enforcement
**When** the review gate is built
**Then** each rule appears as a check, and each check states whether it is machine-verifiable or requires judgement

**Given** "no detection-without-an-author" is named as the most likely and most damaging violation
**When** a diff adds a reducer
**Then** the gate asks explicitly whether that reducer both detects a condition and changes the world with no citizen in between
**And** a diff that does so is rejected however well it performs

**Given** `sim/` purity is the only boundary in the project that can be violated silently
**When** a diff touches `sim/`
**Then** the gate checks for table access, and the `sim/` tests continue to run with no database

**Given** every table must declare a bound
**When** a diff adds a table
**Then** the gate requires a declared bound of a stated kind, and rejects the diff without one

**Given** the gate is run by agents on their own work before the developer sees it
**When** an agent completes a story
**Then** it reports the gate's result as part of handing back

### Story 0.4: Sprint Tracking from the Epics File

As the solo developer,
I want story status derived from this document rather than maintained beside it,
So that the plan and the tracker cannot drift apart.

**Acceptance Criteria:**

**Given** `gds-sprint-planning` parses `epic*.md` files, which this document's filename matches
**When** it is run
**Then** `sprint-status.yaml` contains every epic and every story in this document, including Epic 0's

**Given** the checklist requires no items in the tracker that do not exist in the epic files, and none missing
**When** the tracker is generated
**Then** both directions round-trip cleanly
**And** the story numbering used here, including the `0.N` series, is parsed correctly rather than skipped

**Given** stories are added or renumbered as later epics are written
**When** the tracker is regenerated
**Then** existing statuses survive and only the structure updates

**Given** the developer wants to know where things stand
**When** they ask for sprint status
**Then** the answer comes from the tracker, and names what is in progress, what is blocked and what is next

### Story 0.5: The Story Lifecycle

As the solo developer,
I want one named path from a story in this document to merged code,
So that every story is worked the same way and I can tell where any of them is.

**Acceptance Criteria:**

**Given** the installed skills provide create-story, dev-story, code-review and retrospective
**When** the lifecycle is defined
**Then** each stage names its entry condition, its artifact and its exit condition

**Given** a story is picked up
**When** its story file is created
**Then** it carries the acceptance criteria from this document verbatim, plus the architectural decisions and patterns it must respect
**And** an agent implementing it needs no further context from the developer

**Given** acceptance criteria in this document are written as Given/When/Then
**When** a story is implemented
**Then** each criterion is demonstrably satisfied or explicitly waived with a recorded reason
**And** a story with silently unmet criteria does not pass review

**Given** an epic completes
**When** the retrospective runs
**Then** it records what the epic actually produced against what it promised, and any finding that should change later epics

### Story 0.6: The Escalation Path

As the solo developer,
I want agents to stop and ask on the small set of questions that are genuinely mine,
So that autonomy does not quietly become drift.

**Acceptance Criteria:**

**Given** most decisions are the agent's to make
**When** the escalation path is defined
**Then** it lists the specific conditions that force a stop, and they are few

**Given** some decisions are permanent and unforgiving
**When** an agent would add a primary key, add a unique constraint, or change a table's scheduling status
**Then** it stops and escalates, because the platform will not let the choice be revised

**Given** the design laws are not the agent's to trade against
**When** an agent finds an acceptance criterion that appears to require breaking one - a HUD element, a state change with no author, a system that punishes logging off, a mechanical seam between player-held and AI-held roles
**Then** it stops and reports the conflict rather than resolving it

**Given** a spike may return a number that overturns a decision
**When** it does
**Then** the agent reports the finding and stops, rather than working around it

**Given** an escalation costs the developer attention
**When** an agent escalates
**Then** it states the question, the options it sees, and its own recommendation
### Story 0.7: Scheduled Wake-Ups and Unattended Iteration

As the solo developer,
I want work to continue while I am not at the keyboard,
So that evenings and weekends are not the only hours the project moves.

**Acceptance Criteria:**

**Given** the developer works evenings and weekends with no deadline
**When** a wake-up schedule is configured
**Then** it picks up the next ready story, or reports that nothing is ready and why

**Given** unattended work can go wrong quietly
**When** an unattended run completes
**Then** it leaves a durable record of what it did, what it decided, and what it could not resolve
**And** the developer can read that record without reconstructing a session

**Given** some work must not proceed without a person
**When** an unattended run reaches such a point
**Then** it stops and escalates rather than choosing
**And** the conditions that force a stop are the ones defined in Story 0.6

**Given** an unattended run could otherwise churn
**When** it cannot make progress
**Then** it stops rather than retrying, and says what it is blocked on

### Story 0.8: Agent Tooling

As the solo developer,
I want agents to have first-party access to the platform they are building on,
So that they are not guessing at a stack that releases weekly.

**Acceptance Criteria:**

**Given** SpacetimeDB ships an official MCP server as a CLI subcommand and an official Claude plugin
**When** tooling is configured
**Then** both are installed and reachable from the agent sessions that need them
**And** the community alternatives are not used, since the first-party option supersedes them

**Given** the platform released five versions in one month during architecture, touching primitives this design depends on
**When** an agent needs current documentation
**Then** Context7 is available for lookup rather than the agent relying on training data

**Given** the client is PixiJS v8
**When** rendering work is dispatched
**Then** the official PixiJS agent skills are available to it

**Given** tooling drifts
**When** a version changes materially
**Then** the recorded tooling setup is updated as part of that change

### Story 0.9: Continuous Integration and the Definition of Done

As the solo developer,
I want a single command that says whether the project is still sound,
So that "done" is a fact rather than an opinion.

**Acceptance Criteria:**

**Given** `sim/` is pure and property tests run with no database
**When** CI runs
**Then** the property suite executes thousands of simulated citizen-weeks and fails on any violated invariant

**Given** the invariants recorded across the architecture are testable
**When** CI runs
**Then** it covers at minimum: no matter starves indefinitely, inventory is a superset after any absence, no owned item degrades during absence, budget never goes negative, `collider` is contained within `footprint`, and two derivations from identical seeded inputs match

**Given** determinism must survive dependency bumps
**When** a dependency changes
**Then** the determinism harness runs and fails loudly if generation output moved

**Given** content correctness is enforced by invariants rather than review
**When** definitions change
**Then** the Epic 2 footprint invariants and validation harness run in CI

**Given** a story claims to be done
**When** the definition of done is applied
**Then** it requires: acceptance criteria demonstrated, CI green, the consistency gate passed, and any new table's bound declared

### Story 0.10: The Running Decision Log

As the solo developer,
I want implementation-time decisions recorded where the next agent will find them,
So that a choice made once is not silently remade differently.

**Acceptance Criteria:**

**Given** the architecture carries revisit triggers, escape-hatch conditions and deferred decisions
**When** one of them fires during implementation
**Then** the decision taken is recorded with its date, its trigger and its reasoning

**Given** several architectural decisions are explicitly provisional pending measurement
**When** a spike returns a number
**Then** the affected decision is updated in place or superseded, and the supersession is visible
**And** an agent reading the architecture cannot act on a position that measurement has overturned

**Given** the architecture's own validation found it had accumulated stale text as later decisions overturned earlier ones, such that an agent reading one section would have implemented a system that no longer existed
**When** a decision changes
**Then** every place stating the old position is updated in the same change


---

## Epic 1: Foundations and Gating Spikes

A player can walk an avatar down a hand-laid test street in a browser tab, and the three measurements that could overturn architectural decisions have been taken before anything depends on them.

**Sequencing note.** Stories 1.3, 1.4 and 1.14 are spikes. They are placed where their answers are still free to change a decision: 1.3 and 1.4 before any world state exists, 1.14 once there is enough content to measure honestly. A spike that reports a failure is a successful story — the deliverable is the measurement, not a passing number.

### Story 1.1: Project Scaffold and First Round Trip

As a developer,
I want the server module and browser client standing up together with a verified round trip,
So that every later story has a place to put code and a way to know it ran.

**Acceptance Criteria:**

**Given** a clean checkout with the Rust toolchain, the `wasm32-unknown-unknown` target, the SpacetimeDB CLI and Node.js installed
**When** the scaffold commands are run (`spacetime init --lang rust --project-path ./server browsercity`, `npm create vite@latest client -- --template vanilla-ts`, `npm install pixi.js spacetimedb`, `spacetime generate --lang typescript --out-dir client/src/net/bindings`)
**Then** both targets build without error
**And** the directory structure matches the architecture's prescribed layout

**Given** the module is published locally
**When** a reducer writes a row and the browser client is subscribed to that table
**Then** the row appears in the client within one second of the write
**And** the client receives it through the SDK's `onInsert` callback

**Given** the developer edits a Rust source file
**When** `spacetime dev` is running
**Then** the module rebuilds and republishes without a manual step

**Given** the Windows install path for the SpacetimeDB CLI is not the documented Unix shell installer
**When** the prerequisites are set up on this machine
**Then** the working Windows install method is recorded in the repository README
**And** the recorded method is verified by a clean install on a second path

### Story 1.2: Permanent Schema Decisions

As a developer,
I want every primary key, unique constraint and scheduled table the design will ever need declared in the first commit,
So that a world which can never be reset is never blocked by a migration the platform forbids.

> **This story deliberately departs from just-in-time data creation. Do not "correct" it.**
> The normal rule is that each story creates the data structures it needs, and creating them all upfront is an anti-pattern. That rule is suspended here because the platform makes these particular declarations irreversible: in SpacetimeDB a primary key and a unique constraint are permanent (NFR33), and **a normal table can never become a scheduled one** (NFR34). Deferring them to the story that first needs them would not make them flexible — it would make them unfixable *and wrong*. The architecture states it directly: *"Fix the permanent decisions first."* Everything else in the schema remains additive and just-in-time; only these three categories are settled here.

**Acceptance Criteria:**

**Given** automigration forbids adding primary keys, adding unique constraints, and changing a table's scheduling status
**When** the initial schema is written
**Then** every table any architectural decision names carries its final primary key
**And** every table that might ever need scheduling is declared as a scheduled table, even where it is not yet used

**Given** the `character <-> identity` mapping table is required from day one by D5
**When** the initial schema is written
**Then** that table exists with a one-character-to-N-identities shape, before any character row can be created

**Given** a developer appends a new field to an existing table
**When** the module is published against a live world
**Then** the publish succeeds because the column carried a default
**And** a publish that appends a column without a default fails loudly rather than silently

**Given** any extensible set is needed (matter kinds, provisions, reason codes, node kinds)
**When** it is declared
**Then** it is a `u32` code with a companion data table, never a Rust enum

### Story 1.3: Spike - Scheduled-Reducer Timing Fidelity

As a developer,
I want measured evidence that scheduled reducers fire when they say they will,
So that the far-agent model is not built on a platform behaviour patched twice in the last month.

**Acceptance Criteria:**

**Given** SpacetimeDB v2.8.3, in which scheduled-function drift was fixed in both v2.7.1 and v2.8.3
**When** a scheduled table is loaded with rows due across intervals from 100 ms to 10 minutes
**Then** each row's actual fire time is recorded against its scheduled time
**And** the drift distribution is reported with median, p95 and maximum

**Given** the module is republished while scheduled rows are pending
**When** the republish completes
**Then** the report states whether pending rows survived, fired late, or were lost

**Given** measured drift would be visible to a player as a citizen arriving at the wrong time
**When** the spike concludes
**Then** the finding is recorded against risk R10 and decision D7
**And** if drift exceeds what the design can absorb, the Alarm Clock decision is reopened rather than worked around

### Story 1.4: Spike - Backup, Export and a Tested Restore

As a developer,
I want a backup path I have personally restored from,
So that a world which cannot be regenerated never rests on an assumption.

**Acceptance Criteria:**

**Given** Maincloud advertises backups but no user-facing backup, restore or export command was found in the CLI
**When** the platform's backup semantics are investigated directly
**Then** frequency, retention, and whether the developer can trigger and restore without vendor support are recorded as findings

**Given** the vendor's backup semantics may prove insufficient or opaque
**When** this story completes
**Then** a logical export exists that dumps every table via `spacetime sql` on a schedule
**And** the export runs unattended and reports its own failure

**Given** an export file and an empty database
**When** the restore procedure is run
**Then** the restored world matches the exported one row for row
**And** the procedure is documented as a runnable sequence, not as prose

**Given** an untested backup is not a backup
**When** this story is marked complete
**Then** at least one full restore has actually been performed and verified

### Story 1.5: The World Data Model

As a developer,
I want one tilemap addressed by floor and layer,
So that bridges, manholes, upper storeys and interiors are one mechanism rather than four special cases.

**Acceptance Criteria:**

**Given** the world is addressed as `(x, y, floor, layer)`
**When** two cells occupy the same `(x, y)` on different floors
**Then** both exist simultaneously without conflict
**And** an entity on floor 0 tests collision only against floor 0

**Given** a player standing on a road with a bridge overhead
**When** they walk beneath the bridge deck
**Then** they pass under it, because the deck is not in their floor's collision set

**Given** a transition cell (stairs, ramp, ladder, station steps, manhole)
**When** the player enters it
**Then** their floor index changes to the transition's target floor
**And** their collision set changes with it in the same frame

**Given** interiors live in the same tilemap at their building's footprint
**When** a player walks through a doorway
**Then** no space transition, portal or load occurs - the door is an ordinary walkable cell

**Given** every cell carries a building/room ownership id
**When** the player is inside a building
**Then** that building's id is queryable for the player's current position

### Story 1.6: Layer-Aware Depth Sorting

As a player,
I want to be drawn in front of what I am in front of and behind what I am behind,
So that the city reads as a place with depth rather than a flat collage.

**Acceptance Criteria:**

**Given** the renderer runs three flat passes (Ground, Ground decals, Ground objects) then one y-sorted pool
**When** a frame is drawn
**Then** pool members are ordered by `(y, layer_rank, x, object_id)` ascending
**And** no object is ever sliced or split across passes

**Given** `layer_rank` is assigned in tens (Furniture 0, Objects 10, Walls 20, Wall decals 30, Characters 40)
**When** two objects share an anchor cell
**Then** rank alone resolves them - a glass draws over a table, a poster over a wall

**Given** a multi-cell prop such as a long counter
**When** the player stands at one end of it
**Then** they render in front of the near end and behind the far end
**And** this works because the prop decomposed into per-cell drawables each carrying its own anchor

**Given** content on a floor above or below the player's
**When** it is drawn
**Then** it is offset vertically in proportion to its floor
**And** the offset is derived from the tileset's storey height and validated against the LimeZu wall sprites

**Given** a sprite wider than its footprint (a canopy, an awning)
**When** it overlaps a sprite whose footprint cannot occlude it
**Then** the order is stable across frames, because footprint geometry determines no answer and any stable order is correct

### Story 1.7: Enclosure Visibility

As a player,
I want to see inside the building I am standing in,
So that interiors are places in the city rather than rooms behind a loading screen.

**Acceptance Criteria:**

**Given** the player enters a building
**When** its near-side walls would occlude them
**Then** those walls are retracted
**And** retraction is keyed on the building/room ownership id, not on proximity

**Given** a wall tile is a window
**When** it is rendered from outside
**Then** it draws semi-transparently and the furniture behind it is visible through the glass
**And** no masking or aperture system is involved

**Given** the subway is floor -1
**When** the player is above ground
**Then** the subway is culled entirely
**And** on entering it, the street floor above is culled instead

**Given** culling is per-enclosure
**When** the player stands in one shop of a terrace
**Then** only that shop's enclosure is opened, not the whole terrace

### Story 1.8: Player Movement and Sub-Tile Collision

As a player,
I want to walk continuously and be stopped by things that are solid,
So that the street is a physical space rather than a grid of legal squares.

**Acceptance Criteria:**

**Given** movement is fully client-authoritative with no server validation in v1
**When** the player holds a direction key
**Then** the avatar moves continuously and immediately, with no round trip

**Given** walking speed is 2.2 cells/second (35 world px/second)
**When** the player crosses one viewport width of 40 cells
**Then** it takes approximately 18 real seconds
**And** the speed is a named constant, not a literal scattered through movement code

**Given** collision rows expand into a derived grid on insert, delete and update
**When** the player moves against a solid object
**Then** the collision test is an `O(1)` lookup against that structure
**And** no row query happens in the movement path

**Given** collision uses swept AABB resolution against base-anchored rectangles
**When** the player walks into a corner at an angle
**Then** they slide along the surface rather than catching on it

**Given** a lamppost occupies a fraction of its cell
**When** the player walks past it
**Then** they pass through the rest of the cell, because collision is sub-tile rather than tile-granular

**Given** an object has no collider defined
**When** the player walks onto it
**Then** they walk over it, because absence of a collider is walkability

### Story 1.9: Intents and Keybindings

As a player,
I want clicking a thing in the world to mean something,
So that interaction is with objects rather than with menus.

**Acceptance Criteria:**

**Given** input produces intents rather than actions
**When** the player clicks a world object
**Then** the click resolves to an object instance via the derived grid
**And** reachability is checked against that definition's `interact_at`
**And** an intent is emitted whose meaning is left entirely to whatever consumes it

**Given** the object is out of reach
**When** the player clicks it
**Then** no intent is emitted and the click is visibly ignored

**Given** the procedure interaction model is deliberately unresolved until Epic 8
**When** this story is complete
**Then** nothing in the input layer encodes what any intent means
**And** Epic 8 can iterate on procedure feel without touching this code

**Given** keybindings are stored in `localStorage`
**When** the player rebinds a key and reloads the page
**Then** the new binding survives
**And** a browser with cleared storage falls back to defaults without error

### Story 1.10: Character Appearance

As a player,
I want the same person to look the same every time I see them,
So that recognising a face is possible at all.

**Acceptance Criteria:**

**Given** the character generator ships 511 parts across Bodies, Eyes, Hairstyles, Outfits and Accessories
**When** a character's appearance is stored
**Then** it is five small integers, not an asset reference

**Given** appearance is deterministic from citizen id
**When** the same citizen is rendered on two different clients, or on the same client a week later
**Then** the appearance is identical

**Given** the five part spritesheets are asserted to share an identical frame layout
**When** one `(animation, direction, frame)` index is applied
**Then** it selects the corresponding cell from all five sheets
**And** this invariant is verified once by test rather than assumed

**Given** appearance tuples must be coherent rather than random
**When** the generator produces one
**Then** kids' parts pair only with kids' bodies
**And** the outfit layer can be driven by occupation, so a janitor is visibly a janitor

**Given** a composite is rendered
**When** the same appearance appears many times on screen
**Then** the runtime caches the composite into a texture so each character costs one draw call rather than six

### Story 1.11: The DOM Shell

As a player,
I want the game's only interface furniture to be a settings menu and an honest connection notice,
So that nothing ever accumulates into a HUD.

**Acceptance Criteria:**

**Given** all UI is DOM and nothing persistent, global or abstract is drawn into the canvas
**When** the client is built
**Then** there is no in-canvas UI layer at all, so there is nowhere to put a counter

**Given** the DOM surface is exactly the boot name prompt, an options menu and connection-state notices
**When** the options menu is opened
**Then** it offers audio, display and controls, and nothing else

**Given** the connection drops
**When** the client notices
**Then** a connection-state notice appears in DOM
**And** the world keeps rendering its last known state rather than blanking

**Given** the no-HUD design law
**When** any informational element belonging to the fiction is needed
**Then** it is rendered in the world as an object, not in DOM

### Story 1.12: Debug Overlays

As a developer,
I want to see what the collision system and the sort order actually believe,
So that the failures which fail silently become visible.

**Acceptance Criteria:**

**Given** debug tooling is compiled in behind a flag not exposed in production
**When** the flag is off
**Then** no overlay can be activated by any input

**Given** the overlay framework exists
**When** the collision overlay is enabled
**Then** every collider rectangle is drawn over the world at its true position
**And** a prop with no collider is visibly distinguishable from one with a zero-size collider

**Given** the sort-order overlay is enabled
**When** objects overlap
**Then** each drawable's computed sort key is legible on screen

**Given** overlays must never be mistaken for the game
**When** any overlay is drawn
**Then** it is rendered in a deliberately non-diegetic style

**Given** later epics introduce navmesh, chunk boundary and citizen route overlays
**When** they do
**Then** they register with this framework rather than building their own

### Story 1.13: The Hand-Laid Test Street

As a player,
I want a street I can actually walk down,
So that every foundation built in this epic is proven by use rather than by unit test.

**Acceptance Criteria:**

**Given** no generator exists yet
**When** the test street is assembled
**Then** it is hand-laid from a minimal hardcoded object set, understood to be replaced wholesale by Epic 3

**Given** the test street must exercise each foundational case
**When** it is walked
**Then** it includes a bridge or underpass (two floors at one `(x, y)`), a transition cell, a building interior with retractable walls, a window, a multi-cell prop, and a prop the player can pass partly through

**Given** a person opens the page
**When** they press a movement key
**Then** they control a character on that street
**And** collision, depth sorting, wall retraction and appearance behave correctly together rather than only in isolation

### Story 1.14: Spike - Boot Budget Measured

As a developer,
I want the one-second boot claim tested against a real payload,
So that the hardest constraint in the project stops being arithmetic.

**Acceptance Criteria:**

**Given** D6's boot design is explicitly recorded as arithmetic rather than evidence
**When** the test street and client are loaded cold on a mid-range laptop over a typical domestic connection
**Then** time to first paint, time to interactive prompt, and time to player-controllable are each measured and recorded

**Given** the boot budget is a standing constraint rather than a system built later
**When** the measurement is taken
**Then** the breakdown attributes time to bundle, atlas, subscription decode and connection handshake separately
**And** the dominant term is named

**Given** D4 records a known risk that ~28k row decodes for one screen is a real slice of the boot budget
**When** subscription decode cost is measured
**Then** the result either clears the revisit trigger or opens D4's chunking migration

**Given** the measurement may show the target is missed
**When** it does
**Then** the finding is recorded against A4 and R5 and the affected decisions are reopened
**And** the story is complete regardless, because the deliverable is the measurement

---

### Story 1.15: Interactable Affordance

As a player,
I want to be able to tell what I can act on,
So that a dense street is a place I can use rather than a picture I have to guess at.

**Acceptance Criteria:**

**Given** the city is 16x16 pixel art at 3x zoom, deliberately dense with props
**When** dozens of drawn objects share a screen and a handful are interactable
**Then** an affordance exists, justified by that specific breakage rather than adopted as a default

**Given** the pointer is over an object that declares an interaction
**And** the player is within that definition's `interact_at`
**When** the object is hovered
**Then** a transient highlight is drawn on that object's own drawables
**And** the browser cursor changes

**Given** an object is reachable but not hovered
**When** the player looks at the street
**Then** it carries no treatment at all, because the world is not pre-lit

**Given** an object is hovered but out of reach
**When** the pointer rests on it
**Then** the cursor changes but the in-world highlight is withheld
**And** this is how reachability is learned rather than told

**Given** D17 permits transient object-bound canvas drawing and forbids the persistent, global or abstract
**When** the highlight is implemented
**Then** it exists only while hovered, is never state the world holds, and adds no floating icon, label, tooltip or prompt

**Given** the treatment must survive a busy street at rush hour without becoming noise
**When** strength is chosen
**Then** it is a dial rather than a fixed value, exposed in the options menu's display section
**And** the value is settled by playing rather than by specification

**Given** A1 asks whether procedure feels like handling or like clicking
**When** the Epic 8 prototype runs
**Then** this affordance is already in the build, so the prototype cannot mistake discovery friction for procedure friction

---

## Epic 2: The Content Pipeline

An agent can author world content and have its own work validated, without a human ever placing a tile.

**Why this is an epic and not plumbing.** The design ships no hand-authored content, so the generator's rules *are* the content pipeline (A5). Everything downstream inherits their quality and there is no fallback of hand-laying a good street. The specific danger is R9: wrong prop metadata fails **quietly** — a bin with no collision, a manhole you cannot descend — so the deliverable of this epic is not the authoring tool but the **failure detector**.

**Relationship to Epic 1.** Epic 1 loaded a hardcoded object set and raw part PNGs directly, to have something to render. This epic replaces that with `defs/` and packed atlases. Where a story here supersedes an Epic 1 shortcut, it says so.

### Story 2.1: The defs Source of Truth

As a developer,
I want one directory that both build targets consume and neither writes,
So that the client and the module can never disagree about what a thing is.

**Acceptance Criteria:**

**Given** `defs/` holds data and not code, subdivided into `objects/`, `items/`, `recipes/`, `professions/`, `chains/` and `balance/`
**When** the build runs
**Then** `tools/defs-build/` emits a Rust include for the module and a static asset for the client from that one source
**And** neither generated output is edited by hand

**Given** the server and client share no code by design
**When** both consume the same definition
**Then** they do so through two independent parsers over one generated source
**And** this duplication is documented as deliberate rather than as an oversight

**Given** a single `defs_version` covers prop atlases, character-part atlases, `object_def` and the audio manifest
**When** any one of them changes
**Then** the version changes for all of them
**And** nothing versions independently

**Given** a definition file is malformed
**When** the build runs
**Then** the build fails with the offending file and line named
**And** no partial output is emitted

### Story 2.2: Object Definitions

As a developer,
I want every placeable thing described by one record,
So that collision, depth sorting, walkability and inventory all read the same rectangle.

**Acceptance Criteria:**

**Given** an `object_def` carries id, name, layer, atlas page, sprite rect, footprint in cells, an optional collider in anchor-relative pixels, and an optional `interact_at`
**When** a definition is authored
**Then** the sprite rect is one whole-object rectangle, because the tileset ships whole objects as single PNGs and nothing needs compositing

**Given** absence of a collider is walkability
**When** a definition omits the collider
**Then** the object is walkable
**And** no separate `walkable` flag exists anywhere in the schema

**Given** a multi-cell prop is one row placed at its anchor cell (smallest x, largest y)
**When** it is placed in the world
**Then** the covered cells hold no rows of their own
**And** extent is read from the definition rather than stored per cell

**Given** several objects may share an anchor cell (a rug, a table, a glass)
**When** they are placed
**Then** all three exist at that cell and are separated by `layer_rank` at draw time

**Given** footprints are capped at approximately 8x8 cells
**When** a definition exceeds the cap
**Then** the build rejects it and directs the author to compose the structure from multiple objects
**And** the cap holds because the region-subscription margin depends on it being a constant

### Story 2.3: Footprint Proposal and Classification

As an agent,
I want a first guess at every prop's footprint that I can then correct,
So that authoring 3,000 definitions is a review task rather than a measurement task.

**Acceptance Criteria:**

**Given** a sprite's silhouette is not its footprint in an oblique projection with front-facing bias
**When** a footprint is proposed automatically
**Then** it is derived from alpha coverage of the sprite's **lower band** only
**And** the proposal is explicitly a starting point, never authority

**Given** the tileset's dominant city prop is 16x32 px - one cell of floor, two cells of screen height
**When** proposals are generated across the prop set
**Then** sprite height does not inflate footprint depth
**And** a 112x64 vehicle correctly proposes a footprint several cells deep, because depth greater than one is common rather than exceptional

**Given** an agent classifies each proposal against a set of archetypes
**When** a prop matches an archetype
**Then** the archetype supplies the footprint and collider shape
**And** the agent's correction is recorded in `defs/`, not in the tool

**Given** the pipeline runs offline exactly once per prop
**When** the world is generated or an object is spawned
**Then** no footprint is inferred at runtime, ever

### Story 2.4: Footprint Invariants

As a developer,
I want the pipeline to catch wrong metadata by rule rather than by my eyes,
So that a silent-failure surface becomes a loud one.

**Acceptance Criteria:**

**Given** every prop must have a nonzero footprint or appear on an explicit walkable allow-list (manhole, rug, doormat, floor decal)
**When** validation runs
**Then** a trash can with no collision is rejected by name
**And** a manhole absent from the allow-list is rejected by name

**Given** the invariant `collider` is contained within `footprint`
**When** a definition violates it
**Then** validation fails and reports both rectangles

**Given** collider rects must lie within sprite bounds
**When** a definition places a collider outside its sprite
**Then** validation fails

**Given** doorway cells must leave a passable gap of at least the character's collider width
**When** a doorway is formed too narrowly
**Then** validation fails before that arrangement can reach the world

**Given** a walkable region enclosed with no door is unreachable
**When** graph reachability is checked over a test block
**Then** any enclosed region is reported
**And** the same check will later run over generated districts without modification, because it takes a walkability grid rather than a hand-laid map

**Given** invariants are the failure detector rather than review
**When** any invariant fails
**Then** the build fails and no definition set is emitted

### Story 2.5: Contact-Sheet Review

As a developer,
I want to see every footprint drawn over its sprite on one page,
So that the errors no invariant can express are still catchable by looking.

**Acceptance Criteria:**

**Given** invariants catch structural errors but not judgement errors
**When** the contact sheet is generated
**Then** each sprite is rendered with its footprint and collider overlaid
**And** props are grouped by archetype so that an outlier is visible by comparison

**Given** a prop's footprint is plausible but wrong (a bench a player should walk behind, marked as walk-through)
**When** the sheet is reviewed
**Then** the reviewer can identify it and correct the definition in `defs/`

**Given** the sheet is regenerated on every definition change
**When** a prop's footprint is edited
**Then** the change is visible on the next sheet without a manual step

### Story 2.6: The Atlas Packer

As a player,
I want the game to load without waiting for thousands of individual images,
So that the one-second boot is possible at all.

**Acceptance Criteria:**

**Given** the tileset holds 23,519 PNGs across 135 MB
**When** the packer runs
**Then** only the used subset is packed, into 2048x2048 pages

**Given** the boot budget depends on a spawn screen referencing few pages
**When** pages are packed
**Then** they are grouped by neighbourhood and theme, following the tileset's own theme-sorter organisation
**And** a single spawn screen resolves against a small number of pages rather than the whole set

**Given** page filenames are content-hashed
**When** a page's contents are unchanged between builds
**Then** its filename is unchanged and the browser cache and service worker keep it
**And** versioning is free rather than a mechanism

**Given** rects and definitions must never drift apart
**When** the packer runs
**Then** it emits the atlas pages and the `object_def` rects together as one operation
**And** both are covered by the same `defs_version`

**Given** the GPU binds a limited number of textures simultaneously (commonly 16, sometimes fewer)
**When** pages are packed
**Then** the simultaneously-bound count for a typical scene stays around eight
**And** the packing rule that guarantees this is asserted at build time rather than hoped for

### Story 2.7: Character-Part Atlases

As a player,
I want a crowd of visibly different people to cost about as much as a crowd of identical ones,
So that a busy street is affordable.

**Acceptance Criteria:**

**Given** each of the five character parts is a complete spritesheet containing all animations
**When** the parts are packed
**Then** the invariant that all five share an identical frame layout is asserted by the build, not assumed
**And** a part sheet with a mismatched layout fails the build by name

**Given** Epic 1 loaded raw part PNGs directly to have something to render
**When** this story completes
**Then** the client loads packed character atlases instead
**And** the Epic 1 shortcut is removed rather than left alongside

**Given** the character atlases count toward the simultaneously-bound texture limit
**When** they are packed
**Then** five character layers plus tile and prop atlases stay within the budget established in Story 2.6

### Story 2.8: The defs_version Handshake

As a player,
I want a stale browser tab to notice it is stale,
So that the game never renders a world it is quietly misreading.

**Acceptance Criteria:**

**Given** a cached client holding old definitions would fail silently on an unknown `def_id`
**When** the client connects
**Then** the module publishes its `defs_version` and the client compares it against its own

**Given** the versions differ
**When** the comparison is made
**Then** the client refreshes its definitions and atlases before rendering anything
**And** it never draws a frame using a definition set it knows to be stale

**Given** `defs_version` also carries the schema and protocol version
**When** the module's schema has moved ahead of the client's bindings
**Then** the mismatch is detected at connect rather than at first divergent read

**Given** the versions match
**When** the client connects
**Then** the handshake costs no additional round trip on the common path

### Story 2.9: Tile Semantics and the Adjacency Grammar

As an agent,
I want to know what a tile means rather than only what it looks like,
So that I can place one correctly without a human telling me where it goes.

**Acceptance Criteria:**

**Given** a tile taxonomy describes semantic role rather than appearance
**When** a tile is classified
**Then** its role (ground, pavement, road, wall, floor, threshold, fixture) is data in `defs/`

**Given** adjacency rules state what may abut what
**When** two tiles are placed side by side in violation
**Then** the validation harness reports the violating pair and the rule that forbids it

**Given** a wall corner requires a specific arrangement, and a doorway is formed rather than drawn
**When** those constructions are expressed
**Then** they are grammar primitives in data, not special cases in code

**Given** room and building grammar primitives exist
**When** an agent composes a room from them
**Then** the result either satisfies the grammar or is rejected with a named reason

### Story 2.10: The Rule Engine

As an agent,
I want new placement rules to be rows rather than code,
So that extending the city's grammar does not mean editing the generator.

**Acceptance Criteria:**

**Given** rules are data evaluated by a generic engine
**When** a new constraint such as "no cafe above floor 2" is added
**Then** it is a row in `defs/` and no engine code changes

**Given** the engine supports five constraint kinds
**When** rules are authored
**Then** placement (a cafe may not appear above floor 2), distribution (municipal services at roughly one per N dwellings, evenly spread), coherence (no skyscraper in a villa district), adjacency (what may abut what, how a doorway is formed) and requirement (every dwelling has a door, every room has a light, every business has stock space) are each expressible

**Given** a rule per special case is the known failure mode
**When** a new requirement arrives
**Then** it is satisfied by a row against an existing kind, or by a deliberate decision to add a sixth kind - never by a bespoke branch

**Given** rule sets are versioned
**When** a rule changes
**Then** the rule-set version changes with it

### Story 2.11: The Validation Harness

As a developer,
I want the checker and the generator to read one source,
So that content cannot be silently bad.

**Acceptance Criteria:**

**Given** the generator applies the rules and the harness checks output against them
**When** both run
**Then** they read the same rule source
**And** any change that would let them read different sources fails the build

**Given** a correct block
**When** the harness runs over it
**Then** it passes with no violations reported

**Given** a deliberately broken block - a doorway too narrow, a room with no door, a skyscraper among villas, a cafe on the tenth floor
**When** the harness runs over it
**Then** each violation is reported individually, naming the rule and the location
**And** the harness does not stop at the first failure

**Given** this is A5's risk in its most dangerous form
**When** the harness is built
**Then** a test exists that deliberately points the two consumers at different sources and asserts the build fails

### Story 2.12: Agent Self-Verification

As an agent,
I want to extend the rule set and confirm my own work,
So that content authoring scales past what one person can review.

**Acceptance Criteria:**

**Given** the scope assumes systems testable enough that agents can extend and validate them
**When** an agent adds a new tile semantic, adjacency rule or placement constraint
**Then** it can run the harness and read a pass or a named failure without human interpretation

**Given** documentation and test coverage are part of this epic's deliverable rather than a follow-up
**When** an agent reads `defs/`
**Then** each rule kind carries at least one worked example and one deliberately failing case

**Given** an agent's change breaks an existing rule
**When** the harness runs
**Then** the regression is reported against the specific rule that broke
**And** the failing case is added to the test set rather than only fixed

---

## Epic 3: The Generated City

A player can walk a whole generated 512x512 district, enter buildings, and find neighbourhoods that read as different from one another.

**The largest and riskiest epic in the project.** Nothing is hand-placed, so there is no fallback if the rules produce a bad street (A5). Determinism must survive an arbitrary future patch history (R3, R8), because E13's growth breaks the same-seed-same-city promise otherwise.

**Scale target, from the settled baseline:** 512x512 cells, ~894 buildings, ~344 workplaces, dwellings for ~5,000 citizens, 100+ enterable interiors.

**Division of labour, per D21.** The GDD owns what neighbourhoods should *feel* like. The architecture owns the *shape* of the rule system. This epic owns the rule **content** — hundreds of placement constraints, adjacency tables and density curves — as its own artifact, authored incrementally.

### Story 3.1: The Generation Design Document

As a developer,
I want the rule content to live in a document I extend rather than in my head,
So that hundreds of constraints accumulate coherently instead of as accreted special cases.

**Acceptance Criteria:**

**Given** the architecture explicitly assigns rule content to an E3-owned artifact rather than to itself
**When** this epic begins
**Then** a generation design document exists and is the named home for placement constraints, adjacency tables, density curves and neighbourhood parameter ranges

**Given** the document is authored incrementally alongside the passes
**When** a pass is implemented
**Then** the rules it consumes are recorded in the document before or with the code, never after

**Given** rules are data in `defs/` rather than code
**When** the document specifies a rule
**Then** it names the constraint kind (placement, distribution, coherence, adjacency, requirement) it is expressed as

### Story 3.2: Land Use and the Street Network

As a player,
I want a district with streets that go somewhere,
So that the city has a shape before it has any buildings in it.

**Acceptance Criteria:**

**Given** generation is multi-pass, coarse to fine
**When** the first pass runs
**Then** it assigns land use across the 512x512 area - residential, commercial, industrial, institutional - and nothing finer

**Given** the second pass consumes the first
**When** the street network is generated
**Then** streets connect all land-use regions and no region is stranded
**And** the network reads as a city's streets rather than as a maze or a perfect grid

**Given** the city is generated as square blocks, which is what makes the Manhattan estimator appropriate later
**When** the network is produced
**Then** block structure is genuinely rectilinear enough for that assumption to hold

**Given** the periphery must read as character rather than as budget
**When** land use is assigned near the district edge
**Then** sparseness there is an intentional output of the rules, not an absence of them

### Story 3.3: Plots and Building Envelopes

As a player,
I want buildings that sit on the street properly,
So that a block reads as a block rather than as scattered boxes.

**Acceptance Criteria:**

**Given** the third pass subdivides land into plots
**When** plots are cut
**Then** each fronts a street and none is landlocked

**Given** building footprints are sized by interior usability rather than street frontage alone
**When** an envelope is placed on a plot
**Then** it is large enough to hold its eventual interior - a shop must fit its counter, its stock and a moving player
**And** an envelope too small for its intended type is rejected rather than shrunk into unusability

**Given** the tileset's own premade interiors run from 14x6 (a condominium flat) to 19x15 (a gym)
**When** envelope sizes are chosen
**Then** they fall in a range consistent with those, averaging around 12x11 cells

**Given** the settled scale baseline expects roughly 894 buildings at 512x512
**When** the district is generated
**Then** the building count lands within a stated tolerance of that figure
**And** a wild deviation fails generation rather than producing a district nobody checked

### Story 3.4: Building Types and Institution Placement

As a player,
I want the depot, the council building and the corner shop to be where such things go,
So that the city's institutions feel sited rather than sprinkled.

**Acceptance Criteria:**

**Given** building type is assigned from the grammar against neighbourhood parameters
**When** a type is chosen for an envelope
**Then** it satisfies coherence rules - no skyscraper among villas

**Given** institutions are generated types under placement constraints rather than hand-placed landmarks
**When** the district is generated
**Then** it contains a depot, a council building, a hospital, a welfare office, shelters, shops and cafes
**And** each satisfies its own placement and distribution constraints

**Given** municipal services are distributed at roughly one per N dwellings, evenly spread
**When** placement runs
**Then** no quadrant of the district is left without the services its dwelling count requires

**Given** the scale baseline expects roughly 344 workplaces
**When** the district is generated
**Then** workplace count lands within tolerance
**And** the professions those workplaces support number around 69, consistent with the labour-market depth the design needs

### Story 3.5: Interior Layout

As a player,
I want to open a door and find a room that makes sense,
So that a hundred interiors are a hundred places rather than a hundred boxes.

**Acceptance Criteria:**

**Given** interiors live in the same tilemap at their building's footprint
**When** an interior is generated
**Then** it occupies the building's own cells and no separate space is created

**Given** the room grammar and its requirement constraints
**When** an interior is laid out
**Then** every dwelling has a door, every room has a light, and every business has stock space
**And** a layout violating any requirement is regenerated or rejected, never emitted

**Given** the MVP target is 100+ enterable interiors
**When** the district is generated
**Then** at least 100 buildings are enterable and furnished
**And** the enterable set spans dwellings, shops, cafes and institutional back rooms rather than being all of one kind

**Given** cells carry a building/room ownership id
**When** interiors are emitted
**Then** every interior cell carries the id its enclosure culling and wall retraction depend on

### Story 3.6: Prop Placement

As a player,
I want rooms and streets with things in them,
So that the city has texture rather than only geometry.

**Acceptance Criteria:**

**Given** the final pass places props against the definitions from Epic 2
**When** props are placed
**Then** each is one row at its anchor cell and its extent comes from `object_def`

**Given** the generator composites footprints into a per-district collision map once per seed
**When** placement completes
**Then** the collision map is cached
**And** nothing infers collision at spawn time or at runtime

**Given** a placed prop must not block what it should not block
**When** the district is generated
**Then** the doorway-gap invariant from Epic 2 holds everywhere
**And** the reachability invariant reports no walkable region enclosed without a door

### Story 3.7: Neighbourhood Character

As a player,
I want to know I have walked into a different neighbourhood without being told,
So that the district has places in it rather than being uniformly itself.

**Acceptance Criteria:**

**Given** nothing is hand-placed, so character must come from generator parameters
**When** neighbourhoods are parameterised
**Then** density, building age, affluence and land-use mix are the four dials
**And** no fifth mechanism is introduced to make a neighbourhood feel different

**Given** a player walks from one neighbourhood into another
**When** they cross the boundary
**Then** the change is legible from the buildings, their state, the shop types and the crowding, without any label

**Given** these same parameters must later make the gentrification loop legible
**When** they are implemented
**Then** physical state, desirability and land use are readable quantities rather than opaque generator internals

**Given** local density is the constraint that makes a street read as busy
**When** density is parameterised
**Then** a commercial core supports the citizen density a busy screen requires, and a residential edge supports far less

### Story 3.8: The Walkability Grid

As a developer,
I want a tile-level truth about where a body can stand,
So that routing and collision are both derived from one place.

**Acceptance Criteria:**

**Given** the walkability grid is per floor and derived from object footprints
**When** the district is generated
**Then** one grid exists per floor and is materialised as a generation output

**Given** the grid is server-side and used to build and repair the macro graph
**When** it is produced
**Then** the client receives derived walkability for its own collision and steering, not the grid's authoring form

**Given** a structural change occurs later (a welded door, a road closure)
**When** it happens
**Then** the grid is patched rather than regenerated

### Story 3.9: The Macro Routing Graph

As a developer,
I want a graph whose edges are priced in minutes,
So that the commute tax, agent routing and the transport ladder are one system rather than three.

**Acceptance Criteria:**

**Given** the macro graph is emitted as a generation output into SpacetimeDB tables
**When** the 512x512 district is generated
**Then** the graph is of the order of a few thousand nodes and roughly ten thousand edges

**Given** nodes are transit points, sources and portals
**When** the graph is built
**Then** each carries floor and position, and source nodes carry a business id

**Given** edge cost is denominated in minutes, the game's only currency
**When** an edge is created
**Then** its cost is in minutes and no second distance unit exists anywhere in the graph

**Given** interiors would balloon the graph for no routing benefit
**When** a building is added
**Then** it collapses to an entrance node, plus an internal node only if it is large

**Given** portal edges are the only edges crossing floors
**When** the graph is validated
**Then** every edge whose endpoints differ in floor is a portal, and this is asserted rather than assumed

**Given** the graph lives in tables rather than module globals
**When** a reducer aborts after modifying it
**Then** the graph rolls back with the transaction
**And** it survives restart and republish without rebuilding

### Story 3.10: Provisions

As a developer,
I want the routing graph to also answer "what is near me that provides food",
So that one index serves both movement and choice.

**Acceptance Criteria:**

**Given** source nodes advertise provisions
**When** a provision query runs
**Then** it is a spatial lookup over the same structure routing uses

**Given** a venue may provide several things - a cafe is both Food and Social
**When** provisions are stored
**Then** they are rows in a separate table rather than a column
**And** one venue can satisfy two different needs

**Given** provisions carry a quality value
**When** a source is created
**Then** quality is set from the building type and neighbourhood affluence

**Given** source nodes join to business identity
**When** a provision is queried
**Then** the business id is available on the result, so "do I know this place" is a lookup on a key already in hand

### Story 3.11: The Distance Estimator

As a developer,
I want a cheap origin-independent distance in minutes,
So that scoring many candidate destinations never runs a pathfind.

**Acceptance Criteria:**

**Given** distance is Manhattan, computed fresh, converted to minutes
**When** an estimate is requested
**Then** it is `manhattan_cells x minutes_per_cell(transport_mode) + floor_change_penalty`
**And** no cached distance is stored anywhere

**Given** the city is generated as square blocks
**When** Manhattan is compared against Euclidean over real generated geometry
**Then** Manhattan is the closer estimate, confirming the choice rather than assuming it

**Given** the estimator is denominated in minutes and parameterised by transport mode
**When** a faster mode is supplied
**Then** the estimate falls proportionally, so the transport ladder acts on scoring without a special case

**Given** the estimator lives in pure code with no table access
**When** it is tested
**Then** thousands of cases run in CI with no database

**Given** Manhattan ignores rivers, rail cuttings and closed parks
**When** the estimate is optimistic in such a place
**Then** this is accepted as a person misjudging a route, and a per-region correction factor remains available but unused

### Story 3.12: Pathfinding

As a developer,
I want one A* run after a destination is chosen rather than during the choice,
So that pathfinding cost scales with decisions taken rather than with options considered.

**Acceptance Criteria:**

**Given** scoring is arithmetic over candidates and pathfinding happens once, afterwards
**When** a destination is selected
**Then** exactly one A* runs, over the macro graph, for that destination only

**Given** A* returns a route
**When** the route is stored
**Then** it carries the information needed to derive a position at any time within it

**Given** the client never sees the macro graph
**When** subscriptions are scoped
**Then** no macro graph table is client-visible
**And** the client's only routing input is a chosen route delivered in an agent's state

**Given** A* must be deterministic
**When** two runs are made over the same graph with the same endpoints
**Then** they return the identical path, because collections are ordered and no unordered iteration influences the result

### Story 3.13: Determinism and Rule-Set Versioning

As a developer,
I want the same seed to produce the same city forever,
So that the world can be extended in two years without contradicting itself.

**Acceptance Criteria:**

**Given** determinism breaks from floating-point drift across toolchains, unordered map iteration and RNG changes under dependency bumps
**When** the generator is written
**Then** it uses integer or fixed-point arithmetic, ordered collections and a pinned RNG throughout
**And** any introduction of a float into the generation path fails review

**Given** the city records the rule-set version it was generated under
**When** rules change afterwards
**Then** the existing city is not regenerated
**And** the recorded version remains readable for the life of the world

**Given** the city is generated once and persisted rather than re-rolled
**When** the server restarts
**Then** the world is loaded, not regenerated

**Given** new neighbourhoods later run under the current rules
**When** the district is extended in future
**Then** visible difference between old and new areas is expected and welcome, not a defect

### Story 3.14: The Determinism Harness

As a developer,
I want a test that regenerates from seed and diffs the result,
So that a determinism regression is caught by CI rather than by a player.

**Acceptance Criteria:**

**Given** the harness regenerates a district from a fixed seed and rule-set version
**When** it compares against a stored reference
**Then** any difference is reported with the first divergent cell or node named

**Given** determinism must survive dependency bumps
**When** a dependency changes
**Then** the harness runs and fails loudly if generation output moved

**Given** the harness serves R3
**When** it is built
**Then** it covers geometry, the collision map and the nav graph, not geometry alone

**Given** debug tooling registers with Epic 1's framework
**When** the harness is invoked interactively
**Then** it reports through that framework rather than through its own surface

### Story 3.15: The Nav Graph Patch Format

As a developer,
I want the patch log's shape decided before anything writes to it,
So that a permanent schema decision is not made by accident under time pressure.

**Acceptance Criteria:**

**Given** primary keys and scheduling status cannot be changed after the first commit
**When** the patch log is defined
**Then** its schema is final in this story, even though patches are not applied until later epics

**Given** the city must be reproducible from seed plus patch history
**When** a patch is recorded
**Then** it carries enough to replay the structural change deterministically

**Given** determinism wants a replayable history and state growth wants the log compacted, and these pull opposite ways
**When** this story completes
**Then** a decision is taken and recorded - periodic re-baselining (snapshot the graph, truncate the log) is the expected shape, but the decision is made deliberately rather than by default
**And** the table declares its bound, as every accreting table must

**Given** patches are applied by later epics rather than this one
**When** this story completes
**Then** the format and the log exist and are empty
**And** nothing in this epic writes a patch

### Story 3.16: Walk the District

As a player,
I want to walk out of my door and across a whole generated city,
So that everything this epic produced is proven by being lived in rather than by passing a test.

**Acceptance Criteria:**

**Given** a 512x512 district generated from a seed
**When** a player walks from one edge toward the core
**Then** the traverse takes roughly 233 real seconds on foot, consistent with the settled walking speed

**Given** the district is walked end to end
**When** the player enters buildings along the way
**Then** at least 100 are enterable, furnished, and correctly wall-retracted on entry

**Given** neighbourhood parameters differ across the district
**When** the player crosses between neighbourhoods
**Then** the difference is legible without being labelled

**Given** the hand-laid test street from Epic 1 was explicitly disposable
**When** this story completes
**Then** it is deleted rather than kept alongside the generated world

**Given** this is the epic where A5 either holds or does not
**When** the district is walked
**Then** an honest judgement is recorded on whether the rules produce streets worth walking
**And** if they do not, that finding reopens the rule content rather than being absorbed as acceptable

---

## Epic 4: The Living Wire

Two people stand in the same city in under a second, and the city keeps its own time whether or not anybody is connected.

**This epic carries A4, the hardest technical constraint in the project.** The one-second boot is what enforces the design thesis - a place you drop into rather than a session you commit to - and D6's design for it is explicitly arithmetic rather than evidence. Story 1.14 measured a test street; this epic must hold the target against a real city, real identity and a real subscription.

**It also closes open gap G4**, the in-city clock's authority, which the architecture left undecided.

**Note on scope.** The `actor_location` table built here is shared by players and citizens. Only the player kind is populated in this epic; Epic 5 populates the other without altering the table, which matters because the schema is permanent.

### Story 4.1: The In-City Clock

As a player,
I want the city to have its own time that runs whether or not I am watching,
So that logging in is arriving somewhere rather than starting something.

**Acceptance Criteria:**

**Given** one in-city day is 60 real minutes and one in-city hour is 2.5 real minutes
**When** the clock is read
**Then** the conversion holds exactly, and the constant lives in one place with a generated client mirror

**Given** the clock is detached from real-world time
**When** a player logs in at the same real hour every day for a week
**Then** they arrive at a different in-city hour each time, rotating through the full day across the week

**Given** open gap G4 asks how time is computed, who reads it, and whether clients derive it
**When** this story completes
**Then** the decision is taken and recorded: the server holds the authoritative epoch, and clients derive current in-city time from it arithmetically rather than being told
**And** no per-tick time broadcast exists

**Given** a client's wall clock is wrong or drifts
**When** it derives in-city time
**Then** it reconciles against the server's epoch on connect and periodically thereafter
**And** a skewed client is corrected rather than trusted

**Given** the clock advances continuously with zero clients connected
**When** the server runs unattended overnight
**Then** in-city time has advanced by exactly the elapsed real time converted at the fixed rate

### Story 4.2: The Authoritative Loop

As a player,
I want the city to keep running when I close the tab,
So that causality is real rather than a fiction maintained while I watch.

**Acceptance Criteria:**

**Given** the city always ticks and spinning down when empty was considered and rejected
**When** no client is connected
**Then** scheduled reducers continue to fire and the world continues to advance

**Given** the server performs no per-frame work
**When** the loop is profiled with clients connected
**Then** no reducer runs at frame rate
**And** player movement consumes no server tick budget

**Given** reducers are transactional
**When** a reducer returns an error
**Then** the transaction aborts cleanly and no partial state is written
**And** the reducer did not panic

**Given** the world cannot be regenerated
**When** any reducer encounters an inconsistent state
**Then** aborting is chosen over writing through

**Given** Story 1.3 measured scheduled-reducer timing fidelity
**When** the loop depends on that timing
**Then** it operates within the drift the spike actually measured, not within the drift the design assumed

### Story 4.3: Chunks and Interest Management

As a player,
I want to receive the part of the city I am in rather than all of it,
So that a district of a quarter of a million cells fits down a domestic connection.

**Acceptance Criteria:**

**Given** subscription queries are the interest-management mechanism
**When** a client connects
**Then** it subscribes to a bounded region around its character rather than to whole tables

**Given** `actor_location` is keyed on chunk and shared by players and citizens
**When** it is created
**Then** it carries actor id, actor kind, chunk and floor
**And** the citizen kind is unpopulated in this epic but requires no schema change to populate later

**Given** a derived value cannot be subscribed to
**When** the chunk column is justified
**Then** the justification is recorded: it exists solely so that a chunk filter is expressible as a subscription
**And** a comment states that no x or y is to be added to this table for consistency

**Given** the player moves across a chunk boundary
**When** the crossing happens
**Then** the subscription updates and the new region arrives before the player reaches its edge

**Given** the body zone extends past the viewport with hysteresis on despawn
**When** the player walks toward a boundary
**Then** content is present before it is visible, and leaves lazily rather than at the edge

**Given** high-frequency player writes must not wake citizen subscribers
**When** tables are organised
**Then** they are split by access frequency rather than by the entity they describe

### Story 4.4: Player Position

As a player,
I want other people to see me move smoothly,
So that we are plainly in the same place at the same time.

**Acceptance Criteria:**

**Given** a player's position exists only in a human's head and can be computed by nobody else
**When** it is handled
**Then** it is transmitted, unlike a citizen's position which is derived

**Given** position is one row per player overwritten in place
**When** the player moves
**Then** no event table and no separate durable channel is used
**And** the same row serves as the hot rendering channel and as the durable state that reconnection and handover read

**Given** the update rate starts at 10 Hz
**When** another client renders that player
**Then** it interpolates between updates and the motion reads as smooth

**Given** ten concurrent players at 20 Hz would generate more transactions than twenty thousand citizens living
**When** the rate is chosen
**Then** it is a tunable dial, and the reasoning that player movement scales with concurrency while L2 scales with population is recorded beside it

### Story 4.5: Identity

As a player,
I want to be the same person when I come back tomorrow,
So that months of a life are not one cleared cache away from gone.

**Acceptance Criteria:**

**Given** identity is anonymous-first and issued during the WebSocket handshake
**When** a new player connects
**Then** the identity token is delivered, stored in `localStorage`, and re-presented on the next connect
**And** the common path costs zero extra round trips

**Given** the character-to-identity mapping table was created in Story 1.2 with a one-to-N shape
**When** a character is created
**Then** it is linked to the issuing identity through that table rather than by holding an identity column

**Given** an OIDC identity derived from issuer and subject produces a second, different identity
**When** a player later links an account
**Then** the new identity is added to the existing character's set and the character is unchanged
**And** signing in with either identity reaches the same character

**Given** clearing browser data orphans an unlinked character permanently, in a game with no wipes
**When** the player reaches a natural moment
**Then** they are prompted to link
**And** the prompt is framed diegetically - registering with the council, being issued papers - rather than as an account-security dialog

**Given** the player declines to link
**When** they continue playing
**Then** nothing is withheld and the prompt does not repeat aggressively

### Story 4.6: First Boot

As a new player,
I want to be standing in the city about a second after I decide to be,
So that arriving costs nothing.

**Acceptance Criteria:**

**Given** the name prompt is inline DOM in the HTML shell
**When** the page is opened for the first time
**Then** the prompt is interactive at first paint, around 50-150 ms, with zero game assets loaded

**Given** the full payload streams while the player types
**When** they submit their name
**Then** the remaining critical path is short because loading overlapped with typing

**Given** the player is controllable within one second of submitting
**When** the timer is measured from submit to controllable
**Then** it is under one second on a mid-range laptop over a typical domestic connection

**Given** a first-ever spawn in the player's flat interior costs roughly 420 rows against a street screen's roughly 28,000
**When** the first spawn happens
**Then** it is the flat, and the street streams behind the door
**And** this is understood as the loop's own opening beat rather than as a loading trick

**Given** rendered content is on the critical path rather than cover for it
**When** the player arrives
**Then** there is no arrival sequence, no splash and no character creation ceremony

### Story 4.7: Returning

As a returning player,
I want to arrive where my life actually is,
So that closing the tab was not a decision.

**Acceptance Criteria:**

**Given** the identity token is in `localStorage`
**When** a returning player opens the page
**Then** no prompt is shown and navigation to controllable completes in under one second

**Given** the return path is dominated by the initial tilemap subscription
**When** boot is optimised
**Then** the primary lever applied is subscription scope, not asset size
**And** if profiling shows decode dominating, D4's chunking migration is opened rather than worked around

**Given** the spawn is wherever cause and elapsed time put the character
**When** the player returns
**Then** they are at that position, not at a save point and not at a default

**Given** atlases and the bundle are immutable and content-hashed
**When** a returning player loads
**Then** the service worker serves them from cache without a network round trip

### Story 4.8: Reconnection Without a Seam

As a player,
I want a dropped connection to be an interruption to me and not to the city,
So that nothing needs resuming because nothing was suspended.

**Acceptance Criteria:**

**Given** nothing is suspended when a client disconnects
**When** the client reconnects
**Then** there is no resume step, because the world never paused

**Given** the character continues to exist while the player is away
**When** they reconnect after any interval
**Then** their position is consistent with cause and elapsed time, every time

**Given** the SDK handles visibility, focus, online and pageshow events with dead-socket rebuild and exponential backoff
**When** a laptop lid is closed and reopened
**Then** the client reconnects without user action
**And** a connection-state notice appeared while it was down

**Given** the world moved while the client was disconnected
**When** the subscription is re-established
**Then** the client's local store is brought current without a full reload

### Story 4.9: Two Players in One City

As a player,
I want to see somebody else walking down the same street,
So that the city is shared rather than merely persistent.

**Acceptance Criteria:**

**Given** two browsers connect to the same district
**When** both players stand in the same chunk
**Then** each sees the other move, with interpolated motion

**Given** they walk apart
**When** one leaves the other's subscription region
**Then** they despawn lazily with hysteresis rather than blinking out at a boundary

**Given** authoritative simulation means a second connected player is close to incrementally free
**When** the second client connects
**Then** no matchmaking, lobby or session mechanism is involved
**And** server cost does not step up materially

**Given** client-authoritative movement permits teleporting and wall-clipping
**When** this is observed
**Then** it is accepted and unmitigated in v1, as recorded, with no plausibility checking added speculatively

### Story 4.10: Time Control

As a developer,
I want to move the clock,
So that debugging a weekly rent cycle does not cost seven real hours.

**Acceptance Criteria:**

**Given** one in-city day is 60 real minutes and rent falls weekly, so a rent cycle at normal speed costs about seven real hours
**When** time control is available
**Then** the clock can be multiplied and jumped forward

**Given** the architecture names this the highest-value tool in the project
**When** it is built
**Then** it is built early rather than deferred, and it works for anything time-dependent rather than only for rent

**Given** jumping the clock must not corrupt state
**When** the clock jumps
**Then** everything scheduled across the skipped interval resolves correctly rather than being silently dropped
**And** a jump that would drop scheduled work fails rather than proceeding

**Given** debug tooling is gated behind a flag not exposed in production
**When** the flag is off
**Then** the clock cannot be altered by any input

### Story 4.11: Live Migration Policy

As a developer,
I want changing the schema on a running world to be routine,
So that a multi-year build is not a sequence of emergencies.

**Acceptance Criteria:**

**Given** the world never resets, so every schema change is a live migration
**When** a change is needed
**Then** the standard workflow is incremental and lazy: a new table with the desired schema, the module reading new-first with fallback to old, backfill on access, and the old table eventually emptied rather than dropped

**Given** automigration forbids removing tables, retyping, renaming and reordering
**When** a change would require one of those
**Then** it is achieved by the new-table-plus-read-through path instead

**Given** backing up before every migration is non-negotiable
**When** a migration is run
**Then** the export from Story 1.4 has been taken and verified first
**And** a migration attempted without one is refused by the procedure

**Given** non-updated clients cannot see new tables
**When** the schema moves
**Then** the `defs_version` handshake detects the mismatch at connect and the client refreshes

### Story 4.12: Table Bounds and the Metrics Sampler

As a developer,
I want every accreting table to declare how it is bounded,
So that a world running for years does not fill up by accident.

**Acceptance Criteria:**

**Given** every table declares a bound that is either game-mechanical or an engineering ceiling
**When** a table exists without one
**Then** it is treated as a bug and caught in the review gate from Story 0.3

**Given** the declaration is a monitoring input rather than documentation
**When** a bound is declared
**Then** it is machine-readable, carrying bound kind, expected magnitude and alert threshold

**Given** a scheduled reducer samples per-table row counts and bytes on a slow cadence
**When** it runs hourly
**Then** the samples land in a metrics table
**And** the sampler's own table declares its bound like any other

**Given** the storage budget is a hard wall around 40 GB with a review trigger at 10 GB and a launch estimate near 200 MB
**When** sampling runs
**Then** total storage is tracked against both figures

### Story 4.13: The Watcher

As a developer,
I want to be told when something is drifting,
So that a declared bound is not merely a comment.

**Acceptance Criteria:**

**Given** reducers are sandboxed and transactional, so outbound notification is not their job
**When** alerting is built
**Then** it lives in an external process subscribing to the metrics table

**Given** a declared threshold is exceeded, or total storage crosses the review trigger
**When** the watcher notices
**Then** it alerts, naming the table and the figure

**Given** the watcher may itself die
**When** it does
**Then** the city keeps ticking and only alerting is lost
**And** this risk profile is explicitly different from an in-line dependency, which is why an external process is acceptable here after the Ghost Crew was rejected

**Given** one pipeline serves several purposes
**When** the watcher is built
**Then** it covers table growth, cost per reducer class, the gameplay metrics and the outstanding benchmarks, rather than one system per concern

**Given** cost per reducer class must be instrumented from day one
**When** reducers run
**Then** their cost is attributed by class, so scaling decisions rest on measurement rather than on published conversions

### Story 4.14: The Gameplay Metric Definitions

As the solo developer,
I want the five metrics defined precisely enough to implement,
So that the questions the design rests on are answerable rather than merely asked.

**Acceptance Criteria:**

**Given** the GDD states five gameplay metrics as questions rather than as measurements
**When** this story completes
**Then** each has a precise definition, an emission point and a unit: voluntary time in the discretionary middle, perceived aliveness at one connected player, return rate after absence, minute-spend split between qualification and lateral pursuit, and unprompted noticing

**Given** each metric is emitted by the epic that creates the behaviour it measures
**When** the definitions are written
**Then** each names the epic that will emit it
**And** the registration mechanism exists here so that later epics add a metric without adding a pipeline

**Given** unprompted noticing is named as the metric that matters most and is hardest to instrument
**When** its definition is written
**Then** it states honestly how it will be captured and what that proxy cannot see
**And** if it is only answerable by asking players, that is recorded as the method rather than left as an aspiration

**Given** metrics measurable in this epic exist now
**When** the pipeline is stood up
**Then** boot time, concurrent players and reconnection continuity are emitted immediately, proving the path end to end

**Given** adjectives are not metrics
**When** any metric is defined
**Then** it resolves to a number or a proportion

### Story 4.15: Spike - Position Write Rate Against Smoothness

As a developer,
I want to know the lowest position update rate that still looks right,
So that the term which scales with concurrency is set by measurement.

**Acceptance Criteria:**

**Given** the rate starts at 10 Hz and is absorbed by interpolation on receiving clients
**When** rates from 5 to 20 Hz are compared
**Then** perceived smoothness is assessed at each and the lowest acceptable rate is recorded

**Given** player movement scales with concurrency far more steeply per capita than L2 scales with population
**When** the spike concludes
**Then** the transaction cost of the chosen rate is reported at the launch concurrency target

**Given** the finding may argue for a rate other than 10 Hz
**When** it does
**Then** the dial is changed and the reasoning recorded against D9b

---

### Story 4.16: The Page and the Session

As a player,
I want the browser to behave the way a browser should,
So that the city is a page I can leave and come back to rather than an application I have to manage.

**Acceptance Criteria:**

**Given** the name prompt is interactive at first paint while the payload streams behind it
**When** the page is loading
**Then** the prompt is the page
**And** there is no loading screen, no spinner and no progress bar, because the boot design removed the thing they would report on

**Given** the city is a place rather than an app
**When** the tab is rendered
**Then** the page title and favicon name the city, so a player finds it among their other tabs

**Given** a character body has exactly one driver
**When** the same character is opened in a second tab
**Then** the most recent tab holds the character
**And** the earlier tab is told in plain language that the character is being driven elsewhere and is not controllable
**And** it does not close itself, error, or fight for control

**Given** nothing is ever suspended
**When** the player refreshes the browser
**Then** it behaves as a reconnection rather than a restart, with no re-prompt and no lost state

**Given** the player leaves using the back button
**When** they go
**Then** the city keeps running and no warning dialog is shown, because that is the design's central promise rather than an accident

**Given** the procedure state machine is server-authoritative
**When** the connection drops mid-procedure
**Then** a connection-state notice appears
**And** the machine snaps to its current step boundary, so the shift is not lost
**And** the player resumes at that step on reconnection

---

## Epic 5: Citizens

The city feels populated with one player connected. This epic answers the AI-density hypothesis, which the brief names as the project's real engineering risk - harder than multiplayer.

**Build order is L3 then L2 then a population**, which is the reverse of runtime dependency and is deliberate: one NPC walks convincingly, then it gets a day, then a city of them has a labour market. Story 5.4 is a falsification gate placed before anything depends on its answer.

**The rule that shapes everything here:** every citizen advances identically, at transitions only, via a scheduled table. **Nobody ticks.** Cost varies because bodies exist only where someone is looking, not because simulation runs at different fidelities. There is no variable-resolution subsystem to build.

**The failure this epic must not commit** is the one the architecture names as most likely and most damaging: a reducer that detects a condition and acts on it with no citizen in between. Every state change here has an author.

### Story 5.1: One NPC Walks

As a player,
I want to watch one person walk down a street and believe it,
So that everything built on top of this has a foundation worth building on.

**Acceptance Criteria:**

**Given** L3 runs client-side and drives steering, gait and micro pathing for instantiated bodies only
**When** an NPC is given a route and a departure and arrival time
**Then** it walks the route, arriving at the stated time, at a pace that reads as walking rather than as interpolation

**Given** micro pathing is tile-level within one street segment or room
**When** the NPC crosses a segment
**Then** it paths around static obstacles using the derived walkability the client already holds

**Given** L3 may never write to the ledger
**When** the NPC is simulated
**Then** no client-side micro state reaches the server
**And** on despawn, state snaps to the ledger rather than being merged into it

**Given** NPCs route rather than collide
**When** an NPC encounters a solid object
**Then** its path avoided the object rather than its body colliding with it
**And** no sub-tile collision is performed for any NPC, on either side

**Given** the player watches the NPC for a minute
**When** they follow it
**Then** it does not jitter, stall at corners, or arrive early and wait conspicuously

### Story 5.2: Avoidance and Flavour, Bounded to What Nobody Checks

As a player,
I want people to step around each other and do small idle things,
So that a street reads as inhabited rather than as a set of moving markers.

**Acceptance Criteria:**

**Given** every client simulates L3 for the NPCs in its own bubble, with no ownership and no handoff
**When** two clients both observe the same region
**Then** both agree on gross position and current activity, because those derive from replicated L2 state

**Given** local avoidance is the one genuinely divergent element
**When** avoidance is implemented
**Then** it is scoped to a fixed tile region rather than to the viewer's bubble, so any two clients covering that region agree by construction

**Given** anything the client computes that must agree across clients is seeded from stable ids
**When** flavour behaviour is triggered
**Then** it is seeded from the NPC id and a tick bucket, never from local randomness
**And** a property test asserts two derivations from identical inputs match

**Given** the governing principle is that L2 defines what everyone must agree on and L3 defines what nobody checks
**When** a divergence is found
**Then** it is confirmed to be in the second category, or it is a defect

**Given** unseeded randomness silently voids the bargain that justified client-side simulation
**When** any randomness is introduced into L3
**Then** the review gate rejects it unless it is seeded from a stable id

### Story 5.3: Body Instantiation and Despawn

As a player,
I want people to walk into view rather than appear,
So that the seam between what is simulated and what is drawn is never visible.

**Acceptance Criteria:**

**Given** there is no simulation zone and only bodies have a zone
**When** a citizen is far from every player
**Then** it has no body and costs no client anything, while its L2 continues to advance normally

**Given** the body zone extends past the viewport with hysteresis on despawn
**When** the player walks toward a citizen's position
**Then** the citizen's body is instantiated before it is visible, and it walks into view
**And** leaving the area despawns it lazily rather than at the viewport edge

**Given** a citizen crossing a chunk boundary updates its chunk column
**When** it crosses
**Then** the update is a wake-up on a table that already exists, with no second presence table to maintain

**Given** each chunk crossing raises the L2 event rate
**When** chunk size is chosen
**Then** it is a named dial, and the trade is recorded: larger chunks mean fewer wake-ups but more citizens streamed than needed
**And** the resulting rate is fed to the benchmark in Story 5.18

**Given** appearance is five indices deterministic from citizen id
**When** a body is instantiated
**Then** it looks the same as the last time this or any client saw that citizen

### Story 5.4: Falsification Gate - The L3 Frame Budget

As a developer,
I want to know whether client-side L3 actually fits in a frame,
So that the decision it rests on is overturned now rather than in Epic 11.

**Acceptance Criteria:**

**Given** client-side L3 was chosen on the explicit basis that ~200 agents cost well under 2 ms per frame, and that this was unverified
**When** ~200 NPCs are instantiated in one bubble
**Then** the per-frame cost of L3 is measured and reported

**Given** the principal risk was named as garbage-collection pressure rather than throughput
**When** the measurement runs
**Then** it reports allocation behaviour over a sustained session, not only average frame cost

**Given** the alternative was rejected because assigned ownership costs roughly 400 times more egress
**When** the budget is exceeded
**Then** the finding reopens D-L3 with that cost comparison in hand, rather than being absorbed by reducing agent counts
**And** no later epic proceeds on the assumption until the decision is settled

**Given** divergence may prove visible even within budget
**When** two clients observe the same busy region
**Then** any visible disagreement is recorded, and avoidance scoping is tightened if it is

### Story 5.5: Derived Positions

As a developer,
I want a citizen's position to be a function of their state and the time,
So that transmitting it would be sending information the receiver already has.

**Acceptance Criteria:**

**Given** citizens carry no coordinates
**When** a citizen's state is stored
**Then** it is either at a node, or in transit along a route between a departure and an arrival time

**Given** position is derived rather than authored
**When** any client needs a far citizen's position at a given time
**Then** it computes it locally from state the client already holds
**And** no citizen position is transmitted

**Given** a citizen in transit
**When** its position is derived mid-route
**Then** it interpolates along the macro path, and every client computes the same answer

**Given** the distinction is authored versus derived rather than player versus NPC
**When** the schema is reviewed
**Then** player position lives in its own table because it exists nowhere else, and citizen position does not exist as a column at all

### Story 5.6: Region Queries

As a developer,
I want to ask which citizens are in a place at a time,
So that populating a street is a lookup rather than a scan.

**Acceptance Criteria:**

**Given** populating a region is a query rather than a promotion
**When** a region is populated at a time
**Then** the query returns the citizens whose route segments or located activities intersect that region at that time

**Given** cost must scale with occupancy rather than with population
**When** the query runs
**Then** it is a range lookup over an index on macro edge and time interval, not a scan
**And** the cost is measured against a district-scale population to confirm it

**Given** everyone present must have a reason to be present
**When** a citizen is instantiated by this query
**Then** the causality inspector can state why it is there
**And** no body is ever created without such a reason

**Given** extras without ledger presence are prohibited as authored-by-proximity
**When** a street reads as too empty
**Then** the remedy considered is more citizens or higher local density, never unbacked bodies

### Story 5.7: Prefetch Along Intent

As a player,
I want the place I am travelling to be ready when I arrive,
So that arriving somewhere is not a pause.

**Acceptance Criteria:**

**Given** subscriptions prefetch along intent rather than position
**When** the player boards transit with a known destination and arrival time
**Then** the destination region is subscribed during transit rather than on arrival

**Given** the subway is the canonical case
**When** the player travels underground
**Then** the destination street is warm before they climb the steps

**Given** prefetch lead distance is a simulation dial
**When** it is set
**Then** it is a balance parameter in a table rather than a compiled constant

### Story 5.8: The Alarm Clock

As a developer,
I want citizens advanced by the platform's own scheduler,
So that a citizen cannot silently stop living.

**Acceptance Criteria:**

**Given** scheduled tables fire one reducer invocation per due row and delete the row after firing
**When** a citizen reaches a transition
**Then** exactly one invocation advances it, and the next transition is scheduled within the same transaction that decided it

**Given** scheduling is transactional with the state change
**When** a transition's transaction aborts
**Then** neither the state change nor the schedule survives, and the citizen is not left unscheduled

**Given** the Alarm Clock was chosen over an interval sweep because it cannot desynchronise
**When** the mechanism is built
**Then** no citizen depends on a next-due column that could go stale
**And** the alternative remains reachable additively, since the scheduled table exists from day one

**Given** Story 1.3 measured actual scheduled-reducer drift
**When** transitions are scheduled
**Then** they operate within that measured drift
**And** if the drift makes arrival times visibly wrong, this is escalated rather than compensated for

**Given** load is spiky with city rhythms
**When** shift start times are assigned
**Then** they are staggered, which the city needs to look right anyway

### Story 5.9: The Calendar

As a player,
I want people to have somewhere they have to be,
So that rush hour happens because of obligations rather than because a scheduler said so.

**Acceptance Criteria:**

**Given** obligations are a calendar and are data rather than AI
**When** a citizen holds a job, a club fixture or a standing commitment
**Then** those occupy fixed blocks and are not scored against alternatives

**Given** a citizen's day mirrors the player's day budget exactly
**When** the calendar is populated
**Then** sleep and work form a skeleton and the remainder is discretionary
**And** the same structure serves citizen and player

**Given** an eight-hour shift is not a choice for the player
**When** a citizen's shift begins
**Then** it is not a choice for them either

### Story 5.10: Utility in the Gaps

As a player,
I want the cafe to have people in it because they chose to be there,
So that the city's aliveness survives the Truth Test.

**Acceptance Criteria:**

**Given** own-time is filled by utility scoring rather than by a coordinator
**When** a citizen reaches a discretionary decision point
**Then** it scores its options and acts, with no knowledge that anyone is watching

**Given** a coordinator starting citizens on leisure activities near a player would be authoring by proximity
**When** discretionary decisions are made
**Then** they are made in L2 with no access to player state whatsoever

**Given** the evaluator uses four or five bars plus habit
**When** bars are defined
**Then** they are money, rest, hunger, social and pursuit drive, and the count is kept small because every bar multiplies a tuning surface spanning dozens of professions

**Given** utility is a function of quality, distance in minutes and habit strength
**When** a citizen chooses where to eat
**Then** the local cafe tends to win on cost in minutes, and habit makes the choice stick
**And** no stored per-citizen taste exists, because dispersion comes from the function

**Given** a plan is a chain and chains reintroduce invalidation
**When** a decision is made
**Then** it has a one-step horizon, with no committed sequence and therefore no future to invalidate

**Given** a fallback action provides a utility floor
**When** every option scores at or near zero
**Then** the citizen goes home rather than stalling

**Given** scoring is pure and takes no table access
**When** it is tested
**Then** thousands of citizen-weeks run in CI with no database

### Story 5.11: Traits

As a player,
I want people to differ in how they behave rather than in what they are,
So that a favour, a stickler and a chancer emerge without being authored.

**Acceptance Criteria:**

**Given** every citizen has traits, not only deciders
**When** a citizen is created
**Then** it carries caution, ambition, diligence, sociability and frugality

**Given** traits are weights in the same evaluator that scores an evening and an inbox
**When** they are applied
**Then** no decider-specific decision machinery exists

**Given** diligence does double duty
**When** it is used
**Then** it drives both self-imposed standards - the lobby nobody asked you to clean - and a finance officer's thoroughness, from one number

### Story 5.12: Citizen Memory and Belief

As a player,
I want to watch people learn that the cafe is shut,
So that knowledge spreading is something I can see happen.

**Acceptance Criteria:**

**Given** a row exists only where a citizen's knowledge diverges from the public default
**When** a citizen knows nothing special about a place
**Then** no row exists and the public default is used

**Given** memory is keyed on the business rather than the location
**When** a business closes and a new tenant opens
**Then** the new tenant does not inherit stale knowledge

**Given** known state is written on surprise only
**When** a citizen walks to a cafe believing it open and finds it shut
**Then** they observe, a row is written, and they re-decide on the spot with that row in scope
**And** the failed option now scores zero for that citizen specifically

**Given** memory is self-cleaning
**When** reality returns to the default and the citizen observes it
**Then** the row is deleted, with no decay timer and no expiry sweep

**Given** knowledge needs a physical carrier and nothing is broadcast
**When** information should travel
**Then** it travels through a sign, a colleague at handover, or a council notice
**And** a property test asserts no memory row is written except by an observation or interaction at a defined location and time

**Given** the table is bounded by an LRU cap of roughly fifty places per citizen and a fan-out delete when a business dies
**When** either bound is reached
**Then** it applies without a background sweep
**And** forgetting is understood as design-correct, because it produces re-discovery

**Given** externally visible state is observed on passing rather than on entering
**When** a citizen walks past a shuttered shop
**Then** they learn it is shut without going in

**Given** knowledge diffusion is the design's hardest-to-instrument quality arriving as a side effect
**When** a shop closes unexpectedly
**Then** many citizens are seen arriving and turning away on the first day, and almost none by the tenth
**And** the whole curve is legible from a bench across the road

### Story 5.13: Routes as Belief

As a player,
I want somebody to walk into a closed road and turn around,
So that the city's friction is visible rather than administrative.

**Acceptance Criteria:**

**Given** a cached commute route is itself a belief
**When** a citizen mid-commute meets a newly blocked edge
**Then** they re-route on the spot and overwrite their cached route

**Given** a citizen computing a fresh route uses the patched graph
**When** they set off after the change
**Then** they never walk into the barrier at all

**Given** roadworks are publicly announced through barriers, diversion signs and council notices
**When** a fresh route legitimately knows about a closure
**Then** this is a different case from a burnt cafe, not an exception to the carrier law

**Given** there is no route invalidation machinery
**When** the graph is patched
**Then** no edge-to-routes index, fan-out invalidation or propagation exists anywhere
**And** citizen memory holds no distance and no nav entries

**Given** commute routes are cached on the citizen
**When** a job or a flat is assigned
**Then** the route is computed once and recomputed only on disturbance

### Story 5.14: A Citizen Has a Life

As a player,
I want the person behind the counter to have a home to go to,
So that the city is made of people rather than of posts.

**Acceptance Criteria:**

**Given** every citizen has a home, a job, a schedule and ends of their own
**When** the district is populated to roughly 5,000 citizens
**Then** each has a dwelling, most have an occupation, and all have a daily structure

**Given** citizens require stable preferences and habits rather than decoration
**When** a citizen chooses repeatedly
**Then** habit strength grows on repetition and makes their choices recognisable over time

**Given** recognisability depends on meeting the same person repeatedly
**When** a player uses the same cafe across several in-city days
**Then** the same barista is behind the counter, looking the same
**And** the geographic social graph emerges from schedules and routes rather than from a system built for it

**Given** occupation is visible through the outfit layer
**When** a player looks down a street
**Then** they can read its labour composition by sight

**Given** habit writes occur inside the transition transaction that was already firing
**When** habits update
**Then** they are extra row writes rather than extra commits

### Story 5.15: The Own-Time Catalogue

As a developer,
I want NPC own-time and player lateral pursuits to be one catalogue,
So that the cafe has people in it for the same reason the player goes there.

**Acceptance Criteria:**

**Given** NPC own-time and player pursuits are one system
**When** an activity is defined
**Then** it is available to both, with no separate NPC-only or player-only activity list

**Given** provisions on nav source nodes are what utility scoring queries
**When** a citizen wants food or company
**Then** it queries provisions over the routing graph rather than a bespoke index

**Given** Epic 12 will add three player pursuits
**When** it does
**Then** they enter this catalogue rather than beside it

### Story 5.16: The Labour Market

As a player,
I want unpopular jobs to pay better without anyone deciding they should,
So that the economy balances because people act rather than because it is balanced.

**Acceptance Criteria:**

**Given** there is no city-wide wage
**When** wages are represented
**Then** they are offered wages on job postings, set by individual employers
**And** no aggregate wage value exists anywhere in the schema

**Given** an unfilled post is a matter for its owner
**When** a post stays unfilled
**Then** the employer's response is to raise the offer, bounded by a revenue ceiling
**And** the rate of rise per in-city week of vacancy is a balance parameter in a table

**Given** self-balancing emerges from many employers each responding to local pressure
**When** a profession becomes unpopular
**Then** its wages rise across independent employers with no coordinating actor involved

**Given** citizens change jobs when their own utility crosses a threshold
**When** an employer raises an offer
**Then** nobody is told, and some citizens' job-change utility crosses at their next decision point
**And** no assignment or push occurs

**Given** the settled scale supports roughly 69 professions at five or more employers each
**When** professions are defined
**Then** that is the target rather than the GDD's district-scale figure of around 100
**And** each profession has enough employers for wage competition to be observable

### Story 5.17: The Causality Inspector

As a developer,
I want to ask why a citizen is where they are,
So that the Truth Test is a tool rather than an aspiration.

**Acceptance Criteria:**

**Given** if you cannot answer why, something is wrong by definition
**When** the inspector is pointed at any citizen
**Then** it reports their L2 state, current route, current activity and last decision with its inputs

**Given** the inspector registers with Epic 1's overlay framework
**When** it is used
**Then** it is presented non-diegetically and gated behind the same production flag

**Given** every body must have a genuine reason to be present
**When** the inspector is pointed at any instantiated body
**Then** a reason is returned in every case
**And** a body with no answer is a defect, not a display gap

### Story 5.18: Benchmark - The Real L2 Event Rate

As a developer,
I want the citizen event rate measured with discretionary time and chunk crossings included,
So that A2's cost model rests on a number rather than on a skeleton.

**Acceptance Criteria:**

**Given** the work-only skeleton figure was expected to rise by 50 to 80 per cent once discretionary time is included
**When** the rate is measured at the settled population of roughly 5,000 citizens
**Then** the actual transactions per second is reported, with discretionary decisions and chunk crossings both included

**Given** the launch budget assumes roughly 42 transactions per second and about 108 million calls per month
**When** the measurement is compared against it
**Then** the result either confirms the budget sits inside the hosting allowance or names the overage

**Given** cost per transaction was also outstanding
**When** this benchmark runs
**Then** it reports cost per reducer class through the pipeline built in Story 4.13

**Given** chunk size is the dial on crossing frequency
**When** the rate proves higher than budgeted
**Then** chunk size is tuned and the effect re-measured, rather than the population being quietly reduced

### Story 5.19: The Density Answer

As a player,
I want a street at rush hour to feel busy while I am the only person playing,
So that the city does not depend on an audience it does not have.

**Acceptance Criteria:**

**Given** aliveness is measured per screen rather than per database
**When** a single player stands on an arterial street at rush hour
**Then** roughly twenty people are visible, each with a reason to be there

**Given** density is local by design
**When** the same player walks to a residential street at three in the morning
**Then** it reads as quiet, and the quiet is legibly intentional rather than empty

**Given** the periphery must read as character rather than as budget
**When** the player reaches the district edge
**Then** sparseness there looks deliberate

**Given** the L3 budget was sized for roughly 200 agents in a body zone
**When** the busiest realistic scene is measured
**Then** the actual peak is reported against that headroom

**Given** this epic answers A9, which the addendum names as the real engineering risk
**When** the district is inhabited
**Then** an honest judgement is recorded on whether a solo player would describe this city as populated
**And** if they would not, the finding reopens density, population or local concentration rather than being absorbed as acceptable

---

## Epic 6: Stock, Goods and Money

Things exist in quantities, move only when somebody moves them, and money is a physical object before it is a number.

**This epic is absent from the GDD's breakdown.** The architecture identified it as core, previously unwritten, and load-bearing: it is L1's substrate, so it comes first among the economy systems. It also makes the GDD's "the till runs short of change" **fall out** rather than be special-cased, and it turns logistics from a background system into a job.

**It builds the chain engine.** D14 records that logistics needs no new machinery because it is the institutional chain engine pointed at goods. An order is the engine's first instance; Epic 10 adds institutional templates on top without touching it.

**Recorded risk, to be watched from the first story.** Grid inventories are a known source of tedium, and here the cost is paid in the only currency the game has: minutes spent packing are minutes not spent on a life. The dials are grid sizes and how often a packing decision is forced. Storing your shopping should be a moment; running a warehouse shift should be the job. **If packing becomes the dominant interaction, the design has drifted** - watch it alongside Epic 8's procedure prototyping, since the two will be felt together.

### Story 6.1: Items

As a developer,
I want a defined type for every physical thing that moves,
So that beans, banknotes and bin bags are one system rather than three.

**Acceptance Criteria:**

**Given** items are defined types in `defs/`
**When** an item is defined
**Then** it carries a unit, a perishability and a bulk

**Given** definitions are data rather than code
**When** a new item is needed
**Then** it is a row in `defs/`, not a new type in the module

**Given** item kinds are an extensible set
**When** they are represented
**Then** they are codes with a companion data table rather than an enum, so adding one is an insert rather than a migration

### Story 6.2: Stock and Holders

As a developer,
I want stock to belong to a specific thing in the world,
So that two cafes in a chain are two shops rather than one balance sheet.

**Acceptance Criteria:**

**Given** stock is held by a holder
**When** a holder is identified
**Then** it may be a business instance, a citizen, a vehicle, a building or a municipal facility

**Given** stock sits on the business instance rather than the room or the brand
**When** a chain operates two cafes
**Then** they are two holders with two independent stocks
**And** one running out of beans has no effect on the other

**Given** the settled district holds roughly 344 workplaces
**When** stock is instantiated across them
**Then** the resulting row count is within the table's declared bound

### Story 6.3: Stock Moves Only by Hand

As a player,
I want everything in the city to have been moved there by somebody,
So that the world's contents survive the question of who put them there.

**Acceptance Criteria:**

**Given** stock quantities change only inside a work-procedure step or a consumption event
**When** any quantity changes
**Then** the change occurred inside such a step, and the citizen who performed it is nameable

**Given** if you cannot name the person who did it, it does not happen
**When** a reducer would adjust stock directly
**Then** the review gate rejects it, however well it performs

**Given** this is the physical-carrier law applied to inventory
**When** stock is audited over an in-city week
**Then** every movement traces to a procedure step or a consumption event
**And** a property test asserts no stock write occurs outside those two paths

**Given** a shortfall is not an error
**When** a business runs out of something
**Then** it is content: the procedure branches, and nothing is logged as a failure

### Story 6.4: Recipes

As a developer,
I want conversion to cost labour as well as inputs,
So that making something is work rather than arithmetic.

**Acceptance Criteria:**

**Given** recipes convert input items plus labour minutes into output items
**When** a recipe is defined
**Then** it names its inputs, its outputs and its labour cost in minutes

**Given** labour is denominated in minutes, the game's only currency
**When** a recipe is performed
**Then** it consumes that many minutes of the performing citizen's time

**Given** recipes are data in `defs/`
**When** a new conversion is needed
**Then** it is a row rather than code

### Story 6.5: The Chain Engine

As a developer,
I want durable multi-step workflows that survive restarts and multi-day latency,
So that logistics and institutions run on one mechanism rather than two.

**Acceptance Criteria:**

**Given** a chain is a declared sequence of steps, each performed by an occupation
**When** a chain template is defined
**Then** it is data in `defs/` rather than code

**Given** chains are the one place a committed sequence is kept, because a budget approval genuinely is a multi-step process with in-city days of latency
**When** the engine is built
**Then** it holds committed sequences for chains only
**And** citizen bodies retain their one-step horizon with no committed chain of their own

**Given** a chain may span in-city days
**When** the server restarts or the module is republished mid-chain
**Then** the chain resumes from its current step with no loss

**Given** each step is performed by an existing occupation
**When** a step becomes ready
**Then** it enters the responsible role's work rather than executing itself
**And** no step advances without a citizen performing it

**Given** there are dozens of chains rather than tens of thousands
**When** the engine's cost is assessed
**Then** it is confirmed to be a negligible share of the transaction budget

**Given** Epic 10 will add institutional chain templates
**When** it does
**Then** it adds templates and occupations without modifying this engine
**And** completed chain records roll up to a summary after a stated number of in-city weeks, satisfying the table's declared bound

### Story 6.6: Orders

As a player,
I want the cafe to run out of beans and somebody to go and get more,
So that supply is a thing people do rather than a number that refills.

**Acceptance Criteria:**

**Given** reordering is not special
**When** a procedure step finds stock below its threshold
**Then** it emits an order, and the citizen performing that step is the order's author

**Given** an order is a chain instance
**When** one is placed
**Then** it runs placed, accepted, picked, loaded, in transit, delivered
**And** each step is performed by an existing occupation rather than by new machinery

**Given** the reorder threshold is a balance parameter
**When** it is tuned on a running world
**Then** the change takes effect at the next decision point without a republish

**Given** a chain can stall
**When** a step's occupation is unfilled or its input is unavailable
**Then** the order waits visibly rather than failing
**And** the consequence lands on the business that ordered, which simply has no beans

**Given** logistics becomes a job rather than a background system
**When** a delivery runs
**Then** a citizen drives it, loads it and unloads it

### Story 6.7: The Boundary

As a developer,
I want the only numbers that arrive from nowhere to arrive from outside the city,
So that everything inside it has an author.

**Acceptance Criteria:**

**Given** L1 is the boundary rather than a layer
**When** it is implemented
**Then** it supplies external commodity prices, in-migration and weather, and nothing else

**Given** L1 has no will and does not act on the city
**When** an external price changes
**Then** nothing is told and nothing is assigned
**And** the change reaches citizens only because it alters numbers they were already reading

**Given** L1 must never become a director
**When** it is built
**Then** it has no access to player state whatsoever, and the review gate enforces this
**And** the prohibition is stated in the module so that scope pressure cannot erode it quietly

**Given** the boundary is where simulation bottoms out
**When** a supplier's own stock depletes
**Then** they order from outside the city at an externally set price
**And** this is the only place in the design where a number legitimately arrives from nowhere

**Given** in-migration is modulated by the city's attractiveness to people outside it
**When** the city has jobs and rooms
**Then** more people arrive
**And** this is an aggregate view the outside has of the city, not the city inspecting itself

### Story 6.8: Physical Cash

As a player,
I want the till to run short of change,
So that taking payment is a procedure that can fail rather than a transaction that cannot.

**Acceptance Criteria:**

**Given** physical cash is ordinary stock and denominations are items
**When** a till holds money
**Then** it holds specific denominations in specific quantities

**Given** a customer pays with a large note when the till holds three coins
**When** change is required
**Then** the procedure branches on an inventory failure rather than on a special case
**And** the GDD's "the till runs short of change" required no bespoke mechanism to exist

**Given** cash moves stock in both directions
**When** a cash payment completes
**Then** the customer's cash decreases, the till's increases, and the change moves the other way

**Given** the shop can refuse
**When** change cannot be made
**Then** refusing is an available branch, and it is content rather than an error

**Given** a till is restocked with change by somebody
**When** it runs low
**Then** the remedy is a procedure step or an order, never a top-up by fiat

### Story 6.9: Bank Money

As a player,
I want paying by card to be different from paying in cash,
So that payment method has texture rather than being a formality.

**Acceptance Criteria:**

**Given** bank money is a balance per holder used for evaluation
**When** a citizen assesses whether they can afford something
**Then** they read the balance rather than counting physical cash

**Given** card settles against the account with no cash movement
**When** a card payment completes
**Then** no denomination items move, and the transaction cannot fail for want of change

**Given** physical cash is a rounding error against bank money
**When** the two are compared
**Then** the balance is the meaningful quantity and the cash is the textured one

**Given** wages, rent and recurring costs settle against balances
**When** they fall due
**Then** they move bank money rather than physical cash

### Story 6.10: The Container Grid

As a player,
I want to open a cupboard and see what is actually in it,
So that storage is a real constraint rather than a number.

**Acceptance Criteria:**

**Given** containers hold items on a grid with rotation
**When** a container is opened
**Then** a transient object-bound view is drawn in canvas showing its actual contents at their actual positions

**Given** the canvas may draw transient, object-bound views but never anything persistent, global or abstract
**When** the player walks away
**Then** the view closes
**And** the structural guarantee against a HUD is intact, because a HUD is by definition persistent and global

**Given** item footprints are reused unchanged from the world
**When** an item is placed in a container
**Then** a thing occupying three by two cells in the world occupies three by two in the container
**And** a car does not fit in a cupboard because it genuinely does not

**Given** container grid size lives on the object definition
**When** containers are defined
**Then** a cupboard, a bag, a crate and a pallet each carry their own dimensions

**Given** capacity is spatial rather than numeric
**When** a container is full
**Then** it is full because the shapes do not fit, not because a count was reached

**Given** the tedium risk is real and paid in minutes
**When** grid sizes are set
**Then** storing shopping is a moment rather than a task
**And** the frequency with which packing is forced is recorded as a dial to be watched

### Story 6.11: Two States, No Parent

As a developer,
I want an item to be in exactly one of two places,
So that no third concept accumulates around containment.

**Acceptance Criteria:**

**Given** an item is either placed in the world or held by a container
**When** its state is stored
**Then** it is a cell with a sub-tile offset and a floor, or a holder with a grid position
**And** no parent relationship exists

**Given** an item rests on a table
**When** the table is deleted
**Then** the item stays where it is
**And** this is accepted rather than corrected

**Given** an item in a cupboard never needed a world position
**When** it is stored
**Then** it has none

**Given** discrete items are instances carrying their own state
**When** a prop with state is placed in a container
**Then** its state travels with it

### Story 6.12: Bulk Inside Discrete Containers

As a developer,
I want bulk quantities to live inside things you can pick up,
So that a quantity is always somewhere specific.

**Acceptance Criteria:**

**Given** discrete items are instances and bulk is a quantity held inside a discrete container object
**When** beans are stored
**Then** a sack is an instance occupying its own footprint and holding a quantity

**Given** aggregation is physical
**When** bulk is moved
**Then** the container is moved and the quantity travels with it

**Given** the stock model is correct for bulk and wrong for discrete things that occupy specific cells and carry their own state
**When** the two are represented
**Then** the split is explicit rather than implied
**And** a prop with state is always an instance

### Story 6.13: NPCs Pack the Same Grid

As a developer,
I want an NPC to be unable to carry what a player could not,
So that no mechanical seam opens between them.

**Acceptance Criteria:**

**Given** an abstract capacity test would let an NPC fit what a player could not
**When** an NPC stores something
**Then** it runs first-fit on the real grid rather than a volume check
**And** the result is an actual layout

**Given** P2 forbids any mechanical seam between player-held and AI-held roles
**When** the two packing paths are compared
**Then** they are the same code path

**Given** first-fit is trivial at these grid sizes and citizens pack rarely
**When** the cost is measured
**Then** it is negligible

### Story 6.14: Loading a Vehicle Is Work

As a player,
I want a badly packed van to fit less,
So that an unsupervised task has a real consequence nobody is scoring.

**Acceptance Criteria:**

**Given** a delivery vehicle has a grid
**When** a round is loaded
**Then** it is a packing problem over that grid

**Given** nobody scores the packing
**When** a van is packed badly
**Then** it simply fits less and the driver makes two trips
**And** no score, rating or feedback is shown

**Given** an action is worth simulating when it can be performed badly
**When** loading is assessed against P4
**Then** it qualifies, and it is an unsupervised task with real consequence

**Given** Epic 8 will test whether unsupervised work holds a player
**When** loading is built here
**Then** it is noted as an early instance of that question
**And** the packing-tedium dial is reviewed once both are playable

---

### Story 6.15: What the Player Carries

As a player,
I want what I am carrying to be a thing in the world rather than a screen,
So that the city keeps its promise that nothing persistent is ever drawn over it.

**Acceptance Criteria:**

**Given** D19 specifies grid inventories and D17 forbids drawing anything persistent, global or abstract
**When** the player carries something
**Then** there is no player inventory of any kind, because such a view would be persistent and global by definition

**Given** the player is carrying a single item - a bottle for the bin, a coffee, a bin bag
**When** they walk through the city
**Then** it is visible on the character sprite
**And** no view of any kind is opened, mirroring D19's rule that an item on a surface gets no view

**Given** hands hold one item
**When** the player tries to pick up a second
**Then** they cannot, and this is the reason a bag is worth owning

**Given** carried items beyond the hands live in a bag
**When** the player opens it
**Then** the bag is a world object with its own grid from `object_def`
**And** the view is object-bound and transient, identical in every respect to opening a cupboard

**Given** a bag is an ordinary object rather than a player attribute
**When** it exists in the world
**Then** it can be bought, upgraded, forgotten at home, left on a bus or stolen
**And** carrying capacity is therefore a physical carrier rather than a stat

**Given** NPCs pack the same grids by first-fit
**When** a citizen and a player each carry things
**Then** they do so by the same mechanism, with no mechanical seam, per P2

**Given** a player who did not bring the bag
**When** they shop
**Then** what fits is what fits and they make two trips, the same arithmetic that makes a badly packed van fit less

---

### Story 6.16: The Container View Grammar

As a player,
I want opening a cupboard to feel like opening a cupboard,
So that handling things reads as part of the world rather than as inventory management.

**Acceptance Criteria:**

**Given** a container view belongs to the fiction
**When** it is drawn
**Then** it is canvas in the game's own pixel style, never a DOM panel, which would read as an application

**Given** the view is object-bound
**When** it opens
**Then** it is anchored to the container it belongs to
**And** it is dismissed by walking away, by pressing escape, or by opening another

**Given** two open grids would invite dragging between panels
**When** the player opens a second container
**Then** only one container view is open at a time, so the interaction stays handling rather than inventory management

**Given** item footprints are reused unchanged from world footprints
**When** an item is placed in a container
**Then** it occupies the same cells it occupies in the world, with rotation supported
**And** a thing that does not fit genuinely does not fit

**Given** the grid is its own explanation
**When** an item will not fit
**Then** it is shown by not fitting, with no error text and no message

**Given** spatial capacity is already a readout
**When** the view is drawn
**Then** there is no slot counter, no capacity bar and no tally, because that would be exactly the abstract persistent overlay D17 forbids

**Given** grid inventories are a known source of tedium paid in the only currency the game has
**When** the packing load is tuned
**Then** grid sizes and how often a packing decision is forced are the dials
**And** storing shopping is a moment while running a warehouse shift is the job
**And** it is prototyped separately from A1 first, so that neither result is confounded by the other

---

## Epic 7: The Day Loop - the Burger Test, first read

A player can live one day: wake in a flat they can barely afford, walk to work, hold down a shift, get paid, and have rent take its bite.

**This is the project's first falsification point.** Everything after it assumes that mundane work is intrinsically satisfying without SS13's round timer and antagonists. A pre-foundation spike was considered and declined, so this is the earliest honest read available.

**Signal-quality caveat, carried from the GDD.** The shop till is the more engaging first job but the **softer** test - it may satisfy because of customers and feedback, in ways that do not generalise to an unsupervised post. The hard case is deliberately held one epic back rather than dropped. A positive read here is necessary but not sufficient.

**The till built here is pre-template.** Epic 8 generalises the four-beat shift structure across jobs; this epic builds one job that works, so that the loop can be played end to end and judged.

**All economic figures in this epic are seed values, not live parameters.** They are read once at world generation and tuning them on a running world has no effect. This must be visibly marked, because someone will eventually try to change starting rent on a live city and be confused.

### Story 7.1: The Starting Flat

As a new player,
I want to wake up somewhere that is mine and barely affordable,
So that the opening fantasy is true from the first second.

**Acceptance Criteria:**

**Given** first-ever spawn is the player's flat interior
**When** a new player arrives
**Then** they are standing in a flat on the edge of the district

**Given** rent on the starting edge flat is 250 per week against a gross of 560
**When** the flat is assigned
**Then** it consumes 45 per cent of gross income
**And** the figure is a seed value, marked as such

**Given** the flat is generated rather than authored
**When** it is assigned
**Then** it comes from the district's dwelling stock under the generator's own rules

**Given** the player has possessions
**When** they look around the flat
**Then** what they own is visible in the world rather than listed anywhere

### Story 7.2: The Commute

As a player,
I want getting to work to cost me real minutes,
So that the distance between where I live and where I work is a thing I feel.

**Acceptance Criteria:**

**Given** the starting commute is 60 in-city minutes each way on foot
**When** the player walks from the edge flat to their workplace
**Then** the journey takes roughly 151 real seconds over roughly 333 cells at the settled walking speed

**Given** the day's budget allocates 2 in-city hours to commuting
**When** both legs are walked
**Then** they consume that budget and leave 6 in-city hours of own time

**Given** the commute has a floor of roughly 20 in-city minutes per leg
**When** any future transport improvement is applied
**Then** the commute never reaches zero
**And** the floor is enforced rather than emergent

**Given** the route is computed over the same macro graph the citizens route on
**When** the player's commute is derived
**Then** it uses edge costs denominated in minutes, so a transport change later acts on it directly

### Story 7.3: The Commute Is the Sensor

As a player,
I want to read the city's state on my way to work,
So that the hundredth run of the loop has content the first did not.

**Acceptance Criteria:**

**Given** emergence reaches the player on the way to and from work
**When** the city's state has changed
**Then** the change is visible on the route rather than reported anywhere

**Given** there is no feed, no notification and no summary
**When** something happens in the city
**Then** the player learns it by walking past it or not at all

**Given** the commute passes through the citizen population built in Epic 5
**When** the player walks at rush hour
**Then** the street reads as busy, and at three in the morning it reads as quiet

**Given** faster transport later changes what is read rather than whether
**When** the route changes
**Then** it passes different streets rather than fewer

### Story 7.4: The Convenience Shop Till

As a player,
I want a job that consists of serving actual people,
So that there is something to hold down rather than a progress bar to watch.

**Acceptance Criteria:**

**Given** the shift is 8 in-city hours, or 20 real minutes
**When** the player works it
**Then** it occupies that block of the day

**Given** the job is serve, scan, bag, take payment, make change and restock
**When** a customer arrives
**Then** the player performs those steps on objects rather than selecting them from a menu

**Given** customers are citizens from Epic 5 who came because they wanted something
**When** they enter the shop
**Then** each has a genuine reason to be there, answerable by the causality inspector
**And** no customer is spawned because a player is present

**Given** physical cash is stock and the till holds denominations
**When** a customer pays with a large note and the till is short
**Then** the procedure branches, and refusing or finding another way are both available
**And** nothing is logged as an error

**Given** stock depletes as it is sold
**When** the shelves run low
**Then** restocking is a step the player performs, and a reorder is emitted when stock falls below threshold

**Given** no job has a score
**When** the shift ends
**Then** nothing rates the player's performance
**And** a shift done well and a shift done adequately differ in the world, not in a number

**Given** the job is one interior with no vehicle and no route
**When** it is built
**Then** it needs no transport or routing work beyond what already exists

### Story 7.5: Wages

As a player,
I want money to arrive as the minutes I spent,
So that pay is stored time rather than a score.

**Acceptance Criteria:**

**Given** the entry wage is 10 per in-city hour
**When** an 8-hour shift completes
**Then** the player is paid 80, and across seven days 560 gross

**Given** wages settle against a bank balance
**When** payment occurs
**Then** it moves bank money rather than physical cash

**Given** there is no HUD and no balance display
**When** the player is paid
**Then** they learn it from a payslip or the world, never from a counter

**Given** the wage is an offered wage on a job posting set by an employer
**When** it is read
**Then** it comes from that posting rather than from a city-wide constant

### Story 7.6: The Rent Metronome

As a player,
I want rent to take its bite whether or not I earned,
So that the pressure the whole time economy answers to is real.

**Acceptance Criteria:**

**Given** rent falls due every 7 in-city days, roughly every 7 real hours
**When** the due date arrives
**Then** rent is taken whether or not the player worked that week

**Given** rent is 250 per week against 560 gross
**When** it is taken
**Then** 45 per cent of gross has gone before anything else

**Given** the landlord is a person setting their own rent rather than a system applying a rate
**When** rent is charged
**Then** it traces to a tenancy with a named counterparty

**Given** debugging a weekly cycle at normal speed would cost seven real hours
**When** rent is tested
**Then** the time control from Story 4.10 is used, and jumping the clock resolves the rent correctly

### Story 7.7: Necessities

As a player,
I want eating to cost me something,
So that the surplus is what is genuinely left over.

**Acceptance Criteria:**

**Given** food and necessities cost roughly 90 per week
**When** the week's costs settle
**Then** the weekly surplus is approximately 220 against 560 gross

**Given** the surplus sets the first savings goal
**When** the player considers a bike at 450
**Then** it is roughly two weeks of surplus away

**Given** necessities are consumed by the player eating rather than deducted as a fee
**When** the player buys food
**Then** stock moves and cash or balance moves with it

### Story 7.8: Sleep

As a player,
I want the day to end,
So that the loop closes and tomorrow is a different day.

**Acceptance Criteria:**

**Given** sleep occupies 8 in-city hours, or 20 real minutes
**When** the player's character sleeps
**Then** the day advances and the loop begins again

**Given** the sleep branch offers logging off or staying up
**When** the player reaches bedtime in this epic
**Then** logging off is available and behaves safely
**And** the borrowed night shift is built in Epic 9 rather than here

**Given** the clock is detached from real time
**When** the player returns the next real day
**Then** they arrive at a different in-city hour

### Story 7.9: Ruin By Process

As a player,
I want falling behind to be a process rather than a failure,
So that pressure is legible and never sharp.

**Acceptance Criteria:**

**Given** missing rent does not trigger eviction
**When** the player misses a payment
**Then** a notice is issued, and the chain runs notice, escalation, judgment, enforcement

**Given** the chain runs on the engine built in Story 6.5
**When** it advances
**Then** it uses that engine rather than new machinery

**Given** each link is a job somebody holds
**When** a link advances
**Then** a named citizen performed it
**And** at v1 those links are AI-staffed, with player-holdable links deferred to Epic 13

**Given** consequences are slow, visible and interruptible
**When** the chain is running
**Then** the player can see where in the process they are, through documents in the world rather than through a status readout

**Given** the chain has in-city days of latency between links
**When** the player does nothing
**Then** it advances at its own pace rather than immediately

### Story 7.10: Every Link Is a Moment to Intervene

As a player,
I want each step of falling behind to be something I can act on,
So that the process is survivable by doing something rather than by waiting.

**Acceptance Criteria:**

**Given** each link is a moment at which the player can intervene, negotiate, pay or appeal
**When** the player reaches a link
**Then** all four are available where they make sense, and each changes what happens next

**Given** intervening involves a person holding a post
**When** the player negotiates or appeals
**Then** they do so with a citizen in a role, at a place, costing minutes

**Given** the borrowed night shift is always available and always pays
**When** the player needs money urgently
**Then** a route up exists, from Epic 9 onward

**Given** pressure must be legible and never sharp
**When** the player is in the process
**Then** at no point does an irreversible step occur without prior visible warning

### Story 7.11: Nothing Is Irreversible

As a player,
I want to know that nothing here can destroy me,
So that the game is cozy in consequence while being harsh in arithmetic.

**Acceptance Criteria:**

**Given** there is no win condition, no loss condition and no death
**When** the player's situation is at its worst
**Then** no terminal state exists and no state prevents recovery

**Given** nothing is scored
**When** the player performs badly for a sustained period
**Then** no rating, rank or record of failure accumulates

**Given** destitution is a place with routines rather than a game-over
**When** the player reaches the bottom
**Then** they are somewhere with its own life, and the institutions that catch them are built in Epic 10

**Given** the maths is genuinely tight
**When** the arithmetic is checked
**Then** rent really is 45 per cent of gross and minutes really are scarce
**And** the harshness is in the arithmetic while the consequence stays survivable

### Story 7.12: Time Is the Only Scarcity

As a developer,
I want to verify that nothing competes with minutes,
So that the pillar the whole economy rests on is checked rather than assumed.

**Acceptance Criteria:**

**Given** money is stored time and nothing else
**When** the economy is audited
**Then** every cost is expressible in minutes before it is expressible in currency

**Given** no system may introduce a resource that competes with time as the scarce thing
**When** any new resource is proposed
**Then** it either reduces to minutes or it is rejected
**And** the review gate carries this check

**Given** convenience purchases must be expressible as minutes-per-day returned
**When** one is defined
**Then** its return is stated in those terms

**Given** the day budget is 24 in-city hours across sleep, work, commute and own time
**When** the player's day is measured
**Then** it sums correctly and own time is the only genuinely discretionary block

### Story 7.13: The Burger Test, First Read

As the solo developer,
I want an honest answer to whether this is fun,
So that six epics of assumption are tested rather than extended.

**Acceptance Criteria:**

**Given** the loop runs wake, commute, shift, paid, spend, rent, sleep
**When** a person plays it
**Then** they can complete a full day unaided and then choose to run it again

**Given** the metric is voluntary time in the shift rather than a survey
**When** the player works
**Then** the instrumentation defined in Story 4.14 emits it
**And** skipping or idling through the shift is measurable

**Given** the till is the softer test and may satisfy for reasons that do not generalise
**When** the read is recorded
**Then** it states explicitly what it does and does not tell us about an unsupervised post

**Given** everything after this epic assumes the answer is yes
**When** the answer is not clearly yes
**Then** the finding is recorded against A8 and Epic 8 is treated as the deciding test rather than as a continuation
**And** if both reads are negative, the design's foundation is reopened rather than the epics continuing

**Given** honest judgement is the deliverable
**When** the epic closes
**Then** a written read exists, not a passing test

---

### Story 7.14: The Opening Minutes

As a new player,
I want my first session to make sense without being explained,
So that I learn the city by living in it rather than by being taught about it.

**Acceptance Criteria:**

**Given** first-ever spawn is the player's own flat interior
**When** the session begins
**Then** it is the loop's opening beat, and it is also the cheapest screen to boot at roughly 420 rows against a street's 28,000

**Given** the street streams behind the door
**When** the player looks for something to do
**Then** going outside is the first available thing and needs no prompting

**Given** the commute is 60 in-city minutes on foot
**When** the player walks it
**Then** the game has taught its central arithmetic by charging it, before anything explains it

**Given** the till shift at this epic is worked without the four-beat procedure machine, which arrives in Epic 8
**When** the player takes their first shift
**Then** the opening sequence is complete without it
**And** handover as the teaching moment arrives with that machine rather than being owed by this story

**Given** rent takes its bite whether or not the player understood any of this
**When** the first week closes
**Then** the metronome has started, which is the design's honest opening statement

**Given** the design ships no authored content
**When** these beats are implemented
**Then** each is a system already scheduled elsewhere, ordered for a new player
**And** nothing here is a script, a cutscene, a quest or a tutorial mode

---

## Epic 8: Procedure and Props - the Burger Test, the hard case

Work that can be performed well or badly, with nothing scoring you - and an empty post that has to hold a player anyway.

**The second and harder falsification point.** Epic 7 tested a customer-facing job, which may satisfy for reasons that do not generalise. This epic tests the unsupervised one. **If a shift with nothing demanding attention is not satisfying, P4 has failed and the design's foundation is wrong.**

**This epic resolves A1** - the multi-step procedure interaction model - by prototyping. It is the most important unresolved control question in the design and is explicitly not resolvable on paper. P4 lives or dies on whether procedure feels like *handling* or like *clicking*.

**Freedom scales inversely with supervision**, so the emptiest post is designed as the most interesting one rather than the most neglected. The night guard's building is where this is settled.

**Watch alongside Epic 6's packing dials.** Grid inventory tedium and procedure feel will be experienced together, and the judgement about whether interaction has become tedious must be made across both rather than about either alone.

### Story 8.1: The Procedure Machine

As a developer,
I want procedures to be declared step sequences over object state,
So that every job in the city runs on one mechanism.

**Acceptance Criteria:**

**Given** a procedure is a state machine over steps
**When** a procedure is defined
**Then** it is data in `defs/` rather than code, and its steps name the objects they act on

**Given** routine jobs are a fixed sequence of steps over local state
**When** a decision arises within one
**Then** it is expressible as a procedure branch, such as no beans meaning order, or no change meaning refuse the note

**Given** the machine advances by intents from the input layer built in Story 1.9
**When** an intent arrives
**Then** the procedure decides what it means
**And** nothing in the input layer encodes procedure semantics

**Given** the same procedure must later be advanced by a player or by a citizen's scheduled transition
**When** the machine is built
**Then** the driver determines how a step is performed, never what the state is
**And** Epic 9 can swap drivers without altering this machine

**Given** procedure state is authoritative
**When** a step completes
**Then** the state change is recorded server-side with the performing citizen named

### Story 8.2: Props Carry State

As a player,
I want to see that the stamp is dry by looking at the stamp,
So that the simulation is legible at the scale of my own hands.

**Acceptance Criteria:**

**Given** props carry state and that state is visible on the object
**When** a prop's state changes
**Then** the change is visible in the world
**And** it appears in no UI readout anywhere

**Given** the canonical cases
**When** they are built
**Then** the stamp runs dry, the till runs short of change, the bin lorry fills and the coffee grinder's hopper empties

**Given** a state-driven animated object exists
**When** its state changes
**Then** the animation follows, client-side and non-authoritative, seeded from the object id so all clients agree

**Given** an empty till or an empty hopper is content
**When** either occurs
**Then** it is not logged as an error, and a person in the world could observe it and shrug

**Given** prop state is server-authoritative
**When** two players observe the same prop
**Then** they see the same state

### Story 8.3: The Interaction Model

As a player,
I want performing a procedure to feel like handling things,
So that the discretionary middle has something worth inhabiting.

**Acceptance Criteria:**

**Given** A1 is explicitly unresolved and is resolved here by prototyping
**When** this story runs
**Then** more than one interaction model is built and played, not one designed and accepted

**Given** procedure steps are performed on objects in sequence rather than selected from a menu
**When** the player performs grind, dose, tamp and pull
**Then** each is an action on a world object
**And** no step list, wheel or command menu appears

**Given** the question is whether procedure feels like handling or like clicking
**When** the prototypes are compared
**Then** the judgement is recorded in those terms, by playing rather than by reasoning

**Given** gamey affordances exist only where the experience genuinely breaks without them
**When** an abstraction is introduced
**Then** it is justified by a specific breakage rather than adopted as a default

**Given** the input layer is deliberately ignorant of procedure meaning
**When** the model is iterated
**Then** no change to the input layer is required
**And** if one is required, that is itself a finding about Story 1.9's boundary

**Given** this is the most important unresolved control question in the design
**When** no prototype feels like handling
**Then** the finding is escalated rather than the least-bad option being adopted

### Story 8.4: The Four-Beat Template

As a player,
I want a shift to have a shape,
So that arriving and leaving are events rather than state changes.

**Acceptance Criteria:**

**Given** every playable job runs the same four beats
**When** a shift is worked
**Then** it runs ritual open of roughly 30 in-city minutes, rhythmic duties of roughly 3 hours, a discretionary middle of roughly 4 hours, and a ritual close of roughly 30 minutes

**Given** the total shift is 8 in-city hours or 20 real minutes
**When** the beats are summed
**Then** they account for that block

**Given** the ritual open is arrive, change in, equip and take handover
**When** the player starts a shift
**Then** they relieve somebody, and that somebody is a citizen who was working before they arrived

**Given** the ritual close is a final round, handover, change out, return equipment and goodbye
**When** the shift ends
**Then** the player hands over to whoever is next
**And** handover is where information legitimately passes between people, per the carrier law

**Given** the template is reused across the city rather than authored per job
**When** a new job is defined
**Then** it supplies its own duties and inherits the four beats

### Story 8.5: The Discretionary Middle

As a player,
I want four in-city hours where nobody is watching,
So that there is somewhere in the day that is genuinely mine.

**Acceptance Criteria:**

**Given** the discretionary middle is roughly 4 in-city hours, or 10 real minutes
**When** the player reaches it
**Then** nothing requires their attention and no task is outstanding

**Given** the middle is where the game actually lives
**When** the player is in it
**Then** the available actions include the job's optional work, the verb vocabulary, and doing nothing

**Given** a shift where nobody is watching only means something if there is a thing you are supposed to be doing and could choose not to
**When** the middle begins
**Then** such a thing exists and is genuinely optional

**Given** voluntary time in the middle is the metric that tests P4
**When** the player is in it
**Then** the instrumentation defined in Story 4.14 emits how that time was spent
**And** skipping, idling and engaging are distinguishable

**Given** the middle is different every day because the player chooses what it is
**When** it is played repeatedly
**Then** nothing scripts or varies it on the player's behalf

### Story 8.6: Doing It Badly

As a player,
I want to be able to do my job badly,
So that doing it well is a choice I made.

**Acceptance Criteria:**

**Given** an action is worth simulating when it can be performed badly
**When** a procedure is built
**Then** it has at least one way to be performed badly, or it is abstracted instead

**Given** the canonical failures
**When** they occur
**Then** missed bins, spillage, wrong route order, short-changing, queues, a bad shot, burnt milk, a wrong order, running early, missed stops, harsh braking, skipped rounds and unlogged doors are each possible

**Given** failure changes the world rather than a score
**When** the player performs badly
**Then** the consequence is physical and visible
**And** nobody tells them they did badly

**Given** a badly performed procedure is not an error
**When** it happens
**Then** nothing is logged as a failure and no correction is offered

### Story 8.7: Nothing Scores You

As a player,
I want cleaning the lobby to be worth doing even though nothing notices,
So that the good move and the efficient move can differ.

**Acceptance Criteria:**

**Given** no job has a score
**When** a shift ends
**Then** no rating, rank, percentage, streak or record exists anywhere

**Given** self-imposed standards are never required, tracked or rewarded
**When** the player cleans the lobby
**Then** the lobby is cleaner afterwards, and that is the entire consequence

**Given** the good move and the efficient move differ deliberately
**When** the player takes the courteous option
**Then** it costs them minutes and returns nothing measurable

**Given** the most satisfying actions are the socially optional ones
**When** the verb set is reviewed
**Then** the courtesy, the pause and the tidy-up are available and unrewarded

**Given** an agent may be tempted to add feedback where none is designed
**When** any progress indicator, completion state or acknowledgement is proposed
**Then** the review gate rejects it

### Story 8.8: The Security Guard

As a player,
I want a shift in an empty building with nobody watching,
So that the design's hardest claim is put to the test.

**Acceptance Criteria:**

**Given** the guard's job is rounds, door checks and log entries
**When** the player works the shift
**Then** each is a procedure performed on objects in the building

**Given** the post is one interior with no customers and no supervision
**When** the shift runs
**Then** nothing arrives to demand attention

**Given** freedom scales inversely with supervision, so the emptiest post is designed as the most interesting one
**When** the building is built
**Then** it is designed for a person with time rather than left sparse
**And** it rewards exploring, noticing and pottering without recording any of it

**Given** the job fails badly as skipped rounds and unlogged doors
**When** the player skips
**Then** the log shows what was and was not done, as a physical document rather than a score

**Given** this is where P4 is proven or disproven
**When** the shift is played
**Then** the judgement is taken seriously rather than absorbed

### Story 8.9: Toys Inside Jobs

As a player,
I want solitaire on the guard's computer,
So that the empty post has something in it that is mine.

**Acceptance Criteria:**

**Given** toys exist inside jobs
**When** the player finds the guard's computer
**Then** solitaire is playable on it, in the world, as an object

**Given** a toy is not a reward and not a distraction from the job
**When** the player plays it
**Then** nothing tracks it, and the shift continues around them

**Given** the discretionary middle needs things to fill it that are not work
**When** toys are placed
**Then** they are found rather than offered

**Given** the canvas may draw transient object-bound views
**When** solitaire is displayed
**Then** it is drawn as such, bound to the computer, and closes when the player walks away

### Story 8.10: Presence Verbs

As a player,
I want sitting on a bench to be a thing I can do,
So that being somewhere is content rather than the gap between content.

**Acceptance Criteria:**

**Given** presence verbs are actions whose entire payload is being somewhere
**When** the player uses one
**Then** sit, order, wait and watch are available on the objects that afford them

**Given** idleness is designed content
**When** a bench exists
**Then** it can be sat on, and that is a feature

**Given** presence verbs cost minutes
**When** the player sits
**Then** time passes and that is the point

**Given** nothing rewards presence
**When** the player sits for a long time
**Then** nothing accrues and nothing acknowledges it

### Story 8.11: Civic Verbs

As a player,
I want to pick up somebody else's bottle,
So that I have a hand in the city's state rather than only reading it.

**Acceptance Criteria:**

**Given** civic verbs operate on single world objects
**When** the player encounters the affordance
**Then** bin the bottle, hold the door and give up the seat are available

**Given** binning a bottle removes it from the street
**When** the player does it
**Then** the object is gone and the street is that much less degraded

**Given** the litter loop itself is built in Epic 10
**When** that epic lands
**Then** this verb is already the player-side reversal of it, requiring no change here
**And** litter becomes reversible both by the sanitation chain and by any citizen who picks the bottle up

**Given** the commons is an interactive surface at the scale of a single object
**When** the player acts on it
**Then** the effect is one object, one street, and reversible

**Given** nothing rewards civic action
**When** the player bins the bottle
**Then** no acknowledgement of any kind occurs

### Story 8.12: Conversation as Loitering

As a player,
I want talking to somebody to cost me minutes,
So that time spent with a person is the thing that was actually spent.

**Acceptance Criteria:**

**Given** conversation is done instead of transacting
**When** the player talks to a citizen
**Then** it is an alternative to the transaction rather than a wrapper around it

**Given** conversation is chosen sentence by sentence and costs minutes
**When** the player continues
**Then** each continuation costs in-city minutes from their own budget

**Given** there is no dialogue tree and no branching script
**When** the player converses
**Then** no branching structure exists, no outcome is unlocked and no information is dispensed
**And** what the conversation buys is that the time was spent

**Given** citizens remember individual people
**When** the player converses repeatedly with the same citizen
**Then** habit strength grows through the mechanism already built in Story 5.12
**And** no separate relationship system exists

**Given** this is P1 applied to social interaction
**When** the cost is assessed
**Then** it is denominated in the only currency the game has

### Story 8.13: Dignity Work

As a player,
I want my job to be made of small courtesies to specific people,
So that the work is not resource throughput with sprites on it.

**Acceptance Criteria:**

**Given** dignity work is the ramp, the ticket and the correct change
**When** a job is designed
**Then** it contains actions that are courtesies to a specific person rather than operations on a quantity

**Given** the person is specific
**When** the player performs the courtesy
**Then** it is for a citizen with an identity, an appearance and a reason to be there

**Given** these actions are what stop the playable jobs reading as chores
**When** a job is reviewed
**Then** it is assessed against this and reworked if it reads as throughput

**Given** nothing rewards the courtesy
**When** it is performed
**Then** it costs minutes and returns nothing measurable

### Story 8.14: Two Pairs of Hands

As a developer,
I want procedures able to require two people,
So that co-op emerges from simulation fidelity rather than from designed multiplayer content.

**Acceptance Criteria:**

**Given** some procedures may physically require two people
**When** the procedure machine is built
**Then** a step can declare that it needs two performers

**Given** the principle ships but the content does not
**When** v1 is scoped
**Then** at most a token case exists, and specific two-handed tasks are deferred

**Given** co-op must emerge from fidelity rather than from designed content
**When** a two-person step is encountered
**Then** it is because the thing genuinely needs two people, not because multiplayer content was wanted

**Given** the design laws permit only this kind of multiplayer content
**When** a two-person task is proposed
**Then** it is accepted only if the physical justification holds

### Story 8.15: The Hard Burger Test

As the solo developer,
I want to know whether an empty post holds a player,
So that the design's foundation is tested rather than assumed for another six epics.

**Acceptance Criteria:**

**Given** the guard's shift has nothing demanding attention
**When** a person works it
**Then** their voluntary time in the discretionary middle is measured

**Given** the failure condition is players skipping or idling through the middle
**When** the measurement is taken
**Then** it distinguishes engaged time from idle time from skipped time
**And** the distinction is defined before the shift is played rather than after

**Given** P4 has failed if the middle does not hold a player
**When** the result is negative
**Then** the finding is recorded against A8 and the design's foundation is reopened
**And** epics 9 onward do not proceed on the assumption that it passed

**Given** Epic 7's read was on the softer case
**When** both reads are available
**Then** they are assessed together, and the harder one carries more weight

**Given** procedure feel and packing tedium are experienced together
**When** the judgement is made
**Then** it covers both, and the grid-size and packing-frequency dials from Epic 6 are tuned or the design is reconsidered

**Given** honest judgement is the deliverable
**When** the epic closes
**Then** a written read exists that states plainly whether this is worth doing when nobody is watching

---

### Story 8.16: Handover Teaches the Procedure

As a new player,
I want the person I am relieving to show me the job,
So that I can be bad at the work for real reasons rather than because nobody told me what it was.

**Acceptance Criteria:**

**Given** the design has no tutorial, no HUD, no objective markers and no quest log
**And** the core activity is a multi-step procedure with real failure modes
**When** a player performs a procedure they have not performed before
**Then** handover teaches it

**Given** ritual open is arrive, change in, equip and take handover
**When** the teaching happens
**Then** it is the outgoing worker walking the steps in the world on the actual props
**And** it is not a text panel, a tooltip sequence, a step list or a pinned checklist

**Given** knowledge travels through physical carriers
**When** the procedure is learned
**Then** it came from a person at handover, satisfying the carrier law rather than bending it

**Given** conversation costs minutes
**When** the player asks a colleague to go through it again
**Then** repetition is available and is priced like any other conversation

**Given** props carry their own state
**When** the player returns for a later shift
**Then** there is no reminder, no checklist and no re-teaching, because the props are the standing reminder

**Given** the Burger Test asks whether mundane work is intrinsically satisfying
**When** a player cannot work out how to do the work
**Then** that would fail the test for reasons unrelated to the hypothesis
**And** this story exists so Epic 7 and Epic 8 do not return a false negative on the assumption the whole design rests on

---

## Epic 9: Reciprocal Occupancy

A player can leave and come back safely, and the night is populated because somebody is always awake in it.

**One system, not two.** D20 closed the validation gap that had the understudy and the night shift looking like separate mechanisms. A citizen body has exactly one driver, and the driver is swappable. This makes P2's "no mechanical seam between a player-held and an AI-held role" **structural rather than aspirational**: the seam cannot exist, because there is one slot with three possible occupants.

**A deliberate departure from the GDD, carried from the architecture.** The GDD makes *"the pile of post on the doormat"* the diegetic carrier for missed time and for financial state. The architecture rejected it as **an inbox in diegetic costume, and inconsistent with a competent understudy**, and rejected "records rendered as sentences" as a HUD in disguise. What replaces it: **the trace on return is the changed world.** Payslips and receipts still accrue as additive physical objects; they are simply not the mechanism by which the player reads their situation.

**Time scale, which makes absence severe.** At 24 in-city days per real day, a weekend offline is about 7 in-city weeks and a fortnight offline is about an in-city year.

### Story 9.1: Body Drivers

As a developer,
I want one occupancy slot with three possible occupants,
So that the seam P2 forbids cannot be written.

**Acceptance Criteria:**

**Given** a citizen body has exactly one driver
**When** the driver is inspected
**Then** it is the citizen's own L2, an understudy, or a player

**Given** the driver is swappable
**When** a player connects, disconnects, or takes a borrowed shift
**Then** the slot's occupant changes and nothing else does

**Given** an unheld institutional post is simply L2 continuing
**When** no player holds a role
**Then** its driver is the citizen's own L2, and no distinct backfill mechanism exists

**Given** the driver determines how a step is performed but never what the state is
**When** the same procedure is advanced by different drivers
**Then** the resulting state is identical

**Given** P2 forbids any mechanical seam
**When** the two paths are compared in code
**Then** they share the procedure machine from Story 8.1 rather than paralleling it

### Story 9.2: The Understudy's Mandate

As a player,
I want somebody sensible holding my life while I am gone,
So that leaving is safe rather than a decision.

**Acceptance Criteria:**

**Given** the understudy's mandate is conservative and fixed
**When** the player is disconnected
**Then** it goes to work, pays rent, eats, sleeps and banks the surplus

**Given** it never bets the paycheck, never quits the job and never takes a risk with the character's position
**When** an opportunity to do any of those arises
**Then** it declines

**Given** the mandate is not configurable
**When** any interface to adjust it is proposed
**Then** it is rejected, because a configurable understudy becomes an optimisation surface and turns absence into a strategy

**Given** the understudy earns the same wage the player would
**When** it works a shift
**Then** the pay is identical, never more and never less

**Given** it is the same machine with richer inputs and a conservative posture as a parameter
**When** it is built
**Then** it is not a second code path

### Story 9.3: Additive Only

As a player,
I want to come back to everything I left,
So that logging off costs me nothing I earned with my own time.

**Acceptance Criteria:**

**Given** the understudy adds and never subtracts, replaces, consumes, degrades or rearranges
**When** the player returns from any absence
**Then** nothing they owned is gone, changed, worn or moved

**Given** necessities are a cost line rather than inventory consumption
**When** the understudy eats for a week
**Then** it pays the weekly food cost and does not consume the player's things

**Given** wear during absence would be a P3 violation, penalising logging off in the currency of the player's own discretionary time
**When** any degradation-during-absence is proposed
**Then** it is rejected on that basis

**Given** at 24 in-city days per real day a weekend offline is about 7 in-city weeks
**When** the arithmetic of any accrual is considered
**Then** it is checked against that multiplier before being accepted

**Given** the property must hold for any absence duration
**When** the property test runs
**Then** it asserts the returning inventory is a superset of the departing one and no owned item's state has degraded
**And** it runs across randomised absence durations up to an in-city year

### Story 9.4: Reconciliation as a Record

As a developer,
I want an absent character reconciled as a ledger entry rather than simulated tick by tick,
So that absence costs nothing to run.

**Acceptance Criteria:**

**Given** the ledger is separate from the body
**When** a player is absent
**Then** their character advances as a record, and no body is instantiated on their behalf

**Given** the record settles on return
**When** the player reconnects
**Then** their financial and positional state is consistent with the elapsed time, resolved in one settlement

**Given** kinematic continuity means the player returns where cause and elapsed time put them
**When** they reconnect mid-shift or mid-commute
**Then** they are at the position that follows from what the understudy was doing

**Given** the same ledger-body separation applies to citizens
**When** the mechanism is built
**Then** it is the mechanism from Story 5.5 rather than a parallel one for players

### Story 9.5: The Trace Is the World

As a player,
I want to notice that things happened while I was gone by looking at the city,
So that returning is arriving somewhere rather than reading a report.

**Acceptance Criteria:**

**Given** the trace on return is the world rather than the player's possessions
**When** the player returns after a long absence
**Then** the street has changed, scaffolding has gone up, a chain has advanced

**Given** the pile of unread post is rejected as an inbox in diegetic costume
**When** the player returns
**Then** no inbox, queue or list of things that happened is presented

**Given** records rendered as sentences are rejected as a HUD in disguise
**When** the player learns what happened
**Then** they learn it from carriers rather than from sentences
**And** no narrated summary of the absence exists anywhere

**Given** this change is causal and Truth-Test clean rather than authored for the returning player
**When** the world's changes are inspected
**Then** each would have happened identically had the player never left or never returned

**Given** the GDD specifies the pile of post and the architecture overrode it
**When** this story is implemented
**Then** the override is recorded in the decision log from Story 0.10, so the contradiction is visible rather than silently resolved

### Story 9.6: Payslips and Receipts

As a player,
I want the paperwork of my absence to be objects in my flat,
So that money has a physical form without becoming a readout.

**Acceptance Criteria:**

**Given** payslips, receipts and council letters survive as additive physical objects
**When** the understudy is paid or pays rent
**Then** the corresponding document appears in the player's flat as a world object

**Given** these documents are not the mechanism for reading financial state
**When** the player wants to know how they stand
**Then** the documents are evidence they may choose to read, not a summary presented to them

**Given** no HUD, balance or counter exists
**When** the player reads a payslip
**Then** they read a document in the world, examined as an object

**Given** documents accrete over a world that never resets
**When** they accumulate
**Then** the player can bin them, and a hard cap exists behind that as an engineering ceiling
**And** the table declares both bounds

### Story 9.7: The Night Shift

As a player,
I want to work somebody else's night when I am not ready to stop,
So that there is always a way to earn and the night is populated.

**Acceptance Criteria:**

**Given** staying up past the character's bedtime offers a few available night posts
**When** the player chooses to stay up
**Then** a small set of posts is offered and they pick one

**Given** the framing is non-diegetic and deliberately so
**When** the choice is presented
**Then** there is no shift board and no agency office
**And** the rationale is recorded: transforming into another character already breaks immersion, so diegetic ceremony would buy nothing

**Given** the shift is sized by how tired the character is
**When** the tiredness cap is applied
**Then** it bounds the shift's duration

**Given** the borrowed shift is always available and always pays
**When** the player has no money and no other route
**Then** this route exists and works
**And** it is the mechanism that makes the floor inhabitable

**Given** night posts are differentiated only by pay, duration and the tiredness cap
**When** they are offered
**Then** no social or progression reason to prefer one exists
**And** this is accepted: the night shift is a utility system, not a second life

### Story 9.8: The Borrowed Body Is Anonymous

As a player,
I want borrowed shifts to leave no trace on me,
So that the night shift stays a safety net rather than becoming a second career.

**Acceptance Criteria:**

**Given** borrowed shifts do not accumulate
**When** a player drives the same night bus fifty times
**Then** they do not become known as the night bus driver, to anyone

**Given** consequence lands on the NPC rather than the player
**When** the player performs badly in a borrowed body
**Then** the consequence attaches to that citizen

**Given** the borrowing licence is untested as an anti-griefing measure
**When** it ships
**Then** the risk is recorded as observable only with real players, and revisited post-launch

**Given** nothing carries forward
**When** the shift ends
**Then** the player returns to their own character with no gain other than the pay

### Story 9.9: AI Backfill

As a player,
I want every post in the city covered,
So that nothing deadlocks because somebody went to bed.

**Acceptance Criteria:**

**Given** AI backfill is simply that citizen's L2 continuing
**When** a role is unheld
**Then** it is worked by its citizen, with no separate backfill system

**Given** institutional decay from churn is prevented outright rather than damped
**When** players come and go
**Then** no service degrades because the server was quiet

**Given** decay always has an author
**When** a service does degrade
**Then** somebody chose it

**Given** the design may never assume a player is present for a chain to advance
**When** any chain is examined
**Then** it advances without player presence

### Story 9.10: Handover Mid-Procedure

As a player,
I want to be able to disconnect halfway through anything,
So that session boundaries are never world boundaries.

**Acceptance Criteria:**

**Given** the procedure state machine is the shared substrate
**When** the driver changes mid-procedure
**Then** the same procedure continues from its current state

**Given** L2 state is never suspended while a player drives
**When** the player performs a step
**Then** the citizen's L2 state advances by their action rather than pausing

**Given** handover snaps to the current step boundary
**When** a player drives a bus halfway between stops and disconnects
**Then** the handover resolves to the step boundary and resumes, because the route step already knows which stops remain
**And** this is chosen over resumable sub-step state as simpler and indistinguishable in practice

**Given** taking over cancels the citizen's pending scheduled transition and handing back re-creates it
**When** either happens
**Then** the scheduling change is transactional with the state change, so neither can be lost

**Given** handover works in both directions
**When** a player takes over a borrowed body mid-shift and later hands it back
**Then** both transitions behave identically

### Story 9.11: Discretionary Within the State Space

As a developer,
I want the player unable to take the bus into a field,
So that every borrowed shift is recoverable.

**Acceptance Criteria:**

**Given** the discretionary middle must be discretionary within the procedure's state space
**When** the player acts during a shift
**Then** every action they can take corresponds to a state the procedure can represent

**Given** a player doing what L2 cannot represent would create an unrecoverable state
**When** such an action is proposed
**Then** it is rejected, because L2 would have no state for a bus in a field

**Given** a player may perform a procedure well or badly but never outside it
**When** the boundary is tested
**Then** performing badly remains fully available
**And** the constraint restricts the state space, not the quality of performance

**Given** the seam P2 forbids would otherwise return as a bug
**When** any procedure is added
**Then** its state space is checked to cover everything a player can do within it

### Story 9.12: Nothing Punishes Logging Off

As a player,
I want to close the tab without weighing it,
So that the game is a place I visit rather than a commitment I maintain.

**Acceptance Criteria:**

**Given** no system may punish logging off
**When** the systems are audited
**Then** none imposes a cost, decay, forfeit or missed opportunity attributable solely to absence

**Given** absence is technically the money-optimal play, because the understudy banks while a present player spends
**When** this is considered
**Then** it is accepted, because money is the least-valued axis and has no display
**And** the tension is recorded, to be re-examined if players report feeling punished for playing

**Given** everything that actually matters requires presence
**When** the axes are compared
**Then** lateral pursuits, institutional position and the people who know you all advance only when the player is there

**Given** the review gate carries this rule
**When** any feature would make absence costly
**Then** it is rejected

### Story 9.13: Social Continuity Across Long Absence

As a player,
I want the people I knew to still be there after a fortnight away,
So that recognisability survives the thing that most threatens it.

**Acceptance Criteria:**

**Given** a fortnight offline is roughly an in-city year
**When** a player returns after one
**Then** the citizens they had habits with are mostly still in place

**Given** recognisability and the geographic social graph both assume the player keeps meeting the same people
**When** labour churn is modelled
**Then** established citizens are sticky rather than churning uniformly
**And** this is recorded as more accurate than uniform churn, not as a concession

**Given** money and rent scale fine across long absence and the understudy holds the role
**When** the exposed surface is identified
**Then** it is the social graph specifically, and the mitigation is scoped to that

**Given** this was escalated from the architecture to design and left open
**When** this story is implemented
**Then** the decision taken is recorded in the decision log
**And** if stickiness proves insufficient, the finding returns to design rather than being patched here

### Story 9.14: Come Back After a Week

As a player,
I want to return after a real week and find my life intact and slightly richer,
So that absence reads as safe rather than as abandonment.

**Acceptance Criteria:**

**Given** a player logs off for a real week, roughly 168 in-city days
**When** they return
**Then** their character has worked, paid rent, eaten and banked the surplus

**Given** money is the one axis that advances during absence
**When** they return
**Then** they have more in the bank than they left, and nothing else has advanced

**Given** the return must read as arriving somewhere
**When** they reconnect
**Then** they are where cause and elapsed time put them, the world has visibly moved, and no summary is presented

**Given** return rate after absence is one of the five gameplay metrics
**When** a player returns
**Then** the instrumentation from Story 4.14 emits it

**Given** the metric tests whether absence reads as safe or as abandonment
**When** the result is read
**Then** an honest judgement is recorded on which of the two it felt like

---

## Epic 10: Institutions and the Reference Slice

The plastic-bottle loop runs end to end, and the player reads it on their commute.

**This is the vertical slice** that exercises institutions, emergence, jobs and physical consequence on a single street - the GDD's named mitigation against the project's headline scope risk.

**It builds the decision layer, not the plumbing.** The chain engine came from Story 6.5. What is new here is **matters**: a decider is not a different kind of agent, only a citizen whose work-time option set is matters instead of procedure steps, scored by the same utility evaluator built in Story 5.10. A decider's shift is entirely own-time.

**Nothing arrives by detection.** All four inbound fluxes have a person and a physical object. A threshold has no author; a driver noticing does. **Volume is the signal** - twelve complaints about one street *are* the aggregate, and no statistic is required.

**The watch item.** If residents habituate to a bad street, complaints dry up, severity decays, and the problem becomes permanent with nothing pursuing it - starving the signal rather than drifting, but violating the equilibrium law all the same.

### Story 10.1: Matters

As a developer,
I want an item of institutional business to be a first-class thing,
So that every municipal service in the city runs on one mechanism.

**Acceptance Criteria:**

**Given** a matter is scoped to a jurisdiction and to a subject
**When** one is created
**Then** its jurisdiction is a profession, and its subject is a place, a business, a department or the city

**Given** matters carry severity and age
**When** a matter sits unresolved
**Then** its age rises, and age is a scoring term, so nothing starves indefinitely

**Given** the matter table is bounded by complaint rate multiplied by expiry window rather than by cumulative history
**When** the bound is declared
**Then** it is game-mechanical, with expiry as the mechanism

**Given** matter kinds are an extensible set
**When** a new municipal service is added later
**Then** it is a row insert rather than a migration

### Story 10.2: Citizen-Filed Complaints

As a player,
I want somebody to walk past a full bin and decide to report it,
So that the city's problems are noticed by people rather than detected by code.

**Acceptance Criteria:**

**Given** a citizen passes a degraded thing on their route
**When** they observe it
**Then** they weigh the minutes filing would cost against how much it bothers them, using the evaluator from Story 5.10

**Given** filing has a physical carrier
**When** a citizen files
**Then** it is a complaint form, a phone call or a visit to the ward office, costing them in-city minutes

**Given** volume is the signal
**When** twelve citizens complain about one street
**Then** twelve matters exist and their volume is the aggregate
**And** no statistic is computed

**Given** complaint filing probability has a floor
**When** residents habituate to a persistently bad street
**Then** filing decays but never reaches zero
**And** the floor is a balance parameter, tunable on a running world

**Given** newcomers have not habituated
**When** in-migration brings new residents to a degraded area
**Then** they file at the undecayed rate, regenerating the signal

### Story 10.3: Worker Escalation

As a player,
I want the driver who tips at the landfill to be the one who notices it is nearly full,
So that the decision layer is fed by people doing their jobs.

**Acceptance Criteria:**

**Given** a routine job's procedure step detects an out-of-range condition
**When** the step runs
**Then** it branches to emit a report, and the citizen performing it is the report's author

**Given** the canonical case
**When** a driver tips at the landfill and the tip step reads refuse stock near capacity
**Then** the driver emits a report

**Given** this flux replaces a statistic crossing a threshold
**When** any monitoring of a quantity is proposed
**Then** it is rejected unless a worker performing a step is the one who notices
**And** the review gate carries this check

**Given** the escalation has a physical carrier
**When** the report is made
**Then** it is a note at the depot or a word at handover

**Given** being somewhere is how you find things out
**When** a routine job has no decisions of its own
**Then** it still feeds the decision layer, because its holder goes places

### Story 10.4: Inter-Institutional Requests and the Calendar

As a player,
I want a manager's request to land on somebody else's desk,
So that institutions depend on each other rather than acting alone.

**Acceptance Criteria:**

**Given** a chain needs a decision at a link
**When** it reaches that link
**Then** a matter appears in the responsible jurisdiction's inbox, carried by the paperwork itself

**Given** the canonical case
**When** a sanitation manager requests headcount
**Then** the request lands in the finance officer's inbox

**Given** scheduled obligations arrive on a calendar
**When** a budget review, renewal date or inspection date approaches
**Then** a matter appears with deadline semantics
**And** its severity climbs steeply toward the date

**Given** the calendar flux is what drains deferred matters
**When** budget season arrives
**Then** the accumulated deferrals are the demand signal it addresses

### Story 10.5: Decider Jobs

As a player,
I want a manager's day to be choosing which of eleven things is today's problem,
So that institutional work is judgement rather than a procedure.

**Acceptance Criteria:**

**Given** a decider is a citizen whose work-time option set is matters instead of procedure steps
**When** a decider works a shift
**Then** they score open matters in their jurisdiction and act on one

**Given** a decider's shift is entirely own-time
**When** their decisions are made
**Then** they use the same utility evaluator that scores a citizen's evening
**And** no decider-specific decision machinery exists

**Given** freedom scales inversely with supervision, so the least supervised post should be the most interesting
**When** decider posts are designed
**Then** they follow that rule rather than contradicting it

**Given** deciders answer questions by reading the world
**When** a decider diagnoses a problem
**Then** they count open matters in a ward, read an account balance, count unfilled postings, read a facility's stock against capacity, or count occupied against vacant dwellings
**And** no statistics table is required for any of these

**Given** a statistics table would be a materialised view rather than a data source
**When** one is proposed
**Then** it is justified by a measured performance problem or it is not built

### Story 10.6: Scoring a Matter

As a player,
I want the officer who knows me to take my complaint more seriously,
So that favouritism exists without anybody building a favour system.

**Acceptance Criteria:**

**Given** matter scoring weighs severity, age, cost against available budget, jurisdiction fit, disposition and who raised it
**When** a decider scores their inbox
**Then** all six terms contribute, and their weights are balance parameters in a table

**Given** the who-raised-it term reads the decider's own citizen memory
**When** a complaint comes from somebody the officer knows
**Then** it scores higher
**And** institutional favouritism emerges with no system built for it

**Given** there is nothing to farm
**When** a player attempts to exploit this
**Then** the only route is genuinely knowing the officer, through the habit mechanism from Story 5.12

**Given** age rises so nothing starves
**When** a low-severity matter sits long enough
**Then** it eventually outscores newer higher-severity ones

**Given** scoring is pure
**When** it is tested
**Then** it runs in CI with no database, and a property test asserts no matter starves indefinitely

### Story 10.7: Approve, Deny, Defer, Escalate

As a player,
I want a budget request to be genuinely deniable,
So that institutional friction is the story rather than an obstacle to it.

**Acceptance Criteria:**

**Given** all four actions are first-class
**When** a decider acts on a matter
**Then** approve, deny, defer and escalate are each available and each has real consequences

**Given** a denied budget request is institutional friction working as designed
**When** a request is denied
**Then** the chain stalls, and the consequence lands on citizens who never saw the paperwork

**Given** deferral is not a black hole
**When** a matter is deferred
**Then** it becomes part of the demand signal the calendar's budget review drains
**And** deferring is a real choice rather than a way to make a problem disappear

**Given** escalation moves a matter to a different jurisdiction
**When** a decider escalates
**Then** it appears in that jurisdiction's inbox rather than vanishing

### Story 10.8: Decision Records and Material Change

As a developer,
I want a denial to be remembered by its severity rather than by a timer,
So that repeat requests are governed by the world changing rather than by a cooldown.

**Acceptance Criteria:**

**Given** a decision record carries the action, a reason code and the severity at the time of the decision
**When** a decision is made
**Then** all three are stored

**Given** re-raising the same request for the same scope scores near zero
**When** a manager considers re-raising
**Then** it scores near zero unless current severity exceeds the severity at denial by a margin
**And** the margin is a balance parameter

**Given** this is material change rather than a timer
**When** the world does not worsen
**Then** the request is not re-raised, however much time passes

**Given** the record is structurally identical to citizen memory
**When** the world moves past it
**Then** it self-obsoletes in the same way

**Given** reason codes are an extensible set
**When** a new one is needed
**Then** it is a row insert

### Story 10.9: Responses to Denial

As a player,
I want an institution under budget pressure to visibly degrade into stopgaps,
So that austerity is something I can see rather than something I am told.

**Acceptance Criteria:**

**Given** four trait-weighted responses to denial exist
**When** a manager is denied
**Then** they wait, escalate, substitute a cheaper mechanism, or reroute permanently, according to their traits

**Given** waiting is gated on caution
**When** a cautious manager is denied
**Then** they accept and re-raise only on material worsening

**Given** escalation is gated on ambition
**When** an ambitious manager is denied
**Then** they re-raise with a different jurisdiction, over their head

**Given** substitution is gated on diagnostic breadth
**When** headcount is denied for lack of budget
**Then** the manager requests overtime instead
**And** the diagnostic offered several options at different costs, so denying the expensive one made the cheap one relatively more attractive

**Given** rerouting follows from a reason code of wrong jurisdiction
**When** that code is returned
**Then** the manager now knows this jurisdiction was never right, and future matters of that kind go elsewhere

**Given** stopgaps emerge from a cost comparison rather than being authored
**When** budget pressure is sustained
**Then** the institution visibly shifts to overtime instead of hiring, and patching instead of resurfacing

### Story 10.10: Burial

As a player,
I want some problems to simply stay unsolved,
So that the city is honest about what institutions do not fix.

**Acceptance Criteria:**

**Given** a condition fixed by another route buries its matters
**When** a different chain, a business tidying up, or a citizen binning the bottle resolves it
**Then** complaints stop, severity decays, and the matters expire

**Given** severity may plateau below the denial mark
**When** a street stays bad and nobody re-raises
**Then** the problem persists indefinitely
**And** this is the story rather than a defect

**Given** matters expire after a stated number of in-city weeks if unresolved and unrefreshed
**When** expiry runs
**Then** the matter is removed, satisfying the table's declared bound

**Given** the request and the evidence are different objects
**When** a request is denied
**Then** the denial closes the chain and does nothing to the complaints
**And** complaints keep arriving because the condition persists and people keep walking past it

**Given** the world regenerates the signal
**When** a manager needs to raise the issue again
**Then** they do not need to, because fresh complaints arrive on their own
**And** no cooldown timer exists anywhere in this mechanism

### Story 10.11: Institutional Chain Templates

As a player,
I want a decision in one building to become work in another,
So that the machine is visibly made of linked jobs.

**Acceptance Criteria:**

**Given** the chain engine exists from Story 6.5
**When** institutional chains are added
**Then** they are templates in `defs/` and the engine is not modified

**Given** the canonical chain runs investigation, approval, budget, procurement, logistics and labour
**When** a chain of this shape runs
**Then** each link is an occupation with its own work loop

**Given** each link is holdable by an AI citizen or a player with no mechanical seam
**When** v1 ships
**Then** chains run AI-staffed end to end, and players experience them from the receiving end
**And** the seam does not exist, so Epic 13 can put a player on a link without a rebuild

**Given** chains survive restarts, deploys and multi-day latency
**When** the module is republished mid-chain
**Then** the chain resumes correctly

**Given** friction is the narrative
**When** chains are observed over an in-city month
**Then** some stall, some are denied and some are expedited

### Story 10.12: The Sanitation Round

As a player,
I want to drive the bin lorry,
So that I am the labour end of the loop rather than only its audience.

**Acceptance Criteria:**

**Given** the sanitation round is route order, lift, empty, log and depot return
**When** the player works the shift
**Then** each is a procedure on objects, following the four-beat template

**Given** the job requires a vehicle and a route
**When** it is built
**Then** it is the first job needing both, and the vehicle uses the grid from Story 6.14

**Given** the job fails badly as missed bins, spillage and wrong route order
**When** the player performs badly
**Then** those consequences are physical and visible on the street
**And** nothing scores them

**Given** the tip step reads landfill capacity
**When** the landfill approaches capacity
**Then** the step branches to emit a worker escalation, per Story 10.3

### Story 10.13: Bins and Litter

As a player,
I want a bin that fills and litter that lies where it fell,
So that the city's state is carried by objects.

**Acceptance Criteria:**

**Given** bins carry state
**When** a bin fills
**Then** its state is visible on the bin itself

**Given** litter is a physical entity
**When** a bottle is dropped
**Then** it exists as an object at a place, with an author

**Given** litter accretes when sanitation fails
**When** the sanitation chain is under-resourced
**Then** litter accumulates through citizens dropping things, never by fiat

**Given** the litter table needs both bounds
**When** they are declared
**Then** the game-mechanical bound is the sanitation chain, and the engineering ceiling is a hard per-chunk cap so a failed chain cannot fill the database

**Given** litter is produced per consumption event
**When** the rate is set
**Then** it is a balance parameter tunable on a running world

### Story 10.14: Broken Windows

As a player,
I want one dropped bottle to make the next one more likely,
So that a street's decline is something I can watch happen.

**Acceptance Criteria:**

**Given** litter licenses litter
**When** litter is present at a place
**Then** the probability of a citizen dropping something there rises

**Given** the loop is reversible
**When** the sanitation chain clears the street, or any citizen bins a bottle
**Then** the licensing effect falls with it

**Given** Story 8.11 already built the civic verb
**When** a player bins a bottle here
**Then** it works with no change to that story's code
**And** one person, one bottle, one street is a genuine reversal

**Given** the street degrades as litter accumulates
**When** degradation crosses a visible threshold
**Then** the change is legible from the street itself

**Given** the equilibrium law requires something actively pursuing the equilibrium
**When** litter accumulates
**Then** the sanitation chain is actively working to clear it
**And** a state where nothing pursues it is a defect

### Story 10.15: Response Time Is a Budget Line

As a player,
I want the ambulance to be slow because of a decision I never saw,
So that the city's indifference is legible rather than merely asserted.

**Acceptance Criteria:**

**Given** response time depends on a decision made in a building the player has never entered
**When** an emergency occurs
**Then** the response time follows from the responsible service's staffing and equipment, which follow from budget decisions

**Given** the causal chain must be inspectable
**When** the player asks why the response was slow
**Then** the answer traces back through staffing to a specific denied or approved matter
**And** the matter inspector can show it

**Given** the player is on the receiving end in v1
**When** they experience a slow response
**Then** they can read the cause in the world without being told it

### Story 10.16: Welfare and Shelters

As a player,
I want the bottom of the city to be a place with its own life,
So that falling is arriving somewhere rather than losing.

**Acceptance Criteria:**

**Given** welfare offices and shelters are simulated institutions
**When** they exist in the district
**Then** they are staffed, have procedures, and run like any other institution

**Given** destitution is a place with its own routines and community
**When** a player reaches it
**Then** there is a life there rather than a failure screen

**Given** the mechanism that rescues a failing player is a career path for a thriving one
**When** these institutions are built
**Then** their roles are ordinary occupations, holdable by a player from Epic 13

**Given** Ruin By Process from Story 7.9 routes here
**When** the process runs its course
**Then** the player ends up inside these institutions rather than outside the game

### Story 10.17: The Matter and Chain Inspector

As a developer,
I want to see an institution's inbox and the state of its chains,
So that a stalled city is diagnosable.

**Acceptance Criteria:**

**Given** the inspector registers with Epic 1's overlay framework
**When** it is opened on an institution
**Then** it shows the open matters in that jurisdiction with their scores and score components

**Given** chains span in-city days
**When** the inspector is opened on a chain
**Then** it shows the current step, the occupation responsible, and how long it has been there

**Given** a stalled chain is content rather than an error
**When** one is stalled
**Then** the inspector shows why without flagging it as a fault

**Given** the causality inspector from Story 5.17 answers why a citizen is somewhere
**When** that citizen is a decider acting on a matter
**Then** the two inspectors join up, so the matter is visible as the reason

### Story 10.18: The Plastic-Bottle Loop

As a player,
I want to watch a budget shortfall become a dirty street I walk down,
So that the whole thesis of the game is visible in one commute.

**Acceptance Criteria:**

**Given** the reference chain runs end to end
**When** it is exercised
**Then** a sanitation budget shortfall leaves a bin unemptied, which licenses a dropped bottle, which degrades the street, which triggers complaints, which opens a budget chain

**Given** every link has an author
**When** the loop is traced
**Then** each step names the citizen who performed it, with no step occurring by detection

**Given** the loop can be denied
**When** a finance officer denies the sanitation manager's headcount request
**Then** the trash stays
**And** the reason is a conversation in a building the complainant has never entered

**Given** the player reads it on the commute
**When** they walk to work over successive in-city days
**Then** they can observe the street's decline and, later, its recovery or its persistence
**And** at no point is any of it reported to them

**Given** unprompted noticing is the metric that matters most and is hardest to instrument
**When** the loop runs with a player present
**Then** the instrumentation defined in Story 4.14 captures what it can
**And** an honest judgement is recorded on whether a player noticed without being asked

**Given** this is the vertical slice that mitigates the project's headline scope risk
**When** the epic closes
**Then** a written assessment records whether the slice demonstrates the thesis

---

## Epic 11: Transit and the Full Roster

Five playable jobs, real transit with routes and timetables, and a city that sounds like somewhere with its own business.

**This epic marks the MVP boundary.** After it, the district has its full content breadth: five playable jobs, real transit, 100+ interiors, institutions running.

**It completes FR14's roster.** The till came in Epic 7, the guard in Epic 8, the sanitation round in Epic 10. The night bus driver and the cafe barista land here - the second vehicle-and-route job, and the deepest procedure in the game.

**The barista is A1's canonical case.** Grind, dose, tamp, pull, steam, serve is the sequence the interaction model was prototyped against in Story 8.3. If the model holds anywhere, it holds here; if it does not, this is where that shows.

**Audio is a legibility channel, not decoration.** A tram heard but never seen is evidence the city is running, and it extends the player's sensor past the screen edge for almost nothing.

### Story 11.1: Routes and Stops

As a player,
I want tram and bus routes that actually go places,
So that the city has a circulatory system rather than a set of walkable distances.

**Acceptance Criteria:**

**Given** transit legs are edges on the macro graph emitted in Epic 3
**When** routes are defined
**Then** they run over those edges with costs denominated in minutes

**Given** stops are nodes on the graph
**When** a stop is placed
**Then** it is a transit node, and citizens routing through it consume the leg's duration

**Given** the district is 512 by 512 cells
**When** routes are laid out
**Then** they connect the residential edges to the commercial core, so the commute they serve is the one people actually make

**Given** citizens use transit as well as players
**When** a citizen's route includes a transit leg
**Then** they board, ride and alight, and their derived position follows the vehicle

### Story 11.2: Timetables

As a player,
I want the tram to be late because something happened,
So that the timetable is a promise the city can fail to keep.

**Acceptance Criteria:**

**Given** services run to a timetable
**When** a service is scheduled
**Then** it departs and arrives at stated in-city times

**Given** a timetable can be missed
**When** a vehicle is delayed, or a driver post is unfilled
**Then** the service runs late or does not run
**And** this is content rather than an error

**Given** service level follows from resourcing
**When** a budget decision changes the number of vehicles or drivers
**Then** the timetable changes with it, traceable through the matter that caused it

**Given** waiting costs minutes
**When** a player arrives at a stop between services
**Then** they wait in real time, and the wait is part of the commute's cost

### Story 11.3: Riding Transit

As a player,
I want to get on the tram and watch the city go past,
So that a faster commute changes what I read rather than whether I read.

**Acceptance Criteria:**

**Given** the player boards a service
**When** they ride it
**Then** they travel with the vehicle and the world moves past them

**Given** faster transport changes what is read rather than whether
**When** the player switches from walking to transit
**Then** the route passes different streets than the walk did

**Given** the destination is known before arrival
**When** the player is in transit
**Then** the destination region is prefetched during the journey, per Story 5.7

**Given** fares are paid per trip in this epic
**When** the player boards
**Then** they pay, in cash or by card, using the mechanisms from Epic 6
**And** the transit pass that changes this arrives in Epic 12

**Given** the subway is a floor beneath the street
**When** the player descends
**Then** the street floor is culled and the subway is revealed, per Story 1.7

### Story 11.4: The Night Bus Driver

As a player,
I want to drive the last bus of the night,
So that the emptiest hours of the city have somebody in them.

**Acceptance Criteria:**

**Given** the job is route, stops, timing, doors and fares
**When** the player works the shift
**Then** each is a procedure on objects, following the four-beat template

**Given** the job fails badly as running early, missed stops and harsh braking
**When** the player performs badly
**Then** those consequences are real: passengers left at stops, a service ahead of its timetable
**And** nothing scores them

**Given** running early is a genuine failure rather than efficiency
**When** the player arrives at a stop before its scheduled time
**Then** waiting is the correct action, and leaving early strands the people who arrived on time

**Given** passengers are citizens with reasons to travel
**When** they board
**Then** each has a destination and a reason, answerable by the causality inspector

**Given** this job is available as a borrowed night shift
**When** a player takes it through Story 9.7
**Then** it works identically, because the driver slot is the same slot

### Story 11.5: The Cafe Barista

As a player,
I want to pull a shot properly,
So that the deepest procedure in the game is worth doing well.

**Acceptance Criteria:**

**Given** the job is grind, dose, tamp, pull, steam and serve
**When** the player makes a drink
**Then** each step is performed on an object in sequence, using the interaction model resolved in Story 8.3

**Given** this is the canonical case that model was prototyped against
**When** the job is played
**Then** it is assessed explicitly against whether procedure feels like handling
**And** a negative read here reopens Story 8.3 rather than being absorbed

**Given** the job fails badly as a bad shot, burnt milk and a wrong order
**When** the player performs badly
**Then** the drink is worse, the customer has it anyway, and nothing is scored

**Given** props carry state
**When** the hopper empties or the machine needs attention
**Then** it is visible on the object, and a reorder is emitted below threshold

**Given** recipes convert inputs plus labour minutes into outputs
**When** a drink is made
**Then** it consumes beans and milk from the cafe's own stock, per Epic 6

**Given** recognisability depends on meeting the same person repeatedly
**When** a player is a regular at a cafe
**Then** the same barista serves them
**And** when the player works the counter, their own regulars emerge the same way

### Story 11.6: Hospitals and Injury

As a player,
I want being hurt to cost me days and savings,
So that there is a real consequence that is not death.

**Acceptance Criteria:**

**Given** there is no death
**When** the player is injured
**Then** they lose days and savings, and recover

**Given** hospitals are institutions with chains
**When** the player is treated
**Then** paramedic, triage, nurse, surgeon, admin and billing are occupations in a chain, staffed like any other

**Given** being hurt puts the player inside the machine from the other side
**When** they are treated
**Then** they experience the institution as its subject rather than its operator

**Given** response time is a budget line
**When** an ambulance is called
**Then** its arrival time follows from the service's resourcing, per Story 10.15

**Given** treatment costs money
**When** billing runs
**Then** the cost settles against the player's balance, and falling short routes into Ruin By Process rather than into a failure

### Story 11.7: Ambient Beds

As a player,
I want the city to sound different in different places,
So that I can hear where I am.

**Acceptance Criteria:**

**Given** audio uses Web Audio directly or a very thin wrapper
**When** the client is built
**Then** no full audio library is added, because the bundle weight is not available against the boot budget

**Given** ambient beds crossfade by environment, neighbourhood character and time of day
**When** the player moves between neighbourhoods or the hour changes
**Then** the bed crossfades rather than cutting

**Given** neighbourhood character comes from the four generator parameters
**When** the bed is selected
**Then** it follows density, building age, affluence and land-use mix

**Given** audio assets are sourced rather than composed
**When** they are packaged
**Then** they are content-hashed, service-worker cached and loaded by neighbourhood, like atlases
**And** they version under the same `defs_version`

### Story 11.8: Stepping Indoors

As a player,
I want the street to go quiet when I close the door behind me,
So that inside and outside are different places.

**Acceptance Criteria:**

**Given** the interior and exterior transition is a low-pass filter
**When** the player steps indoors
**Then** the exterior bed is filtered rather than swapped
**And** this is the GDD's room tone that changes when you step indoors

**Given** the transition follows the same enclosure state the renderer uses
**When** the player crosses a threshold
**Then** audio and rendering change together, reading the same derived state

**Given** there is no separate audio simulation
**When** audio state is determined
**Then** it is derived from the same world state the renderer reads

### Story 11.9: Positional Sound and Diegetic Music

As a player,
I want music to come from a radio somebody switched on,
So that everything I hear is something in the world.

**Acceptance Criteria:**

**Given** there is no composed score and no music system
**When** music plays
**Then** it comes from a positional emitter such as a radio or a busker

**Given** a radio is an object
**When** it is playing
**Then** the sound attenuates with distance and stops if the object stops

**Given** positional one-shots come from world events near the player
**When** an event occurs
**Then** the sound plays at its position

**Given** no non-diegetic audio exists
**When** any music cue, sting or feedback sound is proposed
**Then** it is rejected, on the same grounds as a HUD element

### Story 11.10: Earshot

As a player,
I want to hear a tram I cannot see,
So that the city is evidently running beyond the edge of my screen.

**Acceptance Criteria:**

**Given** earshot is deliberately larger than the viewport
**When** a tram passes just off screen
**Then** the player hears it

**Given** this extends the player's sensor past the screen edge for almost nothing
**When** the radius is set
**Then** it is a deliberate design parameter rather than a side effect of attenuation

**Given** audio is a legibility channel
**When** the city is busy beyond the screen
**Then** it sounds busy
**And** when it is quiet, it sounds quiet

**Given** sound sources beyond the body zone have no instantiated bodies
**When** they are heard
**Then** the sound derives from the same ledger state that would have produced a body, so nothing is heard without a cause

### Story 11.11: The MVP District

As a player,
I want a district with five jobs, real transit and institutions running,
So that there is a whole small city to be in.

**Acceptance Criteria:**

**Given** the five-job roster is complete
**When** the player looks for work
**Then** convenience shop till, security guard, sanitation round, night bus driver and cafe barista are all available and all playable

**Given** four of the five need a single interior and no vehicle
**When** the roster is reviewed
**Then** the build cost matches that, with only the sanitation round and the night bus requiring vehicles and routes

**Given** the district holds 100+ enterable interiors
**When** the player explores
**Then** they are furnished, occupied and in use rather than merely enterable

**Given** institutions are present and staffed
**When** the player visits
**Then** shops, cafes, the depot, the council, a hospital, a welfare office and shelters are all running with citizens in their posts

**Given** job access tiers are the project's primary scope valve
**When** the roster is set
**Then** the tier mechanism exists so that the job count remains a dial rather than a commitment

**Given** this is the MVP boundary
**When** the epic closes
**Then** a written assessment records whether the district reads as a place to live in rather than a demo of systems

---

## Epic 12: A Life

A player with spare minutes has three genuinely different things to spend them on, and a shelf that shows it.

**This is where money becomes minutes and minutes become a life.** The transport ladder is priced so that one-time purchases buy minutes efficiently and recurring costs do not - which is exactly why housing's real value is proximity to a life rather than proximity to work.

**Three pursuits, deep rather than many.** Cooking, collecting, and a sport or club. **Places is deliberately not among them**: it was the only candidate with no physical carrier, and dropping it retires the stated exception to the physical-carrier law, which now stands unqualified.

**Pursuits enter the own-time catalogue built in Story 5.15**, shared with citizens. The cafe has people in it because citizens spent their own time there, and the player's pursuits are drawn from the same list.

**The stated tension, carried from the GDD.** P1 pushes the player to buy the commute down, but the commute is the loop's variance source. Optimise perfectly and you see less of the city. This is a deliberate trade, resolved three ways: the commute has a floor, faster changes *what* you read rather than whether, and the sensor migrates to institutional position in Epic 13.

### Story 12.1: The Bike

As a player,
I want a bike to be a raise in the only thing that is scarce,
So that my first real purchase is time rather than a stat.

**Acceptance Criteria:**

**Given** the bike costs 450 as a one-time purchase
**When** the player has saved roughly two weeks of surplus
**Then** they can buy it

**Given** the bike halves the walking commute
**When** the player rides it
**Then** the 60 in-city minute leg becomes 30, returning one in-city hour per day
**And** own time rises from 6 to 7 in-city hours, a gain of about 17 per cent

**Given** the transport mode is an edge-cost modifier on the macro graph
**When** the player rides
**Then** their route cost is recomputed over the same graph the citizens route on
**And** no separate player transport system exists

**Given** payback is roughly 6.4 weeks against the entry wage
**When** the economics are checked
**Then** the bike is a good buy on minutes, and demonstrably so

**Given** the bike is an object
**When** the player owns one
**Then** it exists in the world, is parked somewhere, and can be seen

### Story 12.2: The Transit Pass

As a player,
I want a weekly pass that is only just worth it,
So that the decision is a real one rather than an obvious one.

**Acceptance Criteria:**

**Given** the transit pass costs 20 per week
**When** the player holds one
**Then** they ride without paying per trip, using the transit built in Epic 11

**Given** the pass returns roughly 20 in-city minutes per day
**When** the exchange rate is computed
**Then** it is about 8.7 per hour against a wage of 10 per hour, making it a marginal buy

**Given** recurring costs buy minutes less efficiently than one-time purchases
**When** the pass is compared against the bike
**Then** the difference is visible in the arithmetic rather than asserted

**Given** the commute has a floor of roughly 20 in-city minutes per leg
**When** the player holds a pass and rides
**Then** the commute reaches that floor and goes no lower

### Story 12.3: The Housing Ladder

As a player,
I want a closer flat to be a bad deal on minutes and a good deal on life,
So that where I live is about what is near me rather than about my commute.

**Acceptance Criteria:**

**Given** a closer flat costs roughly 130 per week more in rent
**When** the exchange rate is computed
**Then** it returns about 20 in-city minutes per day at roughly 56 per hour, which is a poor deal against a wage of 10

**Given** the housing ladder takes over once the transport ladder runs out
**When** the commute is near its floor
**Then** the top rung buys only about 5 per cent more own time over the bike
**And** housing stops competing on minutes

**Given** housing's real value is proximity to a life
**When** the player considers moving
**Then** what is within walking distance matters: their pursuits, their people, their usual places

**Given** desirability tracks physical state and demand, and rent follows
**When** a neighbourhood's physical state changes
**Then** its rents move, bounded by a maximum change per period
**And** that ceiling is where pressure is legible but never sharp actually lives

**Given** rent is set by individual landlords rather than by a city-wide rate
**When** a rent changes
**Then** a landlord decided it, responding to their own local information

### Story 12.4: The Flatshare

As a player,
I want to split the rent with somebody,
So that my first friendship is a financial instrument.

**Acceptance Criteria:**

**Given** rent can be split through a shared tenancy
**When** two people share
**Then** 250 per week becomes 125 each

**Given** this is the cheapest social content in the design
**When** it is built
**Then** it is a shared tenancy record and a split, with no new systems

**Given** it is a genuine economic decision rather than flavour
**When** the player considers it
**Then** halving the metronome materially changes their weekly surplus
**And** the trade is sharing the space and whatever comes with that

**Given** a flatmate may be a citizen or another player
**When** either shares
**Then** the mechanism is identical, because no mechanical seam exists between them

**Given** a tenancy can end
**When** a flatmate leaves
**Then** the rent reverts, visibly and with notice, rather than silently

### Story 12.5: Cooking

As a player,
I want to get good at cooking by cooking,
So that a skill is something I have rather than something I bought.

**Acceptance Criteria:**

**Given** cooking is buy ingredients, learn dishes by doing, and build a kitchen worth cooking in
**When** the player cooks repeatedly
**Then** dishes come out better through the procedure being performed rather than through a level rising

**Given** the diegetic carriers are the right pan and food that comes out well
**When** the player progresses
**Then** the evidence is the kitchen they have assembled and the meals they produce
**And** no skill number exists anywhere

**Given** ingredients are items and cooking is a recipe
**When** the player cooks
**Then** it uses the stock and recipe systems from Epic 6, consuming inputs and labour minutes

**Given** cooking is cheaper than eating out
**When** the player cooks regularly
**Then** their weekly necessities cost falls
**And** the pursuit indirectly buys minutes back

**Given** citizens share the own-time catalogue
**When** a citizen cooks at home
**Then** they use the same system

### Story 12.6: Collecting

As a player,
I want a shelf that fills up,
So that the progress bar is a physical object in my flat.

**Acceptance Criteria:**

**Given** collecting is acquisition and display, with plushies as the reference case
**When** the player acquires one
**Then** it is an item they own and can place

**Given** the shelf is the progress bar
**When** the player displays their collection
**Then** the shelf itself shows how far they have got
**And** no completion percentage, count or checklist exists

**Given** collectibles are placed in the world on surfaces
**When** they are displayed
**Then** they are visible in-world and sub-tile positioned, sorting above the furniture they rest on

**Given** collecting gives money a use that is not minutes
**When** the player spends on it
**Then** the spending buys nothing in time, deliberately

**Given** acquisition happens through the economy
**When** a plushie is bought
**Then** it comes from a business holding stock, purchased like anything else

### Story 12.7: A Sport or Club

As a player,
I want a fixture I have to show up for,
So that my week has a shape somebody else set.

**Acceptance Criteria:**

**Given** a club is a scheduled, recurring, social commitment
**When** the player joins
**Then** it appears on their calendar at a fixed in-city hour, like a shift

**Given** the reference case is a golf tournament
**When** the player attends
**Then** it is a real event at a real place with other people present

**Given** the diegetic carriers are a trophy, a scorecard and a standing fixture
**When** the player progresses
**Then** those objects are the evidence

**Given** membership costs fees and a real time cost at a fixed hour
**When** the player joins
**Then** the fee recurs and the fixture competes with everything else in their own time

**Given** citizens have calendars too
**When** the club meets
**Then** the citizens who are members attend, because it is on their calendar as an obligation

**Given** the fixture is fixed
**When** the player cannot make it
**Then** they miss it, and it happens without them

### Story 12.8: Diegetic Carriers, No Counters

As a player,
I want everything I have achieved to be a thing in the world,
So that there is nothing to optimise except my life.

**Acceptance Criteria:**

**Given** there is no experience bar, no level, no skill tree and no net-worth display
**When** the game is audited
**Then** none exists, in DOM or in canvas

**Given** progression is carried diegetically
**When** the player wants to know how they are doing
**Then** they look at their shelf, their kitchen, their trophy, or their flat

**Given** the canvas may draw only transient object-bound views
**When** any persistent, global or abstract element is proposed
**Then** it is rejected structurally, because there is nowhere to put it

**Given** a player optimising for money is optimising something the design neither rewards nor shows
**When** wealth accumulates
**Then** it has no display and no acknowledgement

**Given** the review gate carries this rule
**When** any counter, percentage, tally or completion indicator is proposed
**Then** it is rejected

### Story 12.9: Three Genuinely Different Things

As the solo developer,
I want to know whether spare minutes have somewhere worth going,
So that the late game's breadth is tested rather than assumed.

**Acceptance Criteria:**

**Given** the player has roughly 15 real minutes of own time per day, rising to about 17.5 with the bike
**When** they have spare minutes
**Then** cooking, collecting and a club are each available and each genuinely different in what they ask

**Given** pressure becomes self-imposed rather than evaporating
**When** the player is established
**Then** a closer flat, club fees and a kitchen worth cooking in each cost enough that surplus does not grow unboundedly
**And** the player could always live cheaply and bank the difference, and chooses not to

**Given** the late game becomes wider rather than harder
**When** the player is past the opening
**Then** no system has added late-game pressure to keep the game interesting
**And** any proposal to do so is rejected on the grounds that the problem would be breadth of choice, not absence of threat

**Given** the minute-spend split is one of the five gameplay metrics
**When** the player spends own time
**Then** the instrumentation from Story 4.14 emits how it divided
**And** the qualification arm of that split arrives in Epic 13, completing the metric

**Given** places was deliberately dropped as the only pursuit with no physical carrier
**When** any new pursuit is proposed
**Then** it must name its physical carrier or it is not built

**Given** honest judgement is the deliverable
**When** the epic closes
**Then** a written read records whether a player with spare minutes has somewhere they want to spend them

---

## Epic 13: Careers

A player can spend their evenings qualifying for a post, wait for it to open, take it, and make decisions in it that outlast them.

**This closes the A3 gap**, which the GDD accepted as a known deferral: at launch, players could observe institutional chains but not staff one, so P2's most distinctive half shipped unplayable. The architecture found this **far cheaper to close than the GDD assumed** - a decider is not a different kind of agent, only a citizen whose work-time option set is matters instead of procedure steps. Epic 10 already built the inbox, the scoring, the four actions and the chain templates. Putting a player in that slot is an addition, not a rebuild.

**The central choice of the game lives here.** Roughly 15 real minutes of daily own time are contested between becoming someone the city needs and having a life. That contest recurs every day rather than being made once in a menu.

**The sensor migrates.** Early game the player reads the city by walking through it. Late game they read it through the paperwork that crosses their desk. This is the answer to how the game avoids going quiet between early lateral pursuit and late institutional position: the thing that shows you the city changes hands rather than switching off.

**Accepted trade, stated plainly.** Dependency is carried by decisions, not by presence, so **nobody is literally waiting on you**. This fully protects P3 and P2, and it deliberately weakens the felt fantasy of being missed. The alternative - a degraded AI backfill - was considered and rejected because it would make players and AI mechanically distinguishable.

### Story 13.1: Qualification

As a player,
I want to spend my evenings becoming qualified for something,
So that advancement costs me the only thing that is scarce.

**Acceptance Criteria:**

**Given** qualification is a licence, certificate or course for a role
**When** the player pursues one
**Then** it is taken out of their own time, in in-city minutes

**Given** advancement is bought with time rather than with skill points
**When** the player studies
**Then** the minutes come from the same block their pursuits compete for

**Given** qualification costs minutes and never money alone
**When** a wealthy player attempts to shortcut it
**Then** they cannot, because a rich player cannot buy a career
**And** any fee attached is incidental rather than sufficient

**Given** evening classes happen at a place at a time
**When** the player attends
**Then** they travel there, it occupies a fixed in-city hour, and missing it means missing it

**Given** qualification is always available to work on
**When** the player has no vacancy to apply for
**Then** there is still something to progress
**And** this is one of the three mitigations against the two-gate wall

### Story 13.2: Vacancy

As a player,
I want the post I want to be occupied by somebody,
So that getting it means somebody left rather than a slot unlocking.

**Acceptance Criteria:**

**Given** a vacancy is an actual open post in an actual institution
**When** a post is vacant
**Then** it is vacant because its holder left, retired, moved or died

**Given** the city has roughly 344 workplaces and roughly 69 professions
**When** vacancies are counted
**Then** they arise at a rate consistent with real citizen churn rather than being generated for the player

**Given** an unfilled post is a matter in its owner's inbox
**When** it stays open
**Then** the employer responds through the mechanisms built in Story 5.16, including raising the offer

**Given** the player may be qualified and still blocked on timing
**When** this happens
**Then** it is the designed two-gate structure rather than a defect
**And** the night shift and lateral pursuits fill the interval

**Given** city growth opens new posts as the active player population rises
**When** more players arrive
**Then** vacancy pressure eases exactly when player pressure increases
**And** the mechanism arrives in Epic 14

### Story 13.3: Application and Hiring

As a player,
I want to apply and be chosen by somebody,
So that getting the job is a decision another person made.

**Acceptance Criteria:**

**Given** a vacancy requires an application
**When** the player applies
**Then** the application is a matter in the hiring decider's inbox

**Given** the decider scores it like any other matter
**When** they act
**Then** they use the scoring from Story 10.6, including the who-raised-it term reading their own citizen memory

**Given** knowing the hiring manager helps
**When** the player has a habit with them
**Then** their application scores higher
**And** the only route to that is genuinely knowing them

**Given** an application can be denied or left in the tray
**When** either happens
**Then** it is content rather than a failure, and the player may apply elsewhere or again on material change

**Given** citizens apply for the same posts
**When** a vacancy opens
**Then** the player competes with them, and the same scoring decides

### Story 13.4: Career Carriers

As a player,
I want my qualifications to hang on my wall,
So that who I have become is furniture rather than a number.

**Acceptance Criteria:**

**Given** progression carriers are diegetic
**When** the player qualifies
**Then** the certificate is on their wall and the licence is in their wallet, as objects

**Given** holding a post has its own carriers
**When** the player is hired
**Then** their name is on a roster and they are issued a set of keys

**Given** the keys are the ones others wait on
**When** the player holds a post with access
**Then** the keys open what the post opens, physically

**Given** no career progress display exists
**When** the player wants to know where they stand
**Then** they look at their wall, their wallet, their keyring and the roster
**And** no level, rank, title bar or progression indicator exists anywhere

**Given** the outfit layer is role-driven
**When** the player takes a post
**Then** their appearance reflects it, and others can read their occupation by looking

### Story 13.5: Job Access Tiers

As the solo developer,
I want the job count to be a dial,
So that the project's primary scope valve is usable rather than theoretical.

**Acceptance Criteria:**

**Given** job access tiers are the project's primary scope valve
**When** they are implemented
**Then** which roles are player-holdable is configuration rather than code

**Given** adding a player-holdable role should be an addition rather than a rebuild
**When** a new role is opened to players
**Then** it requires a profession definition and a tier assignment, and nothing else

**Given** every role already has an AI holder
**When** a role is not player-holdable
**Then** it still runs, held by its citizen
**And** opening it later changes nothing about how it works

**Given** the valve should be used deliberately
**When** scope pressure arises
**Then** the tier configuration is the named place to relieve it

### Story 13.6: The First Player-Holdable Decision Link

As a player,
I want to be the person who approves or denies the thing,
So that I occupy the machine rather than only observing it.

**Acceptance Criteria:**

**Given** a decider is a citizen whose work-time option set is matters
**When** a player takes a decider post
**Then** their shift presents the open matters in their jurisdiction, scored, and they act on them

**Given** the driver slot is the same slot
**When** a player holds a decider post
**Then** approve, deny, defer and escalate behave identically to when a citizen held it
**And** no mechanical seam exists between the two

**Given** the first candidate is the council permits clerk or a development-chain role
**When** the first link is opened
**Then** it is one of those, chosen for being a genuine link in a chain the player has already watched from the receiving end

**Given** the player's decisions have consequences that land on citizens who never saw the paperwork
**When** the player denies a request
**Then** the condition persists, complaints keep arriving, and somebody's street stays bad

**Given** the player may leave the post
**When** they do
**Then** a citizen takes it and works it exactly as well
**And** nothing degrades because a player stopped holding it

**Given** the discretionary middle must be discretionary within the procedure's state space
**When** a player acts as a decider
**Then** every action available corresponds to a state the system can represent

### Story 13.7: Positional Consequence

As a player,
I want the decisions I made to outlast my presence,
So that I am load-bearing through consequence rather than through attendance.

**Acceptance Criteria:**

**Given** dependency is carried by decisions rather than by presence
**When** the player logs off after approving a budget
**Then** the approval persists and the chain it started continues

**Given** the player's absence changes nothing about how the post is worked
**When** they are away
**Then** an AI holds it exactly as well, because P2 forbids any mechanical seam

**Given** what persists is the choices made while present
**When** the player returns
**Then** the budget they approved, the route they scheduled, the application they expedited or left in the tray have all had their effects

**Given** nobody is literally waiting on the player
**When** this trade is assessed
**Then** it is recorded as deliberate: the alternative of a degraded AI backfill was rejected because it would break P2
**And** if players report the fantasy of being needed feels hollow, the finding returns to design rather than being patched by degrading the backfill

**Given** decisions are recorded with their author
**When** a decision's history is inspected
**Then** the player who made it is named, permanently

### Story 13.8: The Sensor Migrates

As a player,
I want my desk to show me the city once my commute stops doing it,
So that the game does not go quiet as I optimise my travel.

**Acceptance Criteria:**

**Given** early game the player reads the city by walking through it
**When** their commute nears its floor
**Then** they see less of the street than they did

**Given** late game the player reads the city through the paperwork that crosses their desk
**When** they hold an institutional post
**Then** the matters in their inbox tell them about places they have not walked

**Given** the sensor changes hands rather than switching off
**When** the transition happens
**Then** there is no interval in which the player has neither sensor

**Given** matters carry their origin
**When** the player reads one
**Then** they can tell which street, which business and which citizen it came from

**Given** twelve complaints about one street are the aggregate
**When** the player scores their inbox
**Then** volume tells them where the city hurts, without a statistic being computed

### Story 13.9: The Wall Risk

As a player,
I want there always to be something to work on,
So that two gates never read as a locked door.

**Acceptance Criteria:**

**Given** two gates mean a qualified player can be blocked on timing
**When** no vacancy is open
**Then** qualification for the next role is available, so there is never nothing to do

**Given** the night shift is always available and always pays
**When** the player is waiting
**Then** that route exists and works

**Given** lateral pursuits fill the interval
**When** the player is between posts
**Then** cooking, collecting and the club are all available

**Given** the wall risk is real
**When** playtesting occurs
**Then** time spent qualified-but-blocked is measured
**And** if it reads as a wall despite the three mitigations, the finding reopens the gating structure

### Story 13.10: The Central Choice

As the solo developer,
I want to know whether the daily contest is a real one,
So that the design's central tension is verified rather than assumed.

**Acceptance Criteria:**

**Given** roughly 15 real minutes of own time per day are contested between qualification and a life
**When** the player chooses
**Then** both are genuinely attractive and both cost the same minutes

**Given** the minute-spend split is one of the five gameplay metrics
**When** own time is spent
**Then** the instrumentation from Story 4.14 emits how it divided between qualification and lateral pursuit
**And** this completes the metric begun in Story 12.9

**Given** a heavy skew either way means one side is underpriced
**When** the split is read
**Then** a skew is treated as a balance finding rather than as a player preference

**Given** the contest recurs every day rather than being made once in a menu
**When** the player plays across an in-city month
**Then** they face the choice repeatedly and may answer differently on different days

**Given** a census clerk as a producer role for statistics was deferred with v1 set to no, to be revisited here
**When** this epic is planned
**Then** the decision is revisited and recorded either way
**And** if taken, it becomes a player-holdable post where stale information is a staffed bottleneck

**Given** public office and private ownership are one mechanic under two labels and belong to a later tier
**When** they are proposed
**Then** they are deferred, and the tier mechanism from Story 13.5 is the place they would arrive

---

## Epic 14: Growth

The city grows because the player population grew, so there is always somewhere affordable to begin.

**Gentrification is a feature, and this epic is its answer.** The loop - physical state to desirability to rent to demographics to physical state - is genuinely wanted: rising desirability makes players congregate, which is the social outcome the design is after. The failure it threatens is not the drift but the **entry point**. If the whole map gentrifies, a new player has nowhere affordable to begin and the opening fantasy stops being true.

**So the ratchet is not damped. Supply is added instead.**

**This passes the Truth Test, and the reasoning matters.** Growth keyed to active player count reads at first like the city special-casing itself around players. It is not. **Players are citizens.** More players is more population; more population is housing pressure; housing pressure is development. The causal chain is genuinely real and the city responds to it exactly as a city does. No exception is carved out and no fiction is papered over.

**Scope.** Growth in v1 means new neighbourhoods adjacent to the first, not new districts. Districts beyond the first are out of scope entirely.

### Story 14.1: Housing Pressure

As a player,
I want the city to notice that there is nowhere to live,
So that growth has a cause rather than a schedule.

**Acceptance Criteria:**

**Given** housing pressure is counted rather than computed
**When** a decider needs to know whether pressure exists
**Then** they count occupied dwellings against vacant ones
**And** no statistics table is required

**Given** players are citizens
**When** the active player population rises
**Then** the citizen population rises with it, and housing pressure follows
**And** no mechanism references player count directly

**Given** the causal chain must survive inspection
**When** growth is traced back
**Then** every link is a real cause: more people, fewer rooms, higher rents, a developer noticing

**Given** pressure is read by people
**When** it becomes visible
**Then** a citizen in a role noticed it, at a place, at a time

### Story 14.2: The Developer's Decision

As a player,
I want somebody to decide to build,
So that a new neighbourhood is a decision rather than an event.

**Acceptance Criteria:**

**Given** a developer role acts on housing pressure
**When** the pressure crosses their threshold
**Then** they start a development chain, and they are a named citizen

**Given** the developer is a decider
**When** they act
**Then** they use the matter inbox and scoring built in Epic 10, with no new decision machinery

**Given** the development chain is the natural home for a player-holdable decision-link role
**When** job access tiers are configured
**Then** this role is a candidate, via the mechanism from Story 13.5

**Given** the decision can go the other way
**When** a developer judges the pressure insufficient or the budget unavailable
**Then** nothing is built, and the pressure persists

### Story 14.3: The Development Chain

As a player,
I want building a neighbourhood to take as long as building a neighbourhood takes,
So that watching it happen is the content.

**Acceptance Criteria:**

**Given** the development chain runs survey, approval, budget, procurement and construction
**When** it advances
**Then** each link is an occupation with its own work loop, on the engine from Story 6.5

**Given** the chain can stall, be denied or be expedited
**When** any link is denied
**Then** the neighbourhood is not built, and the reason is a decision in a building most people never enter

**Given** procurement moves real goods
**When** materials are needed
**Then** they are ordered through the order chains from Story 6.6, and a supplier orders across the boundary

**Given** construction requires labour at an offered wage
**When** the chain reaches it
**Then** citizens take the work through the labour market from Story 5.16

**Given** the chain spans in-city weeks
**When** the server restarts or the module is republished mid-chain
**Then** it resumes correctly

### Story 14.4: Incremental Generation

As a developer,
I want new ground generated by the same passes as the old,
So that extension is the generator running again rather than a second system.

**Acceptance Criteria:**

**Given** the same multi-pass generator runs over the new area
**When** a neighbourhood is generated
**Then** it runs land use, street network, plot subdivision, building envelope, building type, interior layout and prop placement

**Given** the new area must join what exists
**When** it is generated
**Then** it is constrained by adjacency to the existing district, and streets connect

**Given** new neighbourhoods run under the current rule-set version
**When** the district is extended long after the original generation
**Then** the new area may look visibly different from the old
**And** this is welcome rather than a defect, because it is how cities actually look and it gives the growth mechanism free historical texture

**Given** the city records the rule-set version each area was generated under
**When** areas are inspected
**Then** each carries its own version

**Given** determinism must survive an arbitrary patch history
**When** the city is reproduced from seed plus patch log
**Then** it matches
**And** the determinism harness from Story 3.14 covers the extended district, not only the original

### Story 14.5: Construction Is Visible

As a player,
I want to watch the buildings go up,
So that the city growing is something I see rather than something I find.

**Acceptance Criteria:**

**Given** construction is physically visible
**When** a development proceeds
**Then** sites, hoardings and scaffolding appear, and buildings arrive over in-city time

**Given** the player watches the city grow rather than finding a new area already there
**When** they walk past a site repeatedly
**Then** it has changed since last time

**Given** a construction site is an obstacle
**When** it occupies street space
**Then** it affects routing, and citizens re-route around it through the belief mechanism from Story 5.13

**Given** roadworks and hoardings are publicly announced
**When** a route is closed for construction
**Then** barriers, diversion signs and notices are the physical carriers, and fresh routes legitimately know

**Given** construction is performed by citizens
**When** it advances
**Then** builders are on site, working, visible

### Story 14.6: The Nav Graph Grows

As a developer,
I want the routing graph patched rather than rebuilt,
So that extension does not invalidate the city people are living in.

**Acceptance Criteria:**

**Given** the patch format and log were defined in Story 3.15
**When** the graph is extended
**Then** the change is recorded as a patch in that format
**And** this is the first epic that writes one

**Given** structural change is content here rather than an edge case
**When** a street is added, closed or reopened
**Then** the graph is patched incrementally

**Given** no route invalidation machinery exists
**When** the graph is patched
**Then** citizens with cached routes hit the change and re-route, and citizens computing fresh routes use the patched graph
**And** no edge-to-routes index or propagation is introduced

**Given** the patch log's compaction decision was taken in Story 3.15
**When** the log grows here
**Then** that decision is exercised and its bound holds
**And** if periodic re-baselining proves insufficient, the finding returns rather than the bound being raised silently

**Given** the walkability grid is per floor and derived from footprints
**When** new ground is generated
**Then** the grid is extended rather than regenerated

### Story 14.7: New Businesses

As a player,
I want somebody to open a shop because there is demand for one,
So that the economy grows from inside rather than being topped up.

**Acceptance Criteria:**

**Given** a new business is an own-time decision by a citizen
**When** a citizen with savings considers it
**Then** they weigh unmet local demand, vacant premises rent, capital and qualifications, using the evaluator from Story 5.10

**Given** the decision is made with local information
**When** they decide
**Then** nothing coordinates it and no aggregate view is consulted

**Given** a new business is a holder with its own stock
**When** it opens
**Then** it holds stock on the business instance, sets its own prices, and posts its own vacancies

**Given** a business can fail
**When** it does
**Then** its citizen memory rows are deleted by indexed fan-out, per Story 5.12
**And** successive tenants do not inherit stale knowledge

**Given** new businesses appear where demand is unmet
**When** a new neighbourhood is built
**Then** businesses open in it because the people living there need things

### Story 14.8: In-Migration

As a player,
I want new people to arrive because the city has jobs and rooms,
So that population is a consequence rather than a setting.

**Acceptance Criteria:**

**Given** in-migration is exogenous and belongs to the boundary from Story 6.7
**When** people arrive
**Then** it is the outside world pressing in, modulated by the city's attractiveness

**Given** people move to cities that have jobs and rooms
**When** the city has unfilled postings and vacant dwellings
**Then** in-migration rises
**And** when it has neither, it falls

**Given** L1 has no access to player state
**When** in-migration is computed
**Then** it reads the aggregate view the outside has of the city, never the player

**Given** newcomers have not habituated to a degraded street
**When** they arrive in one
**Then** they file complaints at the undecayed rate, regenerating the signal from Story 10.2

**Given** arrivals and departures are both real
**When** a citizen leaves
**Then** their row is deleted with no tombstone, satisfying the table's bound

### Story 14.9: Gentrification Stays Desirable

As a player,
I want a nice neighbourhood to be genuinely nicer and still not lock anyone out,
So that the loop the design wants does not break the thing it needs.

**Acceptance Criteria:**

**Given** the gentrification loop is deliberately undamped
**When** physical state improves
**Then** desirability rises, rents follow, demographics shift, and physical state improves further

**Given** the ratchet is answered by supply rather than by damping
**When** rents rise across the district
**Then** new neighbourhoods add affordable stock

**Given** the entry point is what must be protected
**When** a new player arrives at any time
**Then** somewhere affordable exists for them to begin

**Given** rent changes are bounded by a maximum change per period
**When** a neighbourhood gentrifies
**Then** existing residents see the change coming
**And** this is where pressure is legible but never sharp actually lives

**Given** no reset mechanism exists anywhere in the design
**When** the loop runs for in-city years
**Then** supply is the only thing preventing an undamped ratchet from becoming permanent
**And** if supply cannot keep pace, the finding returns to design rather than the loop being damped

### Story 14.10: Watch a Neighbourhood Get Built

As a player,
I want to walk into a place that was not there when I started,
So that the city I live in is visibly still being made.

**Acceptance Criteria:**

**Given** the full chain from pressure to occupancy
**When** it runs end to end
**Then** population pressure produces a survey, an approval, a budget, procurement and construction, and finally a neighbourhood people live in

**Given** the player is part of the pressure that caused it
**When** they trace the cause
**Then** it leads back through housing pressure to a population that includes them
**And** no step references them as a player

**Given** the player watches rather than being told
**When** they commute past the site over in-city weeks
**Then** they see hoardings go up, structures rise, and the hoardings come down
**And** nothing announces any of it

**Given** the new neighbourhood is generated under current rules
**When** the player walks into it
**Then** it reads as newer than the old district, deliberately

**Given** businesses open and people move in
**When** the neighbourhood is finished
**Then** it fills with citizens who have homes, jobs, schedules and ends of their own

**Given** this is the last epic of the MVP
**When** it closes
**Then** a written assessment records whether the city reads as a place that was running before the player arrived and will keep running after they close the tab
