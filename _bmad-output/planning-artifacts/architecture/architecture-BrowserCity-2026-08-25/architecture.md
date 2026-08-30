---
title: 'Game Architecture'
project: 'BrowserCity'
date: '2026-08-25'
author: 'Adrian'
version: '1.0'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9]
status: 'complete'
engine: 'SpacetimeDB v2.8.3 (Rust module) + PixiJS v8.19.0 (TypeScript client)'
platform: 'Browser, exclusive'

# Source Documents
gdd: '_bmad-output/planning-artifacts/gdds/gdd-BrowserCity-2026-08-25/gdd.md'
epics: '_bmad-output/planning-artifacts/epics/index.md'
brief: '_bmad-output/planning-artifacts/briefs/brief-BrowserCity-2026-08-24/brief.md'
---

# Game Architecture

## Executive Summary

**BrowserCity** is a persistent, browser-based life-and-city simulation. The architecture targets **SpacetimeDB v2.8.3** with a **Rust** module and a **PixiJS v8.19.0 / TypeScript** thin client, on a browser-exclusive platform.

### The six decisions everything else follows from

1. **Authority follows consequence.** Anything that cannot change the ledger runs client-side — player movement, the L3 micro brain, rendering, audio. The server owns records and nothing per-frame.
2. **There is no shared code between client and server.** Authority splits by consequence, not by language, so no common logic exists. Players collide sub-tile on the client; NPCs route on the navmesh server-side and never collide.
3. **L1 is the boundary.** Everything inside the city is done by a person with local information. L1 is only what has no author inside the simulation: external prices, in-migration, weather. Market clearing and allocation dissolve into individual employer and business decisions.
4. **Every state change has an author.** If you cannot name the person who did it, it does not happen. No reducer detects a condition and acts on it without a citizen in between.
5. **Citizens act on stale belief.** They discover the world by moving through it. This replaces cache invalidation everywhere it would otherwise appear, and it is the design's legibility channel.
6. **The schema is additive only.** Primary keys are permanent; columns are appended with defaults; new concepts are new tables with read-through backfill. The world never resets, so every change is a live migration.

### Shape

**21 decisions** (D1–D21 plus D-VIS, D-L3, D-ANIM), one deferred to measurement.
**9 novel patterns**, each recurring in two or more decisions.
**7 verification tasks** outstanding — the architecture states plainly which of its numbers are measured and which are arithmetic.

**Project structure:** domain-driven within two build targets, organised around boundaries. The load-bearing rule is `sim/` is pure and `reducers/` touches tables — the only boundary in the project that can be violated silently.

**Ready for:** epic revision and implementation.

### What this document hands back to design

Five items, recorded in full at their decision points: social continuity across long absence (a fortnight offline is an in-city year) · labour-market depth against neighbourhood population · **A3's chain-link gap is far cheaper to close than the GDD assumed**, since a decider is a citizen with a matter inbox · **stock and logistics is absent from `epics.md`** and is now load-bearing · the architectural dependency order disagrees with the epic order, and E5 already needs NPC capability regardless.

---

## Document Status

**Complete.** Produced through the GDS Architecture Workflow, 2026-08-25 to 2026-08-28.

**Steps Completed:** 9 of 9 — Initialize · Project Context · Engine & Framework · Architectural Decisions · Cross-cutting Concerns · Project Structure · Implementation Patterns · Validation · Completion

All technology versions were verified against live sources during the workflow, with dates recorded at each decision.

All Step 4 decisions taken except D18 (sharding), deferred to measurement.

---

## Project Context

### Game Overview

**BrowserCity** — a persistent, browser-based life-and-city simulation. The player is an ordinary citizen in a city that ticks continuously whether or not anyone is connected. Significance is positional, never attitudinal.

Core fantasy: *you live an ordinary life in a city that does not need you — and slowly become someone it depends on.*

### Technical Scope

**Platform:** Browser, exclusive and non-negotiable (no install, plugin, or download gate)
**Genre:** Persistent multiplayer simulation (MMO-shaped, low concurrency)
**Project Level:** High complexity — persistent authoritative world, continuous simulation, hard boot-latency constraint, solo developer with agentic assistance

### Technical Requirements

| Requirement | Target |
|---|---|
| Cold boot to player-controllable | **< 1 second**, mid-range laptop, domestic connection |
| Sustained frame rate | 60 FPS @ 1080p, 10-min session including rush hour |
| Server tick | Continuous; never spins down; runs with zero clients connected |
| Reconnection | Zero seam; kinematic continuity |
| Networking | Client-server, fully server-authoritative; thin client |
| Input | Mouse and keyboard only |
| Monthly spend | Bounded, self-funded, sustained for years pre-revenue |
| Maintainability | Uniform, data-driven, heavily testable — agent-extensible by construction |

**Networking shape.** One persistent world, not sessions. No matchmaking, lobbies, PvP or rollback. This is a *persistent shard* problem, not a session-netcode problem — which changes which solutions are relevant.

### Committed Platform Decision (input to Steps 3–4)

**SpacetimeDB** is the chosen multiplayer/persistence platform. **Module language: Rust**, chosen because per-agent performance is the binding constraint on A2 and the agentic team carries the iteration cost that Rust imposes.

Consequences already established:

- The **ledger is tables**; records-everywhere is the native mode, not an optimisation
- **Client subscription queries are interest management**; the body zone is a subscription
- **Scheduled reducers** run with zero clients — satisfies "the city always ticks" (`#60`)
- L2's event-scheduled mode maps directly onto scheduled reducers — idiomatic, not a workaround
- **Persistence and the server are the same thing** — the separate persistence system collapses into the server, leaving three obligations: live-world schema migration, state growth/compaction, and backup/restore

Open for Step 3/4: client stack (TypeScript SDK + WebGL renderer expected; Unity WebGL likely disqualified by the boot target), table-vs-module data placement, hosting model. All SpacetimeDB capability, limit and pricing specifics must be verified against live sources before decisions are locked.

### Core Systems

| # | System | Complexity | Reference |
|---|---|---|---|
| S1 | Browser render client — oblique 16×16, layer-aware depth sort | Medium | E1 |
| S2 | Tile semantics + adjacency grammar + validation harness | High | E2 |
| S3 | Deterministic seeded city generation | High | E3 |
| S4 | Authoritative server, continuous tick, subscriptions, reconnection (absorbs persistence) | High | E4 |
| S5 | ~~Variable-resolution simulation~~ — **collapsed into S6.** Resolution follows attention via *body instantiation*, not via variable L2 advancement | — | D7, D9 |
| S6 | Ledger/body separation — derived positions, spatio-temporal region queries | Very High | `#56`, E8 |
| S8 | In-city clock authority | Low | E5 |
| S9 | **Interactable object state + procedure machine** (till change, stamp ink, hopper) | Medium | E6 |
| S10 | Institutional chain **process engine** — durable multi-step workflows | High | E9 |
| S11 | Reciprocal occupancy — understudy, AI backfill, absence reconciliation | High | E7 |
| S12 | Economy & labour market — **numeric** equilibrium-seeking | Medium-High | E8 |
| S13 | Data-driven **declaration formats** (jobs, procedures, props, buildings, professions) | Medium | `#63` |
| S15 | Observability / telemetry for the five gameplay metrics | Medium | Metrics |
| S16 | Incremental city extension | Medium-High | E13 |
| S17 | **L1 — the simulation boundary**: external prices, in-migration, weather *(revised by D14 — clearing and allocation dissolved)* | Medium | D14 |
| S18 | **L2 — citizen macro brain**, step-by-step at transitions *(revised by D7 — dual-mode withdrawn)* | Very High | E8 |
| S19 | **L3 — micro brain**: steering, local avoidance, flavour behaviours | Medium-High | E8 |
| S20 | Hierarchical navigation — minute-costed macro graph + micro tile pathing | High | E3/E8 |
| S21 | Nav graph lifecycle — generated, versioned, incrementally patched, route invalidation | High | E3/E13 |
| S22 | Layered collision model — tile stacks, layer index, transitions, triggers | High | E1/E2 |
| S23 | Offline footprint/semantic authoring pipeline for tiles and props | Medium-High | E2/E3 |

*(S7 folded into S4; S14 reclassified from a system to a cross-cutting budget — see below.)*

### The NPC AI Stack

The simulation is driven by working humans, so NPC AI is the engine, not a subsystem. Three layers, distinguished by **cadence and instantiation**, not by subject matter.

| Layer | Scope | Cadence | Runs where | Cost scales with |
|---|---|---|---|---|
| **L1 — Causal coordinator** | *(Superseded by D14 — market clearing and allocation dissolved into employer and business decisions; L1 reduced to the simulation boundary: external prices, in-migration, weather)* | Slow | Always, everywhere | Exogenous inputs only |
| **L2 — Citizen macro brain** | Goals, schedule, employment, needs | **At transitions only** — scheduled table; never ticked | Always, for **every** citizen | **Citizen count** — this is A2 |
| **L3 — Micro brain** | Steering, local avoidance, gait, flavour behaviour | Frame-rate | **Only instantiated bodies in observed regions** | **Screens**, not database |

**One L2, one advance mode.** *(Revised by D7 — the earlier "two advance modes" formulation is withdrawn.)* Every citizen advances identically: at transitions, via the scheduled table. Nobody ticks. A citizen in transit carries `(route, t_depart, t_arrive)`, and **clients interpolate for rendering**. This satisfies `#66/#67` ("one simulation, variable resolution — never a separate background approximation") more strongly than the original design did, because there are no longer two modes to keep in agreement: **resolution follows attention through body instantiation (D9), not through variable simulation.**

**L1 has a causal mandate, not a narrative one.** L1 is *not* a storyteller or director. A director shapes events for the audience, which directly violates the Truth Test (`#61`) and P2. L1 is the actor that the equilibrium-seeking law already requires, because no individual agent can clear a labour market or allocate housing. **L1 has no access to player state.** Recognisability ("the same barista") and the geographic social graph are *allocation* properties that fall out of stable assignment — no narrative intent needed.

**Hard rule: L3 may never write to the ledger.** Micro state is non-authoritative and discardable; despawn snaps to the ledger. Without this rule, reconciliation becomes a merge problem. With it, it is a projection.

### Body Instantiation — the derived-position model

There is **no simulation zone**. L2 runs for everyone, everywhere, always. Only *bodies* have a zone. A far agent is therefore never unpositioned — it is positioned by derivation rather than integration:

| Far-agent L2 state | Row shape | Position at time *t* |
|---|---|---|
| In transit | `(route, t_depart, t_arrive)` | interpolate along the macro path |
| At a place | `(location, t_start, t_end)` | the location |

Populating a region is a **query, not a promotion**: *which agents' route segments or located activities intersect region R at time t?* Every result gets a body at its derived position, each with a genuine inspectable reason to be there — `#60` as specified.

**Three consequent constraints:**

1. **Index, don't scan.** Route traversals are indexed by macro-edge and time interval, so the query is a range lookup. Cost scales with *occupancy of R*, not with population.
2. **Prefetch along intent, not position.** Subscribe ahead of the player. The subway is the canonical case: destination and arrival time are known before arrival, so the destination region is warmed during transit.
3. **Margin with hysteresis.** The body zone extends past the viewport and despawns lazily, so citizens walk in rather than pop in.

### A2, restated

The derived-position model guarantees that everyone present has a *reason* to be present. It does **not** guarantee there are *enough* of them for a rush-hour street to read as busy. The only Truth-Test-legal remedy is more citizens — "extras" without ledger presence are authored into being by proximity and are prohibited.

Therefore A2 inverts:

> **A2 is not "how many citizens can we afford?" It is "how many citizens does the busiest screen at rush hour require in order to read as busy — and can we make that number affordable?"**

The design constraint sets the floor; architecture makes the floor cheap. If it cannot, that is a finding to return to the GDD, not a knob to quietly turn down. Budget model:

```
cost ≈ N_citizens × (L2 event throughput)
     + N_observed_bodies × (L3 tick cost)
     + L1
```

L3 is capped by concurrency and L1 is near-constant, so **A2 reduces almost entirely to L2's per-event cost and event rate** — answerable by benchmark rather than by argument.

### Navigation

**Two layers, hierarchical.**

- **Macro (routing) graph.** Nodes = intersections, building entrances, transit stops, interior portals. Edges = street segments and transit legs. **Edge cost is denominated in minutes.**
- **Micro (local) pathing.** Tile-level, within one street segment or room, **only for instantiated bodies**. Far agents consume the macro graph's *duration* and never path.
- **Interiors** attach as separate small graphs joined by **portals** (doors), so interiors do not pollute the city graph.

**Path cost and the game's only currency are the same unit.** The transport ladder (bike, transit pass, closer flat) is an edge-cost modifier on the macro graph, so M3's "transport and housing as one optimisation" is literally a shortest-path problem over the same graph the AI routes on. One system serves the commute tax, agent routing, and the economy.

**Lifecycle:**

1. The nav graph is a **generation output** (E3), emitted alongside geometry.
2. It is **versioned and incrementally patchable** — structural change is *content* here (E13 growth, construction hoardings, road works from chains), not an edge case.
3. **Route invalidation on patch.** An agent mid-commute when a street closes re-plans — exactly the legible friction the design wants.
4. **Determinism:** the graph must be reproducible from seed + patch log, or E13 breaks the "same seed → same city" promise.

### Collision and the Layer Model

**This is not physics.** No rigid bodies, forces, joints or continuous solvers — nothing in the GDD requires them, and a physics engine would spend authoritative server tick budget on unused capability. What is required is tile-based collision with discrete elevation layers: static solidity per cell, a layer index per cell and entity, explicit transition cells, swept-AABB movement resolution, and trigger volumes.

**Tile stacks, not a tile grid.** The same `(x, y)` holds a cell on layer 0 (road, with a manhole cover) and a cell on layer 1 (bridge deck). **Collision only tests within the entity's current layer.** You pass under the bridge because the deck is not in your layer's set; you descend the manhole because the cover is a transition cell.

**This is foundational and must land in E1.** It changes the world representation, the renderer's depth sort, the nav graph (one sub-graph per layer, joined at transitions) and E2's tile semantics. Retrofitting a layer axis after E3 would be prohibitive.

**Depth sorting is a separate problem from layering.** Layer index resolves *manhole vs. bridge*; **y-anchor sorting** resolves *the coat hanger* (same elevation, draw order depends on relative position). Two rules make it work:

1. The tilemap splits into **flat ground layers** (always beneath) and **y-sorted objects with anchors**. Props must be objects; a prop baked into a flat layer can never sort correctly.
2. **Multi-cell props decompose into per-cell drawables**, each with its own anchor — the fix for wide objects (a long counter) where the player should be in front at one end and behind at the other.

**Combined sort key: `(layer_index, anchor_y, tiebreak)`.**

### Collision Authoring Pipeline (S23)

**Inference happens exactly once, offline.** Collision is never derived at spawn time.

| Stage | Artifact | When |
|---|---|---|
| **Build time** | Per-tile / per-prop **footprint table** — authored once, versioned, diffable, testable | Offline, committed |
| **Generation time** | Per-district **collision map** — generator places props, looks up footprints, composites | Once per seed, cached |
| **Run time** | Lookup into an immutable-until-patched collision map | Never infers |

**Footprint representation: base-anchored AABB** — one rectangle, occasionally two. Movement is continuous, so tile-granular collision snags on corners and blocks whole cells for a lamppost. Bitmasks are over-precise and awkward with swept tests; polygons cost more than top-down needs. In oblique projection the footprint is essentially always a rectangle at the base of the sprite.

**Authority is prop identity, not pixels.** In an oblique projection with front-facing bias, a sprite's silhouette is not its footprint.

**Pipeline:** auto-propose from alpha coverage of the sprite's lower band → agent classifies against archetypes and corrects → **validate with invariants** → contact-sheet review.

**Invariants (the failure detector):**

- every prop has a nonzero footprint *or* appears on an explicit walkable allow-list (manhole, rug, doormat, floor decal) — catches "trash can with no collision"
- rects lie within sprite bounds
- doorway cells leave a passable gap ≥ character width
- **graph reachability over the generated district** — no walkable region enclosed without a door. Catches most real failures, including "manhole with collision"

### Complexity Drivers

**Very High — no off-the-shelf pattern:**

1. **Resolution follows attention** (S6/S18) — one L2 advancing identically for everyone, with cost varying through *body instantiation* rather than through variable simulation
2. **Ledger/body separation** (S6) — a first-class architectural split, applied to absent players too
3. **The A2 budget** — citizen count × always-on cost, back-solved from required visual density

**High:**

4. **1-second cold boot vs. asset streaming** (A4) — constrains bundle, atlas pipeline, subscription scope
5. **A world that never resets** — live schema migration against irreplaceable state; unbounded state growth
6. **Deterministic generation that extends incrementally** (E13) without invalidating the lived-in city
7. **Institutional chains as durable long-running workflows** surviving restarts, deploys and multi-day latency
8. **Agent-maintainable by construction** (`#63`) — shapes the architecture, not just coding standards
9. **The layer axis is foundational and early** — must land in E1
10. **Dynamic navigation is a feature** — graph patching and route invalidation are core

**Novel concepts requiring custom patterns:**

- Reciprocal occupancy — role occupancy as a swappable controller
- Player/AI mechanical indistinguishability at the role level
- Equilibrium-seeking as a *mandated property* of every bounded quantity — needs one uniform controller pattern, or agents will implement it five different ways
- Diegetic-only state (no HUD) — all player-facing state must be readable as world objects

### Cross-Cutting Budgets

**The boot budget is a constraint applied from the first commit, not a system built later.** It constrains renderer choice, bundle size, asset format and initial subscription scope throughout. Treated as a standing budget against which every decision is checked, replacing the earlier framing of streaming as a late system.

### Technical Risks

| # | Risk | Source |
|---|---|---|
| A2 | Citizen count and monthly cost — **owned by this workflow** | GDD |
| A4 | 1-second boot achievability — **owned by this workflow** | GDD |
| A5 | The generator's rules are the entire content pipeline; no hand-authored fallback | GDD |
| R1 | Schema evolution on a never-reset world — every change is a live migration | New |
| R2 | Unbounded state growth over multi-year uptime (litter, records, post, municipal memory) — the storage corollary of the equilibrium law | New |
| R3 | **Generation determinism** (narrowed in Step 3) — scoped to the generator, not to client/server logic, which cannot diverge because no code is shared. Breaks from floating-point across toolchain versions, `HashMap` iteration order, RNG changes under dependency bumps. Mitigated by integer/fixed-point arithmetic, ordered collections, a pinned RNG, versioned rule sets. Consequential only for E13 incremental extension, since the city is generated once and persisted | New |
| R4 | Single-process tick ceiling — "one process suffices" vs. "the district must shard" changes everything | New |
| R5 | Identity vs. the boot budget — "no character creation" plus persistent characters implies an auth round-trip inside 1 second | New |
| R6 | **Coordinator drift** — L1 is where a director would creep in under scope pressure. Needs an explicit architectural prohibition on player-state access | New |
| R7 | **L2/L3 handover seam** — popping works against the "noticing" channel the design depends on. Mitigated by the L3-never-writes-ledger rule | New |
| R8 | **Nav graph determinism under patching** — seed reproducibility must survive an arbitrary patch history | New |
| R9 | **Prop metadata as a silent-failure surface** — wrong footprints fail quietly. Mitigated by invariants, not review | New |
| R10 | **SpacetimeDB vendor and maturity risk** — single vendor, young platform, unknown cost-per-citizen at scale. A2 makes this measurable | New |

### Architectural Dependency Order

The order in which systems can be built, derived from dependency rather than from design priority. Where it disagrees with the epic breakdown in `epics/`, that disagreement is a signal to return there.

| Phase | Contents |
|---|---|
| **0 — Foundations** | Boot budget as a standing constraint · world data model (layer index, tile stacks, sort anchors) · collision model + footprint table format · **player movement and collision resolution** · SpacetimeDB module and schema skeleton |
| **1 — Content pipeline** | Tile/prop semantics + footprint authoring + validation harness (S2, S23) · declaration formats (S13) · city generation emitting geometry + occupancy + nav graph (S3, S20) |
| **2 — The wire** | Authoritative loop, subscriptions/interest management, reconnection, migration and compaction policy (S4) · in-city clock (S8) |
| **3 — One NPC** | L3 micro brain + micro pathing — one NPC walks a street believably (S19) · body instantiation/despawn from records · the L3-never-writes-ledger rule |
| **4 — A citizen** | L2 macro brain, step-by-step (S18) · derived positions + region queries (S6) |
| **5 — A population** | L1 causal coordinator (S17) · economy and labour market (S12) · nav graph patching and route invalidation (S21) |
| **6 — The player's day** | Interactable state + procedure machine (S9) · reciprocal occupancy (S11) |
| **7 — Institutions** | Chain process engine (S10) |
| **8 — Growth** | Incremental city extension (S16) |

**Runtime dependency runs L1 → L2 → L3; build order runs L3 → L2 → L1.** One NPC walks convincingly, then it gets a day, then a city of them gets coordinated.

**Recorded tension.** This spine places NPC work before the day loop, whereas the GDD front-loads E5/E6 as falsification points. Architecture dependency and design risk pull opposite ways. Note also that **E5's first job (convenience shop till: serve, scan, bag, take payment) requires customers** — so E5 already implicitly depends on Phase 3 NPC capability, independently of this ordering. Worth resolving in `epics/` before it surfaces as a surprise.

---

## Engine & Framework

### Selected Stack

**Server:** SpacetimeDB v2.8.3 — module in **Rust**
**Client:** **PixiJS v8** (v8.19.0) + TypeScript, via the `spacetimedb` npm SDK

**Rationale.** SpacetimeDB collapses the game-server/database split, making the ledger native and subscription queries serve as interest management. Rust is chosen for the module because per-agent cost is the binding constraint on A2, and the agentic team carries the iteration cost Rust imposes.

PixiJS over Phaser 4 on bundle size — ~450 KB vs ~1.2 MB against a 1-second cold-boot budget — and because Phaser's framework value (physics, scenes, audio, input) sits largely in areas the server owns or the design does not use. The client is a thin renderer by design, so a renderer rather than a framework is the correct shape.

**Bevy → WASM ruled out.** 15–30 MB WASM binaries after `wasm-opt` are disqualifying against A4. Recorded explicitly because "Rust on both sides" is the obvious-looking answer and is wrong for exactly one reason.

### No Shared Client/Server Core

Authority is split by **consequence**, not by language, so there is no common logic to share. The real boundary is collision vs. navigation:

| | Player | NPC |
|---|---|---|
| Granularity | Sub-tile, continuous | Tile-level |
| Mechanism | Collision resolution against footprints | **Routing** on the navmesh |
| Location | Client | Server |

NPCs route rather than collide, so **the server performs no sub-tile collision for any entity**. Two independent parsers over the shared footprint table is accepted and cheap.

This also removes the client/server half of R3. What remains of that risk is generation reproducibility only — see Technical Risks.

### Authority Model

**Authority follows consequence: anything that cannot change the ledger runs client-side.**

| Concern | Owner | Note |
|---|---|---|
| L1 causal coordinator | Server | No player-state access (R6) |
| L2 citizen macro brain | Server | Event-scheduled reducers |
| All records / the ledger | Server | Authoritative, persistent |
| NPC routing | Server | Navmesh, tile-level |
| Player movement + collision | **Client** | Fully authoritative; no server validation |
| **L3 micro brain** | **Client (provisional)** | See open decision D-L3 |
| Rendering, animation, audio | Client | |

Consequences: the server performs no per-frame work; player movement does not consume server tick budget.

**Accepted trade — anti-cheat on position.** Client authority permits teleporting and wall-clipping. Deliberately unmitigated: no PvP, no death, no competition. The one real exposure is that commute time is the currency, so teleporting mints minutes. **No server-side plausibility checking in v1** — implement only if cheating is observed in practice.

### Open Decision D-L3 — where the micro brain runs

**Provisional: client-side.**

*For client-side:*

- **Egress.** Server-side L3 replicates micro-movement to every client in range: ~200 agents × 20 Hz × ~16 B ≈ 64 KB/s per client ≈ **166 GB/month for one continuously-connected player**, against Maincloud Pro's ~500 GB/month. Client-side L3 transmits L2-level data only — orders of magnitude less.
- L3 cost scales with connected clients, not with the always-on bill.
- The server performs no per-frame work at all.

*Against:*

- Client compute for ~200 agents in a busy bubble — estimated well under 2 ms/frame with spatial-hashed avoidance, but unverified. Principal risk is GC pressure, not throughput.
- Cross-client behavioural divergence.

*Divergence analysis.* Steering (derived from the L2 path and timing) and flavour triggers (`hash(npc_id, tick_bucket)`) are deterministic across clients. **Local avoidance is not**, because bubbles differ between viewers. Fix if needed: scope avoidance to a fixed tile region rather than to the viewer's bubble, so any two clients covering region R agree by construction.

*Governing principle:* **L2 defines what everyone must agree on; L3 defines what nobody checks.** Position and activity are L2 and identical for all viewers; sub-tile pathing around an obstacle is not compared between players.

**Falsification.** Overturned if the ~200-agent client frame budget exceeds ~2 ms, or if divergence proves visible in playtest. **Measured in Phase 3** (one NPC → many), before anything depends on it.

### Engine-Provided Architecture

| Category | Solution | Provided by |
|---|---|---|
| Persistence | Tables; server and database are one system | SpacetimeDB |
| Replication / interest management | Subscription queries, mutable at runtime | SpacetimeDB |
| Continuous tick with zero clients | Scheduled reducers | SpacetimeDB |
| Transactions | Reducers are transactional | SpacetimeDB |
| Transient high-frequency state | Event tables (published to subscribers, then deleted) | SpacetimeDB |
| Reconnection handling | TS SDK: `visibilitychange`/`focus`/`online`/`pageshow`, dead-socket rebuild, exponential backoff | SpacetimeDB |
| Schema migration | Automigration | SpacetimeDB |
| Rendering | WebGPU with WebGL fallback; experimental Canvas renderer | PixiJS v8 |
| Tilemap rendering | `@pixi/tilemap` | PixiJS |
| Physics | **Not used** — tile collision + layer index, hand-rolled | — |
| Scene / input / audio | **Hand-rolled** — thin, because logic is server-side | — |

### Remaining Architectural Decisions

- Table-vs-module data placement (nav graph, collision map, footprint table)
- Hosting model against the bounded monthly spend (Maincloud Pro/Team vs. self-host)
- Identity and auth inside the 1-second boot budget (R5)
- Initial subscription scope — the dominant controllable term in cold boot
- Position update rate and event-table shape
- Live schema migration policy on a never-reset world (R1)
- State growth and compaction policy (R2)
- Sharding: whether one module suffices or the district must split (R4)
- D-L3 resolution (above)

### Cost Model

| Tier | Price | Credit | ≈ Function calls | ≈ Egress | ≈ Storage |
|---|---|---|---|---|---|
| Free | $0 | 2,500 TeV | ~3 M/mo | ~12.5 GB | ~1 GB |
| **Pro** | **$25/mo** | 100,000 TeV | ~120 M/mo | ~500 GB | ~40 GB |
| Team | $250/mo | 250,000 TeV | ~300 M/mo | — | — |

Overage beyond credit: 2,592 TeV per dollar. Storage ~$1/GB/month. Energy billing began January 2026.

**Caution on deriving A2 from these figures.** The published TeV-per-call conversion describes trivial calls and is not a valid model for the write volumes this design produces — SpacetimeDB documents 1,000 concurrent players at 60 Hz (~60,000 writes/s) as a target case, three orders of magnitude beyond what the conversion implies. **The A2 budget equation stands; its coefficients must be benchmarked, not derived.** First two measurements: cost-per-L2-event, and cost-per-position-write.

### Platform Status and Risk

SpacetimeDB v2.8.3 (~25 August 2026); release cadence roughly weekly (v2.7.1 Jul 30 → v2.8.0 Aug 5 → v2.8.1 Aug 12 → v2.8.2 Aug 18 → v2.8.3 Aug 25). Rust client SDK at 2.8.2. TypeScript SDK is the `spacetimedb` npm package; `@clockworklabs/spacetimedb-sdk` is deprecated.

Recent releases touch primitives this design depends on directly: **scheduled-function drift fixed in both v2.7.1 and v2.8.3**, subscription-removal deadlock in v2.8.1, composite B-tree range scans in v2.8.0.

**R10 sharpened.** The far-agent model rests entirely on scheduled-reducer timing fidelity, which has been corrected twice in the last month. **An early spike on scheduled-reducer timing accuracy is warranted before Phase 4 depends on it.**

### Development Environment

| Tool | Purpose | Source |
|---|---|---|
| **`spacetime mcp`** | Official MCP server over stdio, bridging to SpacetimeDB's HTTP MCP route (v2.8.1) | SpacetimeDB CLI subcommand |
| **Official Claude plugin** | Bundles agent skills and the MCP server (v2.8.2) | Ships with SpacetimeDB |
| **Context7** | Current-documentation lookup — material on a weekly-release platform | `upstash/context7` |
| **PixiJS agent skills** | Official, June 2026 | PixiJS |

Community MCPs exist (`fractaloutlook/spacetimedb-mcp-server`, `Fail2Fail-Studios/spacetimedb-mcp`, `karutoil/SpacetimeMCP`) but the first-party option supersedes them.

### Sources

Verified 26 August 2026:

- SpacetimeDB releases — https://github.com/clockworklabs/SpacetimeDB/releases
- SpacetimeDB pricing — https://spacetimedb.com/pricing
- TypeScript client reference — https://spacetimedb.com/docs/clients/typescript/
- Event tables — https://spacetimedb.com/docs/tables/event-tables/
- Local prediction (open issue #2453) — https://github.com/clockworklabs/SpacetimeDB/issues/2453
- PixiJS blog / releases — https://pixijs.com/blog
- Phaser 4 GPU layer — https://phaser.io/news/2026/05/phaser4-spritegpulayer-performance
- Bevy WASM size optimisation — https://bevy-cheatbook.github.io/platforms/wasm/size-opt.html

---

## Architectural Decisions

_Step 4 in progress. Decisions below are settled; remaining items listed at the end._

### D1 — World data model  [decided]

**One tilemap.** Addressing is `(x, y, floor, layer)`.

- **Floor** — the vertical axis and the collision domain. Bridges, underpasses, upper storeys, subway and roofs are all floors. Collision tests only within an entity's current floor. Transitions at stairs, ladders, ramps, station steps.
- **Layer** — a composition/semantic slot within one floor: Ground, Ground decals, Ground objects, Furniture, Objects, Walls, Wall decals. The layer is what collision, the generator and interaction read. It is **not** draw order (see D3).
- **Interiors live in the same tilemap at their building's footprint.** No separate spaces, therefore **no portals** — doors are ordinary walkable cells and the navmesh is one connected graph per floor.
- **Cells carry a building/room ownership id**, emitted by the generator. Required for wall retraction; also serves the interior room grammar and "which building is the player in".
- **Wall retraction** hides the near-side walls of the building the player occupies. Required, not cosmetic: y-sorting correctly occludes a player standing behind their own building's front wall.

**Generation constraint (new).** Building footprints are sized by *interior usability*, not street frontage alone — a shop must fit its counter, its stock and a moving player. Carry into E3's placement rules.

**Navigation.** One tile-level navmesh per floor derived from the collision map, plus a **derived** coarse macro routing graph (intersections, building entrances, transit stops; **edge costs in minutes**) so L2 can compute commute durations without district-wide tile A*. Both are generation outputs, computed once at server start and patched incrementally.

**Cut from v1: Hanging objects.** The only class needing a mechanism that neither depth sorting nor culling provides, once interiors are visible from outside.

### D3 — Depth sorting  [decided]

**Object position is its bottom-left cell.** Stored, not derived.

**Passes:** three flat (Ground → Ground decals → Ground objects) → one y-sorted pool. No top pass.

**Pool key: `(y, layer_rank, x, object_id)`** ascending.

`layer_rank` in tens, leaving room for intermediate slots:
`Furniture 0 · Objects 10 · Walls 20 · Wall decals 30 · Characters 40`

Rank resolves **same-cell ties only** — glass over table, poster over wall.

**Objects are never sliced.** Occlusion over axis-aligned rectangular footprints (`A occludes B` iff `A.row_min > B.row_max`) is transitive and irreflexive, hence a strict partial order and acyclic; ascending bottom-row y is a valid linear extension. **Sprite height and x-width do not affect depth.** Row-overlapping pairs are ties: necessarily disjoint in x, so their footprints cannot occlude one another. Residual sprite overlap occurs only where a sprite is wider than its footprint (canopies, awnings), where footprint geometry determines no answer and any stable order is correct.

**Floor is a vertical screen offset, not a sort key.** Elevated and sunken content is drawn shifted vertically in proportion to its floor. The offset separates cross-floor content on screen; where it still overlaps, y ordering is correct.

*Implementation item:* the per-floor offset must be derived from the tileset's storey height and validated against the LimeZu wall sprites.

### D-VIS — Interior and subway visibility  [resolved]

- **Roof** is the floor above; drawn at its offset, so it sits above the wall band and does not cover floor-0 walls.
- **Windows** are semi-transparent wall tiles. Interior furniture behind them renders normally and is seen through the glass. No masking, no aperture system.
- **Subway** (floor −1) is culled until entered; on entry the street floor above is culled instead.
- **Near-side wall retraction** on entering a building.

Culling is per-enclosure, keyed on the building/room ownership id.

### D4 — Tile storage  [decided]

**One row per `(x, y, floor, layer)`** in SpacetimeDB. Chosen for simplicity; spatial subscription provides interest management directly.

*Sizing:* district ~1024² cells × ~3.5 populated layers ≈ 3.5 M rows ≈ ~85 MB. Comfortable in memory and against Pro's ~40 GB. Geometry egress ~670 KB per visible screen — low hundreds of MB per player-month against ~500 GB. **Not a cost constraint.**

*Known risk, accepted:* ~28 k row decodes for one screen is a real slice of the boot budget (A4).

*Revisit trigger:* if boot profiling shows initial subscription decode dominating, migrate to chunked base rows with a per-entity mutable overlay. Addressing is unchanged by that migration.

### D5 — Identity  [decided]

**Anonymous-first, with optional OIDC linking later.**

SpacetimeDB issues an identity and signs a token during the WebSocket handshake, delivered as an `IdentityToken` message; the client stores it in `localStorage` and re-presents it via `.withToken()`. **Zero extra round trips on the common path.**

**Consequence that must land in the first schema:** an OIDC identity is derived from `sub`+`iss`, so linking produces a *second, different* identity. The module needs a **`character ↔ identity` mapping table** (one character, N identities) from day one, or it becomes a live-world migration later (R1).

**Risk:** clearing browser data orphans an unlinked character permanently, in a game with no wipes and months of investment. Mitigate with a prompt to link at a natural moment; a diegetic framing is available (registering with the council, being issued papers).

### D6 — Boot sequence  [decided]

**First visit:** inline **DOM** name prompt in the HTML shell — interactive at first paint (~50–150 ms) with zero game assets loaded. The full payload (~2 MB: bundle, atlases, initial subscription) streams while the player types. **No arrival sequence** — rendered content is on the critical path, not cover for it.

**Player-controllable within 1 s of submitting the name.** First-ever spawn is the player's flat interior (~420 rows, one atlas page) rather than a street screen (~28 k rows) — the loop's own opening beat, used to shrink the critical path. The street streams behind the door.

**Return visit:** no prompt (token in `localStorage`). Target **< 1 s** navigation to controllable. Spawn is wherever cause and elapsed time put the character.

**Techniques:** progressive first frame · small initial subscription box expanded after first frame · service worker for bundle and atlases · atlas split by neighbourhood · prefetch along intent · preconnect/preload.

**A4 lever:** the return path is dominated by the initial tilemap subscription, so the primary lever is **D4's chunking trigger**, not asset size.

**Recorded lever, unspent:** IndexedDB tile-row cache with generation-counter invalidation.

**Required:** an early boot-budget spike. The above is arithmetic, not evidence.

---

### D7 — The L2 Citizen Brain  [decided]

Worked through in depth; several earlier positions were overturned and are recorded as such.

### What L2 is for

1. **Every citizen has a life, not a shift.** Work and sleep are a skeleton; the discretionary middle is filled from their own preferences and commitments. **This is what makes the city feel alive at one connected player** — and it must be decided with no knowledge that anyone is watching (Truth Test).
2. **It holds the player's life when they are gone.** Same machine, richer inputs, conservative posture as a parameter — never a second code path.
3. **It produces state that can become physical carriers** where a player could encounter it.

**Discretionary life must live in L2, not L1.** A coordinator that starts citizens on leisure activities near a player is authoring by proximity — a direct Truth Test and P2 violation.

**NPC own-time and player lateral pursuits are one catalogue, one system.** The café has people in it because citizens spent their own time there.

**Citizens require stable preferences and habits** — not decoration. Recognisability ("the same barista") and the geographic social graph both depend on them.

### The understudy is additive only

> **The understudy adds — money, payslips, a rent receipt. It never subtracts, replaces, consumes, degrades or rearranges.**

Necessities are a cost line, not inventory consumption: it pays the weekly food cost; it does not consume the player's things.

**Rationale.** Wear-during-absence is a **P3 violation** — a penalty for logging off, denominated in things the player earned with their own discretionary time. At 24 in-city days per real day, a weekend offline is ~7 in-city weeks of accrued degradation.

**Property test:** for any absence duration, the player's inventory is a superset of what they left, and no owned item's state has degraded.

**The trace on return is the world, not the player's possessions.** The street changed, scaffolding went up, a chain advanced. Free, causal, Truth-Test-clean. Payslips and receipts survive as *additive* objects.

**Rejected:** the pile of unread post — an inbox in diegetic costume, and inconsistent with a competent understudy.
**Rejected:** "records rendered as sentences" — a HUD in disguise. **Carriers, not sentences.**

### Decision mechanism

**Obligations are a calendar; own-time is utility.**

- **Calendar** — shift start, the dog, the club, the standing fixture. Data, not AI. Not a choice, exactly as an 8-hour shift is not a choice for the player.
- **Utility AI in the gaps** — 4–5 bars (money, rest, hunger, social, pursuit drive) plus habit. Score, act, re-evaluate at the next decision point. **Keep the bar count small**; every bar multiplies a tuning surface spanning ~100 professions.

This mirrors the GDD's own day budget exactly, so citizen and player run on the same structure.

**GOAP rejected.** GOAP plans a sequence; a plan is a chain; chains reintroduce invalidation. Utility AI with a one-step horizon has no future to invalidate.

**No stored taste.** Dispersion comes from `utility = f(quality, distance_in_minutes, habit_strength)` — the local café wins on *cost in minutes*, the game's only currency, and habit makes it stick. Revisit only if the city reads as uniform.

**Cost:** ~3,000 utility scores/sec at 20 k citizens. Negligible.

### Step by step — no commit-ahead

**Decide at each transition using current belief. No plans, no committed chains, no invalidation, no compensation logic.**

Committing a citizen's day ahead would require indexing every committed effect by every entity it depends on, and querying dependents on every world change — a dependency-tracking subsystem that fails **silently** when a dependency is missed. It would have saved wake-ups, which are not the bottleneck: ~111 small state-machine steps per second at 20 k citizens is a rounding error on one core.

**Institutional chains keep the committed-sequence engine** — a budget approval genuinely is a multi-step process with in-city days of latency, and there are dozens, not tens of thousands. **Bodies do not.**

Materialisation is unaffected: the *current* step carries `(route, t_depart, t_arrive)` and interpolates. Nothing asks where a citizen will be in six hours.

### Belief — citizens act on stale knowledge

> **Knowledge needs a physical carrier.** The same law as consequence, applied to information.

A citizen walks to the café because they believe it is open. It is not. They arrive, observe, and re-decide **on the spot**. There is nothing to invalidate — the belief was never wrong, only out of date.

- **Externally visible state is observed on passing, not on entering.** The commute is the citizens' sensor on the city exactly as it is the player's.
- **No knowledge broadcast anywhere in the system.** Information that should travel fast travels through carriers — a sign on a closed road, a colleague on handover, a council notice.
- **Emergent payoff:** knowledge diffuses as a decay curve. Day one, many people stare at the shutter; day ten, almost nobody. Every day of it is legible from a bench across the road — which is the design's hardest-to-instrument metric (unprompted noticing) arriving as a side effect.

### Citizen memory

```
citizen_memory  (citizen_id, business_id)
  habit_strength
  last_contact
  known_state        -- NULL = matches the public default
  known_state_at
```

- **Keyed on the business, not the location** — successive tenants do not inherit stale knowledge.
- Row exists ⇒ "I know this place." Absent ⇒ use the public default.
- **`known_state` written on surprise only.** Surprises are rare by construction, so write volume is near zero.
- **Self-cleaning:** when reality returns to the default and the citizen observes it, the row is deleted. No decay, no expiry sweep.
- Habit writes occur **inside the transition transaction that was already firing** — extra row-writes, not extra commits.
- Scoped to habit: ~15 places/citizen ≈ 300 k rows ≈ ~6 MB. This memory is required regardless, for recognisability and the social graph.
- **Loop broken:** re-decision happens with the new row in scope, so the failed option scores zero *for that citizen*. A **fallback action (go home)** provides the utility floor.

**Pruning — no background sweep:**
- **Indexed fan-out delete on business death** (a few thousand rows at most; businesses die rarely).
- **Per-citizen LRU cap** (~50 places). Forgetting is design-correct, and it produces re-discovery.

> **This is R2's answer pattern.** Every accreting table in a never-reset world gets an explicit bound. Applies equally to litter, records and municipal memory.

**Guard rail — property-tested:** *no memory row may be written except by an observation or an interaction at a defined location and time.* This is what stops social transfer quietly becoming a broadcast.

### Advancement mechanism

Scheduled tables are native: `scheduled_id: u64` + `scheduled_at: ScheduleAt`, **one reducer invocation per due row**, row deleted after firing, and **scheduling is transactional with the state change that decided it**.

| | Mechanism | Transactions/sec | Work | Failure surface |
|---|---|---|---|---|
| **Alarm Clock** ✅ | Scheduled table, one row per citizen transition | ~111, spiky with city rhythms | 111 citizen-transitions/sec | **Cannot desynchronise** — platform-owned |
| **Shift Rota** ⚖️ | `ScheduleAt::Interval` heartbeat + `#[index(btree)]` range scan on `next_at` | ~10 at 10 Hz, flat | identical | `next_at` can go stale — **silent**; one citizen simply stops living |

**Decision: Alarm Clock**, pending benchmark. Both do identical work — the indexed sweep returns only due rows and never touches the rest of the population. The difference is per-transaction overhead, which is a measurement. Absent that number, the cannot-desynchronise property outweighs the Rota's flatter load. Load spikiness is partly self-mitigating, since staggered shift start times are required for the city to look right anyway.

**Rejected: "The Oracle"** — a purely lazy model where nothing ticks and state is a function of a plan evaluated on query. It breaks causality: two citizens cannot meet, a till cannot run short, nobody can drop a bottle. It is spin-down by another name, which the GDD rejects explicitly.

### Execution location — in-module

**L2 runs inside the SpacetimeDB module.**

**Rejected for now: headless worker clients ("Ghost Crew")** — worker processes simulating L2/L3 for many citizens, connecting as identities, treated by the server as players.

*Genuine strengths, recorded so the decision can be revisited honestly:*
- **P2 becomes structural.** AI citizens would use the identical API surface as a browser, making "no mechanical seam between a player-held and AI-held role" impossible to violate rather than merely promised.
- **Iteration.** Changing L2 means restarting a process rather than republishing a WASM module against a live world.

*Why not now:*
- **It buys compute headroom that is not needed.** ~111 small state-machine steps/sec is not a workload.
- **Reads become expensive.** In-module code reads tables directly; a worker must subscribe and take that state over the wire, continuously, for 20 k citizens plus nav graph, jobs and prices.
- **Transactionality is lost.** In-module, decide → write → schedule is one transaction. From a worker it is a network call, and two workers touching one citizen is a race.
- **A new failure mode with no precedent in the stack.** The database can be healthy while every citizen stands motionless because a process died. "The city always ticks" becomes contingent on a worker's liveness — accidental spin-down, which the GDD rejects.
- The iteration argument proves too much: everything else is in the module, so live-world republishing is unavoidable regardless.

**Escape-hatch trigger conditions:** citizen count grows by an order of magnitude, **or** L2 acquires a genuinely CPU-bound decision layer.

### Benchmarks outstanding — measurements, not arguments

| # | Question | Feeds |
|---|---|---|
| B1 | Per-transaction overhead — Alarm Clock vs batched sweep | Advancement mechanism |
| B2 | **Real L2 event rate with discretionary time included** — up ~50–80% on the work-only skeleton figure | **A2** |
| B3 | Boot budget, measured | **A4** |

### Escalated to the GDD

**Social continuity across long absence.** At 24 in-city days per real day, a fortnight offline is roughly an **in-city year**. Money and rent scale fine and the understudy holds the role. **Recognisability and the geographic social graph are the exposed surface** — both assume the player keeps meeting the same people. Wants a labour-churn model where established citizens are sticky, which is also more accurate than uniform churn.

---

### Remaining Step 4 items

| ID | Decision | Status |
|---|---|---|
| **D2** | Collision, footprints, object definitions and sprite delivery | ✅ **Decided** |
| **D8** | Nav graph representation, storage, distance estimation and patching | ✅ **Decided** |
| — | **L1 ↔ L2 interface** | **Superseded by D14.** The publish/intent contract was drafted against a version of L1 that no longer exists |
| ~~D9~~ | Body replication | ✅ **Decided** |
| ~~D11~~ | Hosting | ✅ **Decided** |
| ~~D13~~ | State growth (R2) | ✅ **Decided** |
| ~~D12~~ | Schema migration (R1) | ✅ **Decided** |
| ~~D14~~ | L1, institutions and the decision layer | ✅ **Decided** (replaces the withdrawn equilibrium-controller draft) |
| ~~D10~~ | Asset pipeline (incl. layered characters) | ✅ **Decided** |
| ~~D15~~ | Audio | ✅ **Decided** |
| ~~D16~~ | Input | ✅ **Decided** |
| ~~D17~~ | UI — DOM for out-of-fiction; canvas may draw transient object-bound views only | ✅ **Decided** (amended) |
| ~~D19~~ | Inventory — grid/Tetris, footprints reused from D2 | ✅ **Decided** |
| ~~D-ANIM~~ | Animated objects | ✅ **Decided** |
| D18 | Sharding (R4) | Deferred to measurement |
| D-L3 | Where the micro brain runs | ✅ **Decided** — client-side, no ownership |

### D2 — Collision, footprints and sprite delivery  [decided]

**The server performs no sub-tile collision.** Players collide client-side (client-authoritative movement); NPCs route on the navmesh and never collide.

| Artifact | Granularity | Owner | Source |
|---|---|---|---|
| Walkability | Tile-level, per floor | Server | Generation output, patched on structural change — see D8 |
| Sub-tile collision | Collider rect | **Client, derived on the fly** | Subscribed rows + static `object_def` |

**Rows are storage; the runtime form is a derived grid.** Rows expand into a local structure on insert/delete/update (`O(footprint area)` per write); all runtime lookups are `O(1)` against that structure. Neither side queries rows to answer "what is at (x, y)". `onDelete` supplies the row, so the footprint is available at delete time.

**Tilemap rows are placed object instances at their anchor cell** (bottom-left: smallest x, largest y). A multi-cell prop is **one row**; extent comes from `object_def`. Covered cells hold no row of their own — keeping D3's one-object-one-drawable rule true by construction.

**D4 refined:** not one row per `(x, y, floor, layer)` but **one row per placed object instance**, primary key an instance id, `#[index(btree)]` on `(floor, x, y)`. Layer lives on the definition, not the row. Several objects may share an anchor cell (rug + table + glass).

**Footprints are capped (≈8×8).** Larger structures are composed of multiple objects. The cap bounds the region-subscription margin to a constant, shared with the body zone's margin, and is asserted by the S23 pipeline.

#### Tileset findings (inspected 2026-08-27)

`ModernTileset/` holds **23,519 PNGs, 135 MB**. The `*_Singles_*` directories are **whole objects, one PNG each** — nothing is pre-split into 16×16 tiles and nothing needs compositing.

| Set | Files | Most common dimensions |
|---|---|---|
| City Props | 715 | **16×32** (209) · 16×16 (143) · 32×32 (62) · 32×48 (50) · 16×48 (36) |
| Vehicles | 273 | **80×48** (43) · 48×80 (27) · 112×64 (16) · 48×112 (16) |
| Generic Building | 180 | 32×32 (27) · 16×32 (17) · **48×192** (6) · 16×192 (4) |

Two properties confirmed empirically rather than assumed:

- **Sprite height ≠ footprint depth is the dominant case.** The most common city prop is 16×32 — one cell of floor, two cells of screen height. A building facade at 48×192 is 3 cells wide by twelve tall. D3's rule that sprite height never affects depth is load-bearing, not incidental.
- **Footprint depth > 1 is common**, not exceptional. A car at 112×64 is 7×4 cells.

#### Object definitions

```rust
object_def {
    id:          u32,
    name:        String,
    layer:       u8,                    // D3 layer_rank
    atlas_page:  u16,
    rect:        (u16, u16, u16, u16),  // whole-object sprite, ONE rect
    footprint:   (w: u8, d: u8),        // CELLS, from the anchor
    collider:    Option<Rect>,          // PIXELS, anchor-relative. None => walkable
    interact_at: Option<(i8, i8)>,
    // state / state_schema  -> deferred to S9
    // animation             -> deferred to D-ANIM
}
```

- **No `walkable` flag** — absence of a collider *is* walkability.
- **Collider is a single rect.** AABB, one box.
- Invariant **`collider ⊆ footprint`**, asserted by S23.
- The footprint rectangle serves three consumers: collision, D3's sort row, and walkability.

`object_def` is **static and versioned with the build**: compiled into the Rust module, and shipped to the client as a cached static asset. Two independent parsers over one source file.

**`defs_version` is checked at connect.** A stale cached client receiving an unknown `def_id` would fail silently, so the module publishes the version and the client refreshes on mismatch.

#### Sprite delivery — not through the database

| | Where | Why |
|---|---|---|
| **Pixels** | Static atlas pages over HTTP, content-hashed filenames, cached by the service worker | Immutable, large, identical for every client. Browsers already solve this |
| **Reference** (`atlas_page`, `rect`) | `object_def` | Tiny, versioned with the atlases |

Sprite bytes in SpacetimeDB would spend in-memory storage on immutable blobs and pay database egress on every transfer. D6's boot budget *depends* on atlases being cached, which HTTP provides natively and a subscription does not.

*Distinction from D4:* tile rows are dynamic, small, and need interest management — they belong in the database. Sprite pixels are static, large and immutable — they do not.

**Atlas build pipeline:**

- Pack the used subset into 2048×2048 pages
- **Group pages by neighbourhood/theme** so a spawn screen references few pages (D6's atlas splitting). The tileset's own `Theme_Sorter` directories are already organised this way
- Content-hash page filenames — infinitely cacheable, free versioning
- **The packer emits atlas pages and the `object_def` table together**, so rects and definitions cannot drift. Both covered by `defs_version`

Rough sizing: ~3,000 used sprites averaging 32×48 ≈ 4.6 M px ≈ 2–3 pages; pixel art compresses well, and a spawn screen touches a fraction. Consistent with D6.

### D8 — Nav graph  [decided]

Two structures.

**Walkability grid** — tile-level, per floor, derived from object footprints. Materialised at generation, patched on structural change. Server-side; used to build and repair the macro graph.

**Macro routing graph** — SpacetimeDB tables. ~3–5 k nodes, ~10 k edges over a 1024² district. Interiors collapse to an entrance node (plus an internal node for large buildings); without that, 100+ interiors would balloon the graph for no routing benefit. **The client never sees the macro graph** — it has walkability from D2 for player collision and L3 steering, and receives a citizen's chosen route in their L2 state.

#### D8a — Tables, not module globals

An in-memory graph diverges from committed state when a reducer aborts: a welded door is a state change inside a transaction, and on rollback the tables revert while module globals do not. It is also lost on restart or republish. The performance argument for globals is largely illusory — the store is in-memory, so a table read is a memory read.

#### The graph is also the index of what the city offers

Source nodes advertise provisions, so utility AI's "what provides food near me?" is a spatial query over the same structure L2 routes on. One index, two consumers.

```rust
nav_node {
    id:          u32,
    kind:        NodeKind,      // Transit | Source | Portal
    floor:       i8,
    x:           u32,
    y:           u32,
    business_id: Option<u32>,   // Source nodes join to citizen_memory here
}
// index(btree) on (floor, x, y)     -> "sources near me"

node_provision {
    node_id:   u32,
    provision: u8,              // Food | Social | Rest | Retail | Civic | ...
    quality:   u8,
}
// index(btree) on (provision)       -> "everything that provides food"

nav_edge {
    from:         u32,
    to:           u32,
    cost_minutes: u16,
    kind:         EdgeKind,     // Street | Interior | Transit | Portal
}
```

- **`Portal` edges are where D1's floor transitions become graph structure** — stairs, ramps, station steps, the manhole. They are the only edges where `from.floor != to.floor`, which makes them trivially assertable.
- **A source may advertise several provisions.** A café is Food *and* Social — hence a separate table rather than a column, and one venue can satisfy two different bars.
- **`business_id` joins source nodes to `citizen_memory`** — "do I know this place, and is it open?" is a lookup on a key we already have.

#### D8b — Distance for utility scoring

**Manhattan distance, computed fresh, converted to minutes.** No cached distances, no stored geometry on citizens, no graph traversal in the scoring path.

```
estimated_minutes = manhattan_cells × minutes_per_cell(transport_mode) + floor_change_penalty
```

- **Origin-independent by construction.** A cached "real walking time" is only valid for the trip that produced it; citizens set off from wherever they happen to be, so the number would be wrong on the next trip.
- **Manhattan beats Euclidean here** because the city is generated as square blocks.
- **Denominated in minutes**, so the transport ladder (bike, transit pass) acts on scoring directly — M3 falls out of the estimator rather than needing a special case.
- `citizen_memory` therefore holds **no distance field**.

**One A\* for the chosen destination only.** Scoring is arithmetic over candidates; pathfinding happens once, after the choice. Commute routes are cached on the citizen, computed when the job or flat is assigned, recomputed only on disturbance.

**Accepted error:** Manhattan ignores rivers, rail cuttings and closed parks, so the estimate is optimistic there and the citizen walks partway before re-routing — which is what a person does when they misjudge. A per-region correction factor is available later if a specific barrier proves visibly troublesome.

#### D8c — No route invalidation, and no per-citizen edge memory

`citizen_memory` is keyed on `business_id`; edges are not businesses, and adding nav entries would both break the key and inflate a table bounded deliberately.

**The cached route *is* the belief.** A citizen whose commute crosses a newly blocked edge hits the barrier, re-routes, and overwrites their cached route. A citizen computing a *fresh* route uses the patched graph and never walks into it.

**Why fresh routes may legitimately know:** roadworks are **publicly announced** — barriers, diversion signs, council notices are the physical carriers, and they are citywide by nature. A burnt café is not announced; a closed street is. This is a different case, not an exception to the carrier law.

**This deletes S21's route-invalidation machinery** — no edge→routes index, no fan-out invalidation, no propagation.

### D-L3 — Where the micro brain runs  [decided: client-side, no ownership]

**Every client simulates L3 for the NPCs in its own bubble.** No per-NPC ownership, no assignment, no handoff.

The alternative considered — **assigned ownership**, where one client owns each nearby NPC's L3 and publishes the result so all viewers see identical behaviour — was rejected on bandwidth.

| | **Client-simulates-own-bubble** (chosen) | **Assigned ownership** (rejected) |
|---|---|---|
| NPC fine position | **Derived** locally, never transmitted | **Replicated** at 10–20 Hz |
| Divergence | Micro-steering only | None |
| Determinism required | Yes | No |
| Handoff on disconnect | None | Reassignment needed |
| Per-client compute | ~200 NPCs | ~200 NPCs — **identical** |

Per-client compute is the same under both, so the "duplicated work" objection to client simulation does not survive: each client simulates the NPCs it would otherwise have received. Duplication is across clients and costs no individual client anything.

**Egress decides it.** At 200 NPCs and ~12 bytes per update, with 100 players averaging 2 h/day:

| | Per client | Per month |
|---|---|---|
| Assigned ownership @ 20 Hz | ~48 KB/s ≈ 173 MB/h | **~1,040 GB** |
| Assigned ownership @ 10 Hz | ~24 KB/s | ~520 GB |
| **Client-simulates** — L2 state only | **~0.4 MB/h** | **~2.4 GB** |

Against Maincloud Pro's ~500 GB, assigned ownership exceeds the egress budget at 20 Hz and sits on the line at 10 Hz. Client simulation is roughly **400× cheaper** and is not a line item.

**What ownership would have bought:** no divergence, and freedom from any determinism requirement on L3. Weighed against 400×, the determinism requirement is a modest constraint — seed flavour behaviour from `(npc_id, tick)`, scope local avoidance to a fixed tile region rather than the viewer's bubble.

**Divergence is bounded to what nobody checks.** Gross position and current activity are derived from replicated L2 state, so all clients agree that the barista is at the counter and the commuter arrives at 08:40. Only which side of a bin someone steps can differ.

### D9 — Body replication  [decided]

**The distinction is authored vs derived, not player vs NPC.**

- A **player's** position exists only in a human's head. Nobody else can compute it, so it must be transmitted.
- A **citizen's** position is a function of `(location_state, now)` that every client already holds. Transmitting it would send information the receiver derives for free.

Both interpolate; both move smoothly. One requires transmission because the information exists nowhere else.

#### Citizens carry no coordinates

```
At(node_id)                           -> the node's coordinates
InTransit(route_id, t_depart, t_arrive) -> interpolate along the route
```

**Why `chunk` still exists:** subscriptions are queries over *stored* columns, and a derived value cannot be subscribed to. `chunk` is the materialised projection of the route, existing solely so `chunk = C` is expressible as a subscription filter. That is its entire justification — recorded so nobody later adds x/y "for consistency" and pays to transmit derivable data forever.

#### D9a — Chunk-crossing wake-ups  [decided]

A citizen updates `chunk` as they cross chunk boundaries. Chosen over precomputed per-chunk presence rows because it is one column on a table that already exists, shared by players and citizens, with no second table to clean up.

**Cost, accepted:** each chunk crossing is a wake-up, raising the L2 event rate (feeds B2). **Chunk size is the dial** — larger chunks mean fewer wake-ups but more citizens streamed than needed.

#### Schema

```rust
actor_location {              // shared by players and citizens — the subscription key
    actor_id: u64,
    kind:     ActorKind,      // Player | Citizen
    chunk:    u32,
    floor:    i8,
}
// index(btree) on (chunk)

citizen_state {               // citizens: no x, no y
    citizen_id: u64,
    activity:   u16,
    location:   Location,     // At(node_id) | InTransit(route_id, t_depart, t_arrive)
}

player_transform {            // players only: authored, therefore transmitted
    player_id: u64,
    x: f32, y: f32, facing: u8,
}
```

`actor_location` gives one subscription mechanism covering both populations. Fine position cannot merge into it: one is authored and one is derived, and merging would put high-frequency player writes in a table whose citizen subscribers would then be woken on every player step — exactly what SpacetimeDB's frequency-split guidance warns against ("organise data by access pattern, not by the entity it describes").

#### D9b — Player position  [decided]

**One row per player, overwritten in place.** No event table, no separate durable channel.

An overwritten row has no history, so it is simultaneously the hot rendering channel and the durable state — reconnect continuity and understudy handover simply read the last value. The transient/durable split earlier proposed here is withdrawn, as is the event-table recommendation: SpacetimeDB's documented idiom for position is a plain table separated by update frequency, as used in their own Blackholio demo.

**Finding — the term that scales with players, not citizens:**

| | Transactions/sec |
|---|---|
| Whole city's L2 (20 k citizens) | ~111 |
| **10 concurrent players at 20 Hz** | **~200** |
| 10 concurrent players at 10 Hz | ~100 |

Ten moving players generate more transactions than twenty thousand citizens living. Not a problem at target concurrency, but the curves differ: L2 scales with population, player movement scales with concurrency, and the second is far steeper per capita.

**Dial:** update rate, absorbed by interpolation on receiving clients. Start at 10 Hz.
**B4 added:** player position write rate vs perceived smoothness.

### D11 — Hosting  [decided]

**Maincloud Pro.** $100 of existing credits covers the opening months. Self-hosting retained as a live fallback, not a rejected option.

**The binding constraint is function calls/compute.** Storage (~200 MB against ~40 GB) and egress (~2.4 GB/month against ~500 GB, thanks to D-L3) are both comfortable and are not expected to become constraints.

#### A2 reframed — density, not population

The GDD's own constraint is *"aliveness is measured per screen, not per database"*, therefore:

```
population = local density × area
```

**Launching with one neighbourhood shrinks the area, not the density.** A busy street at rush hour reads identically busy in a 256² neighbourhood and a 1024² district — it is the same screen. Only headcount shrinks.

| | District (1024²) | **Neighbourhood (256²) — launch** |
|---|---|---|
| Citizens | ~20,000 | **~1,000–2,000** |
| L2 transactions/sec | ~167 | **~10–17** |
| Calls/month | ~433 M | **~26–43 M** |
| Against Pro's ~120 M | ✗ overage | ✓ **comfortable** |

The 20 k figure is a **district target reached at E13 growth**, by which point real telemetry will exist.

#### Cost comparison (district scale, for the eventual decision)

| Option | ~433 M calls/mo | Note |
|---|---|---|
| Free | not viable | two orders of magnitude short |
| Pro + overage | ~$126/mo | $25 + ~261 k TeV over ÷ 2,592 TeV/$ |
| Team | ~$293/mo | buys seats and support, **not** cheaper energy — Pro+overage wins at any overage volume |
| Self-host | ~€20–40/mo flat | 16 GB VPS, unmetered compute; you own backups, upgrades, TLS, monitoring |

**Published TeV-per-call conversions are unreliable** — the platform's own "1,000 players at 60 Hz" figure does not reconcile with them. Absolute figures above are a **shape, not a forecast**; ratios between options are what the decision rests on.

**Instrument TeV per reducer class from day one**, so scaling decisions are made on measurement.

**Revisit trigger:** metered cost sustained above ~3× a flat VPS. Self-hosting is also the prerequisite for the Ghost Crew escape hatch (co-location largely removes its read-cost objection).

**Named risk:** a never-reset world makes backup discipline existential under self-hosting.

#### Consequence for D7

The Shift Rota's ~10× transaction advantage is worth ~$100/month **only at district scale**. At launch scale there is no overage either way, so **no financial argument against the Alarm Clock exists at launch**. The Alarm Clock stands; the comparison is revisited at growth, on telemetry, not on the published conversion.

#### Escalated to design

**Labour-market depth vs neighbourhood population.** The GDD wants ~100 professions so wage self-balancing has something to balance. At 1,000–2,000 citizens that is 10–20 people per profession, which is thin. The profession count is therefore a design dial to be set against neighbourhood population and local-density work — not inherited from the district-scale figure.

### D13 — State growth (R2)  [decided]

**Not a growth forecast.** Multi-year accretion cannot be predicted in advance, and pretending otherwise would be false precision. Four things are committed instead.

#### 1. A storage budget with a review trigger

| | |
|---|---|
| Hard wall | ~40 GB (Maincloud Pro allowance) |
| **Review trigger** | **10 GB — 25% of the wall** |
| Estimate at launch scale | ~200 MB |

~50× headroom at launch. The budget exists so that *approaching* it is a signal, not so that it is ever reached.

#### 2. Every table declares a bound, of one of two kinds

- **Game-mechanical** — soft, visible, and content in its own right. Sanitation clears litter; the player bins old post.
- **Engineering ceiling** — hard, invisible, never reached in normal play. A per-chunk litter cap so a failed sanitation chain cannot fill the database.

**A table with neither declared is a bug**, checkable in review. This matters most for agentic development: an agent adding a table is adding a growth source, and the rule makes that explicit rather than incidental.

The declaration is **machine-readable** — bound kind, expected magnitude, alert threshold — because it is a monitoring input, not documentation.

#### 3. Instrumentation and alerting

A declared bound that nothing watches is a comment.

- A **scheduled reducer samples per-table row counts and bytes** on a slow cadence (hourly is ample) into a `table_metrics` table.
- An **external watcher subscribes to `table_metrics`** and alerts when actual exceeds a table's declared threshold, or when total storage crosses the review trigger.
- Alerting lives outside the module because reducers are sandboxed and transactional; outbound notification is not their job.

**On adding an external process after rejecting the Ghost Crew:** the risk profiles are not comparable. If the watcher dies, the city keeps ticking and alerting is lost until it is noticed. If a Ghost Crew worker dies, the city stops. One is off the critical path; the other is the critical path.

**This is the same observability system that serves everything else** — one `table_metrics`-style pipeline and one watcher covering:

- table growth (R2)
- TeV per reducer class (D11)
- the five gameplay metrics from the GDD
- benchmarks B1–B5

#### 4. The inventory below is analysis, not commitment

Current best guess at where growth comes from — a starting allocation, expected to be wrong in places.

| Table | Growth driver | Bound |
|---|---|---|
| `tile_object` | Map area; E13 growth | Bounded by area (design) |
| `actor_location`, `citizen_state` | One row per actor | Fixed cardinality |
| `player_transform` | Overwritten in place | Fixed — no history |
| `citizen_memory` | Places known | **LRU cap ~50/citizen** + fan-out delete on business death (D7) |
| Litter (Ground objects) | Accretes when sanitation fails | **Mechanical:** sanitation chain · **Ceiling:** hard per-chunk cap |
| Institutional chain records | Completed chains | Rollup to summary after N in-city weeks |
| Post, payslips, receipts | Accrete in the player's flat | **Diegetic disposal** (bin them) plus a cap |
| Municipal memory | Observations over years | Aggregate to statistics; raw events expire |
| Nav graph + patch log | Area + structural changes | Area-bounded; **patch log compaction — open, see below** |
| Citizen churn | Arrivals and departures | Row deleted on departure; no tombstones |

#### The equilibrium law is the storage bound

The GDD's law — *every bounded quantity tends toward an equilibrium the non-player simulation actively tries to reach* — **is** the storage discipline in another register. A quantity with something actively pursuing its equilibrium does not accrete without limit.

So most of the table above gets its bound from a design law already written, and engineering ceilings are the **safety net for mechanism failure**, not the primary tool. *(Note: D14 withdrew the uniform equilibrium-controller pattern entirely. The storage discipline stands on its own — every accreting table declares a bound — and the equilibrium law is now satisfied by many agents each responding to local pressure rather than by a controller layer.)*

#### Open — nav graph patch log

Determinism (R3/R8) wants a replayable patch history so `seed + patches` reproduces the city; R2 wants the log compacted. These pull opposite ways. **Periodic re-baselining** — snapshot the graph, truncate the log — is the obvious shape, but it deserves a deliberate decision rather than a default.

### D12 — Schema migration on a live world (R1)  [decided]

Verified against SpacetimeDB's automatic-migration documentation, 2026-08-28.

#### What automigration permits

| Always safe | Permitted with conditions | **Forbidden — publish fails** |
|---|---|---|
| Adding new tables | **Adding a column** — only at the **end** of the table definition and **with a default value** | Removing tables |
| Adding indexes | | Removing or modifying existing columns (type change, rename, reorder) |
| Adding/removing `AutoInc` | | Adding a column without a default, or mid-table |
| Private → public | | **Adding `Unique` or `Primary Key` constraints** |
| Adding reducers | | **Changing a table's `scheduling` status** |
| Removing `Unique` constraints | | |

#### Resulting design discipline

- **Primary keys and unique constraints are permanent.** They cannot be added later, only removed. Get them right in the first commit.
- **Columns are append-only and always carry a default.**
- **Never rename or retype.** The remedy is a new table plus read-through.
- **Anything that might ever need scheduling must be created as a scheduled table.** A normal table can never become one.
- **Tables stay narrow** — now for three independent reasons: SpacetimeDB's frequency-split guidance (D9), the fact that an unalterable wide table must be replaced wholesale, and migration blast radius.

**Consequence for D7.** The Alarm Clock's scheduled table must exist from day one. A later Alarm Clock → Shift Rota switch remains possible but is additive-only: add a new interval-scheduled table, append a `next_at` column with a default, stop inserting into the old scheduled table, and leave it empty rather than dropping it.

#### Incremental (lazy) migration is the standard workflow

Not the emergency one. New table with the desired schema → the module reads new-first and falls back to old → backfills on access → the old table is eventually retired (emptied, not dropped). Clockwork ship `incr-migration-demo` for this shape. An `__update__` reducer on the new schema makes publish return a **manual migration plan** rather than attempting an automatic one.

#### Version handshake

The `defs_version` handshake from D2 carries a **schema/protocol version** as well as asset definitions. Non-updated clients cannot see new tables, so client and module versions must be checked at connect and the client refreshed on mismatch.

#### Backups — treated as unresolved

- **Maincloud advertises backups** as part of the managed service ("handles infrastructure, scaling, replication, and backups").
- **Snapshots exist in the engine** as an on-disk view of committed state at a transaction offset — but as an internal optimisation over commitlog replay, not obviously a user-facing backup tool.
- **No documented user-facing backup, restore or export command was found** in the CLI. It may exist and not surface in search; it is not being assumed.

**A world that cannot be regenerated must not rest on an unverified managed backup.** Before the world contains anything worth losing:

1. **Confirm Maincloud's backup semantics directly** — frequency, retention, and whether the developer can trigger and restore one or only support can
2. **Build a DIY logical export regardless** — `spacetime sql` per table to a dump, on a schedule
3. **Test the restore.** An untested backup is not a backup

**Feeds D11:** self-hosting yields the data directory, commitlog and snapshots outright — a stronger point in its favour than previously credited. Conversely, "backups are someone else's problem" is the assumption most worth checking before it becomes load-bearing.

**Back up before every migration.** Non-negotiable.

### Benchmarks and verification tasks

| # | Task | Feeds |
|---|---|---|
| B1 | Per-transaction overhead and **cost per transaction** — Alarm Clock vs batched sweep | D7 advancement, D11 |
| B2 | Real L2 event rate including discretionary time and chunk crossings | A2, D11 |
| B3 | Boot budget, measured | A4, D6 |
| B4 | Player position write rate vs perceived smoothness | D9b |
| B5 | ~~Is adding a column permitted?~~ | ✅ **Answered** — yes, appended with a default |
| B6 | **Verify Maincloud backup/restore semantics; stand up and test a logical export** | D12, R1 |
| B7 | Scheduled-reducer timing fidelity spike | R10, D7 |

### D14 — L1, institutions and the decision layer  [decided]

**Replaces the earlier `equilibrium_controller` draft, which is withdrawn.** That draft had L1 moving quantities toward setpoints — a hand reaching into the world with no person attached to it. It failed the physical-carrier law and P2 simultaneously.

**Data shapes are deliberately NOT committed here.** Only the system is. Because D12 makes primary keys and column layouts permanent, table shapes should be fixed when the systems are built, not before. Entities and relationships below are named; their columns are not.

#### The starting point: a complete city with no L1

Citizens work, consume and litter; janitors clear. Stocks deplete and get reordered. Businesses trade. **This runs on L2 alone.** If there are too few janitors for the littering rate, refuse accumulates; if enough, it does not. Nothing is missing except *response to imbalance*.

#### What responding actually requires

Raise the janitor's pay, buy another truck, open a landfill, approve a development — **every one of those is a decision made by a person holding a job.** Those are citizens with work procedures. That is L2 doing institutional work, not L1.

Four things had been welded together under the name "L1", and only one of them belongs there:

| | | Owner |
|---|---|---|
| **Exogenous inputs** — what happens outside the simulated boundary (external commodity prices, in-migration, weather) | | **L1** |
| **Aggregation** — statistics no individual can see | *largely dissolved, see below* | L1, as an optimisation only |
| **Clearing** — prices and wages from aggregate supply and demand | *dissolved, see below* | — |
| **Decisions** — raise the pay, buy the truck, open the landfill, approve the development | | **L2 citizens in institutional roles**, acting through chains |

#### Statistics largely dissolve

Every question a decider needs answered is a query over tables that already exist:

| Question | Answered by |
|---|---|
| How bad is the litter in ward 3? | **Count open matters in my inbox scoped to ward 3** |
| Can I afford this? | **Read the municipal account balance** |
| Are we short of janitors? | **Count unfilled job postings** |
| Is the landfill full? | **Read the landfill's refuse stock against capacity** |
| Is there housing pressure? | **Count occupied against vacant dwellings** |

A statistics table would be a **materialised view, not a data source**. Whether any exist is therefore a performance question, decided when a query proves too expensive — not a design commitment.

#### Clearing dissolves too

- **There is no city-wide wage.** There are **job postings with offered wages, set by employers** — who are deciders. An unfilled post is a matter in the owner's inbox; raising the offer is one of their available actions. The GDD's "labour market saturation, self-balancing with no designer intervention" emerges from many employers each responding to their own unfilled posts.
- **There is no city-wide price.** Each business sets its own. Unsold stock argues for lowering it; selling out argues for raising it. Both are decider actions on local information.

#### The reduction

> **L1 is the boundary.** Everything inside the city is done by a person with local information. L1 is only what has no author inside the simulation: **external commodity prices, in-migration, and weather** — the outside world pressing in, plus whatever aggregate view the outside has of the city (people move to cities that have jobs and rooms).

**L1's authority is legitimate exactly where simulation stops.** A price arriving from outside is not magic; it is the rest of the world, which exists and is not modelled. Nothing inside the boundary is ever handed a number.

This satisfies the Truth Test and P2 structurally rather than by discipline, and it means equilibrium is what happens when many people each respond to their own local pressure.

---

#### The base layer: stock and logistics

Identified as core and previously unwritten. It is L1's substrate, so it comes first.

- **Items** are defined types with a unit, perishability and bulk.
- **Stock** is held by a *holder* — a business instance, a citizen, a vehicle, a building, a municipal facility. **Stock sits on the business instance, not the room and not the brand:** two cafés in a chain are two holders with two stocks.
- **Recipes** convert input items plus labour minutes into output items.

> **Stock quantities change only inside a work-procedure step or a consumption event. Never by fiat.** The physical-carrier law applied to inventory: if you cannot name the person who moved it, it does not move.

**Reordering is not special.** A procedure step that finds stock below threshold emits an order. **An order is a chain instance** — placed → accepted → picked → loaded → in transit → delivered — each step performed by an existing occupation. **Logistics needs no new machinery; it is the institutional chain engine pointed at goods.**

**The boundary is where it bottoms out.** A supplier's stock depletes and they order from outside the city at an externally-set price. That is the only legitimate exogenous number.

#### Money is two mechanisms

- **Physical cash is ordinary stock.** Denominations are items. A till can run out; a customer paying with a large note when the till holds three coins is an inventory failure the procedure branches on. **This makes the GDD's "the till runs short of change" fall out rather than being special-cased**, and gives payment method real texture — card settles against the account with no cash movement, cash moves stock both ways and can fail.
- **Bank money is a balance per holder**, used for evaluation. Physical cash is a rounding error against it.

---

#### Two kinds of job

- **Routine jobs** — barista, janitor, bus driver. A fixed sequence of steps over local state. Decisions are local and mechanical, expressible as procedure branches ("no beans → order", "no change → refuse the note").
- **Decider jobs** — manager, finance officer, mayor, developer. **Agenda selection over non-local information.** Not "how do I do this task" but "which of eleven things is today's problem." Not scriptable as a fixed procedure.

> **A decider is not a different kind of agent. It is a citizen whose work-time option set is matters instead of procedure steps.**

This follows P4's own rule: freedom scales inversely with supervision, so the least supervised post should be the most interesting one. A citizen's day is obligations plus own-time; **a decider's shift is entirely own-time.** The same utility evaluator serves a citizen's evening and a mayor's afternoon — no new decision machinery.

#### Matters: the inbox

A **matter** is an item of institutional business, scoped to a jurisdiction (a profession) and to a place, business, department or the city. A decider on shift scores the open matters in their jurisdiction, picks one, and acts.

**Four inbound fluxes. Every one has a person and a physical object; nothing arrives by detection.**

| # | Flux | Author | Carrier | Worked example |
|---|---|---|---|---|
| 1 | **Citizen-filed** | A member of the public | Complaint form, phone call, visit to the ward office | Marta passes an overflowing bin on her commute, weighs 8 in-city minutes against how much it bothers her, and files |
| 2 | **Worker escalation** | A routine job's procedure detecting an out-of-range condition | A note at the depot, a word at handover | Tomas tips at the landfill; the `tip` step reads refuse stock at 96% of capacity and branches to emit a report |
| 3 | **Inter-institutional request** | A chain needing a decision at this link | The paperwork itself | The sanitation manager's headcount request lands in the finance officer's inbox |
| 4 | **Calendar** | A scheduled obligation | Budget season, renewal date, inspection date | Quarterly budget review appears with deadline semantics — severity climbing steeply toward the date |

**Flux 2 replaces "a statistic crossed a threshold."** A threshold has no author; a driver noticing does. A routine job with no decisions still feeds the decision layer, because being somewhere is how you find things out — the same law that governs citizens and the burnt café.

**Volume is the signal.** Twelve complaints about one street *are* the aggregate. No statistic required.

#### Scoring a matter

Terms: severity · age (rising, so nothing starves indefinitely) · cost against available budget · jurisdiction fit · disposition · **who raised it**.

That last term reads the decider's own citizen memory. A complaint from someone the officer knows scores higher, so **institutional favouritism emerges with no system for it** — the addendum's "reputation without a system", unfarmable because there is nothing to farm.

**Approve, Deny, Defer and Escalate are all first-class actions.** A denied budget request is the GDD's institutional friction — chains stall, get denied, get expedited, and the consequence lands on citizens who never saw the paperwork.

**Deferral is not a black hole.** Deferred matters are the demand signal the calendar's budget review drains. That is how budgets actually work, and it makes deferral a real choice rather than a way to make a problem disappear.

#### Denial, resurfacing and burial

> **The request and the evidence are different objects.** A denial closes the chain. It does nothing to the complaints, which keep arriving because the condition persists and people keep walking past it.

The manager does not need to re-raise; **the world regenerates the signal**. That breaks the repeat-request loop without a cooldown timer.

**What the manager learns:** a decision record carries the action, a reason code, and **the severity at the time of the decision**. Re-raising the same request for the same scope scores near zero unless current severity exceeds the severity at denial by a margin — **material change, not a timer.** Structurally identical to citizen memory: a stored fact that changes future scoring and self-obsoletes when the world moves past it.

**Four trait-weighted responses to denial:**

| Response | Gated on | Behaviour |
|---|---|---|
| Wait | caution | Accept; re-raise only on material worsening |
| Escalate | ambition | Re-raise with a *different* jurisdiction — over their head |
| **Substitute a cheaper mechanism** | diagnostic breadth | Headcount denied for lack of budget → request **overtime** instead |
| Reroute permanently | reason code = wrong jurisdiction | This jurisdiction was never right, and the manager now knows |

The substitution path is worth protecting: the diagnostic offers several options at different costs, so **denying the expensive one makes the cheap one relatively more attractive**. Institutions under budget pressure visibly degrade into stopgaps — overtime instead of hiring, patching instead of resurfacing — emergent from a cost comparison rather than authored.

**Burial, three ways:**

1. The condition is fixed by another route — a different chain, a business tidying up, a citizen binning the bottle (M7 civic verbs). Complaints stop, severity decays, matters expire.
2. **Severity plateaus below the denial mark.** The street stays bad, nobody re-raises. **That is the story.**
3. **Matter expiry** after N in-city weeks if unresolved and unrefreshed — the **D13 game-mechanical bound** on the matter table, which is therefore bounded by complaint rate × expiry window rather than by cumulative history.

**Watch — habituation.** If residents stop noticing a bad street, complaints dry up, severity decays, and the problem becomes permanent with nothing pursuing it — starving the signal rather than drifting, but violating the equilibrium law all the same. Newcomers regenerate it, since they have not habituated, which ties renewal to L1's in-migration. **If disposition-to-file decays with familiarity, give the decay a floor**, or the ratchet is hand-built.

#### Traits

**Per citizen, universal — every citizen has them, not just deciders.** A small fixed vector: caution, ambition, diligence, sociability, frugality. They are weights in the *same* utility evaluator that scores an evening and an inbox, which is what avoids decider-specific special-casing.

`diligence` does double duty — the GDD's "self-imposed standards" (cleaning the lobby is never required, tracked or rewarded) and a finance officer's thoroughness, from one number.

#### How L1 influences citizens

**It does not have a will. It changes the numbers citizens are already reading.**

- **Directly** — an employer raises an offered wage; nobody is told; some citizens' job-change utility crosses its threshold at their next decision point. No assignment, no push.
- **Indirectly** — a decision starts a chain, the chain changes the physical world, and citizens perceive the change by being there.

#### Worked traces

**Trash.** L2 runs it; balance emerges from headcount. When it tips: degraded streets are physical, so passing citizens file complaints. The sanitation manager scores the inbox; the Alder Street cluster wins on volume × age. They diagnose by reading the world directly — three postings unfilled two weeks, trucks operational, landfill at 96% — pick headcount, and start a chain whose first step is budget approval. **If the finance officer denies it, the trash stays, and the reason is a conversation in a building the complainant has never entered.**

**Café beans.** Stock decrements per espresso inside the barista's procedure. Below threshold it emits an order; the chain delivers. The supplier's own stock depletes and they order across the boundary. The number of cafés affects aggregate order volume, which moves the external price — the only place a number arrives from nowhere, and legitimately so.

**Potholes.** "Minutes until repaired" was the *output* modelled as the input. Correctly: a pothole is a physical object that slows traffic — a real cost in minutes. Citizens passing it file. The roads manager acts, needing budget, asphalt (stock, ordered across the boundary) and a crew (citizens choosing the job at an offered wage). No budget, no repair.

**Growth.** Pure L2 grows nothing; three separate mechanisms, none of them L1 acting. **New businesses** are an L2 own-time decision — a citizen with savings weighs unmet local demand, vacant premises rent, capital and qualifications. **New buildings** come from a developer role acting on housing pressure through a development chain. **New citizens** are in-migration — exogenous, modulated by the city's attractiveness to people outside it.

#### Open

- Whether any materialised aggregates are needed at all, and which — a performance question, deferred to measurement.
- Whether statistics should require a *producer role* (a census clerk whose post can go vacant, making stale information a staffed bottleneck). On-theme and player-holdable, but more machinery. **v1: no.** Revisit at E12.

### D10 — Asset pipeline  [decided]

Prop delivery is settled in D2 (whole-object singles, theme-grouped atlases, content-hashed pages, `defs_version`). What remains:

#### Characters are a layered generator, not spritesheets

Inspected 2026-08-28: `2_Characters/Character_Generator` ships **511 parts** across `Bodies`, `Eyes`, `Hairstyles`, `Outfits`, `Accessories` (plus `_kids` variants and held props — `Books`, `Smartphones`), alongside premade characters.

> **A citizen's appearance is a tuple of layer indices**, not an asset reference.

Consequences:

- **Five or six small integers per citizen** gives combinatorial variety at negligible storage.
- **Recognisability becomes mechanical.** The tuple is stable, so the same barista looks the same every time — which is what the GDD's recognisability constraint requires and had no mechanism for.
- **The outfit layer can be role-driven.** A janitor wears the janitor's outfit, so **occupation is visible** — a physical carrier that lets a player read a street's labour composition by looking at it.
- **Held props** (phone, book) are a layer L3 can drive as flavour.

**Rendering:** the runtime caches each unique composite into a texture, so a citizen costs one draw call rather than six. With ~200 visible and heavy repetition across the population, this collapses cleanly.

#### Audio assets

To be sourced (per the GDD). Same treatment as atlases — CDN, content-hashed, service-worker cached, loaded by neighbourhood.

#### One build, one version

A single build command emits prop atlases, character-part atlases, `object_def` and the audio manifest under **one `defs_version`**. Nothing versions independently, so a stale client is detectable at connect with a single comparison.

### D15 — Audio  [decided]

**Web Audio directly, or a very thin wrapper.** A full audio library is bundle weight the boot budget cannot spare for a game with no composed score.

- **Ambient beds** crossfaded by environment (interior/exterior), neighbourhood character and time of day.
- **Interior/exterior transition by low-pass filter** — cheap, and it *is* the GDD's "room tone that changes when you step indoors".
- **Positional one-shots** from world events near the player. Diegetic music — a radio, a busker — is a positional emitter, not a music system. There is no music system.
- **Audio reads the same derived state as the renderer.** No separate audio simulation.

**Earshot is deliberately larger than the viewport.** A tram heard but never seen is evidence the city is running, and it extends the player's sensor past the screen edge for almost nothing. The GDD names this as a legibility channel; designing the radius deliberately is what makes it one.

### D16 — Input  [decided]

Mouse and keyboard only. WASD/arrows for continuous movement; click to interact.

> **Input produces intents, not actions.**

A click resolves to an object instance via the derived grid, checks reachability against the definition's `interact_at`, and emits an intent. What the intent *means* is the procedure's business.

**Rationale:** A1 — the multi-step procedure interaction model (grind → dose → tamp → pull) — is explicitly unresolved and is resolved by prototyping in E6. A generic input layer lets E6 iterate on procedure feel without touching input.

Movement is local and immediate (client-authoritative, per D9). Keybindings live in `localStorage` behind E1's options menu.

### D17 — UI  [decided]

> **All UI is DOM. Nothing is drawn into the canvas that is not in the world.**

*(Amended below — see "D17 amendment: transient object-bound views". The canvas may draw transient, object-bound container views; it may never draw anything persistent, global or abstract.)*

This makes the no-HUD design law **structural rather than disciplinary**: there is no in-canvas UI layer, so there is nowhere to accidentally put a counter. DOM is additionally instant at first paint (which D6 depends on), costs no atlas space, and is accessible by default.

**The UI surface is small by design:** the boot name prompt, an options menu (audio, display, controls), and connection-state notices.

**Anything informational that belongs to the fiction is rendered in the world** — job boards, council notices, the pile of post on the table, a certificate on the wall.

### D-ANIM — Animated objects  [decided]

Additive over D2, and legal under D12 (fields appended with defaults).

- **Two kinds.** *Looping* — a fan, water, neon. *State-driven* — a door, a till drawer. The state hookup waits for S9.
- **Client-side and non-authoritative**, like L3.
- **Phase seeded from the object id**, so every client shows the same frame at the same time — the same determinism rule as L3 flavour behaviour.
- **Characters are a separate path:** directional walk cycles driven by movement, applied per appearance layer.

### D10 amendment — character composition detail

Inspected 2026-08-28. Each of the five character parts (`Bodies`, `Eyes`, `Outfits`, `Hairstyles`, `Accessories`) is a **complete spritesheet containing all animations**, not a single frame.

**Invariant to verify once and then rely on:** all five sheets share an identical frame layout, so one `(animation, direction, frame)` index selects the corresponding cell from each.

**Appearance is five indices per citizen** — body, eyes, outfit, hairstyle, accessory. The client renders from atlases it already holds. That is the whole of the data model.

**Rendering order is character-major and y-sorted, as for everything else.** An earlier concern that layer-major batching would be required is withdrawn: PixiJS's batcher draws objects with different textures in a single draw call, uploading textures as arrays up to a GPU-dependent texture-unit limit (commonly 16 on desktop, sometimes lower).

**What survives is a packing rule, not an architectural constraint:** keep the number of *simultaneously bound* atlases under the GPU limit — five character layers plus tile and prop atlases should sit around eight. A build-time constraint on how pages are packed.

**B8 (revised):** confirm bound-texture count stays under the limit on target hardware. The earlier framing ("does the working set fit one atlas?") is retracted as unnecessary.

**E1 scope note:** this is more than splitting spritesheets. It includes an **appearance generator** producing *coherent* tuples — kids parts with kids bodies, role-appropriate outfits — deterministic from citizen id so a citizen looks the same forever. A small data-driven grammar, not a random number.

### D17 amendment — transient object-bound views

The original rule ("all UI is DOM; nothing is drawn into the canvas that is not in the world") does not survive pixel arithmetic: five bags of beans do not fit in an opened cupboard, and forcing them to would mean either absurd capacities or invisible contents.

**Amended rule:**

> **The canvas may draw transient, object-bound views. It may never draw anything persistent, global, or abstract.**

The structural guarantee against a HUD is preserved — a HUD is by definition persistent and global, so there is still nowhere to put one — while a cupboard can open. A container view drawn in the game's own pixel style reads more diegetically than a DOM panel would.

DOM remains for what is genuinely outside the fiction: the boot name prompt, the options menu, connection-state notices.

### D19 — Inventory  [decided]

| Situation | Treatment |
|---|---|
| **On a surface** — table, counter, shelf | Visible in-world, sub-tile positioned. **No view.** Sorts above the furniture it rests on via `layer_rank` (Objects 10 > Furniture 0), already handled by D3 |
| **In a container** — cupboard, drawer, fridge, bag, crate, vehicle | **A transient container view**, opened on that container, showing its actual contents |

#### Grid inventories

Containers hold items on a **grid, Tetris-style**, with rotation.

- **Item footprints are reused from D2.** A thing occupying 3×2 cells in the world occupies 3×2 in a container. No second authoring pass, and consistency is automatic — a car does not fit in a cupboard because it genuinely does not.
- **Container grid size lives on the object definition** — cupboard 4×3, bag 3×2, crate 4×4, pallet larger.
- **Capacity is spatial**, which preserves storage as a real resource without depending on world-pixel visibility.

#### Consequence: discrete instances vs bulk quantities

D14's stock model — `(holder, item, quantity)` — is correct for bulk and wrong for discrete things that occupy specific cells and carry their own state. Grid inventory makes the split explicit:

- **Discrete items are instances**, with a position inside their container, or in the world a cell plus sub-tile offset
- **Bulk is a quantity held *inside* a discrete container object** — a sack of beans is an instance occupying 1×2 and holding 340 g

Same nesting as "aggregation is physical" (D14), and the instance model is what S9's props-with-state needs regardless. The design choice clarified the data model rather than complicating it.

#### No parent relationship

An item is in exactly one of two states, both of which already exist:

- **Placed in the world** — cell, sub-tile offset, floor. If the furniture it rested on is deleted, the item stays where it is. Acceptable.
- **Held by a container** — D14's holder, now with a grid position for discrete items.

No third concept. The "in a cupboard" case never needed a world position.

#### NPCs use the same grid

**First-fit on the real grid, never an abstract volume check.** An abstract capacity test would let an NPC fit what a player could not — a mechanical seam, which P2 forbids. First-fit is trivial at these grid sizes, citizens pack rarely, and it produces an actual layout, so there is no seam and no meaningful cost.

#### Loading a vehicle becomes work

A delivery vehicle has a grid, so a round is a packing problem. Nobody scores it; a badly packed van simply fits less and the driver makes two trips.

That lands in P4's territory — *an action is worth simulating when it can be performed badly* — and it is an unsupervised task with real consequence, which is what E6's Burger Test is trying to establish. **Logistics stops being a background system and becomes a job.**

#### Recorded risk

Grid inventories are a known source of tedium, and here the cost is paid in **the only currency the game has**: minutes spent packing are minutes not spent on a life.

The dials are **grid sizes** and **how often a packing decision is forced**. Storing your shopping should be a moment; running a warehouse shift should be the job. If packing becomes the dominant interaction the design has drifted. **Watch in E6**, alongside the procedure-model prototyping (A1), since the two will be felt together.

---

## Cross-cutting Concerns

Patterns that apply to ALL systems. Every implementation must follow them.

### Error Handling

**Server (Rust reducers):** return `Result`, use `?`. An `Err` aborts the transaction cleanly. **Never panic in normal flow.** On a world that cannot be regenerated, aborting is always better than writing inconsistent state — SpacetimeDB's transactional reducers give that for free.

**Client (TypeScript):** a bad row, an unknown `def_id` or a failed asset load must never kill the frame. Per-frame guards around object rendering, a global handler for the rest. **Degrade to not-drawing, never to crashing.**

**The distinguishing rule — this game is unusually full of failure-shaped situations that are not failures:**

> **If a person in the world could observe it and shrug, it is not an error.**

Empty till · no beans · denied budget · closed café · blocked route · stalled chain — **all content, none errors.** A citizen referencing a nonexistent business is an error.

Without this rule, agents will wrap half the game in error handling and log-spam the institutional friction that *is* the story.

### Logging

**Log by exception, not by event.** At ~111 transactions/sec normal-operation logging is unusable. Errors and anomalies always; normal flow off or sampled.

**Structured fields over prose** — `citizen_id`, `chunk`, `reducer`, `chain_id`. The world runs unattended for years, so logs exist to answer "what happened at 03:12 last Tuesday", which requires them to be greppable.

**Logging and observability are separate systems and must not be merged.** D13's metrics answer *"is something drifting?"* and go to a table watched externally. Logs answer *"what happened?"* and go to the platform's log facility.

### Configuration

Three tiers, split by how often a thing changes and who changes it.

| Tier | Contents | Where |
|---|---|---|
| **Constants** | Tile size 16 · day = 60 real min · layer ranks | Compiled; single source with a generated TS mirror |
| **Balance** | Decision-function parameters and rates | **Tables**, seeded on init, runtime-tunable |
| **Definitions** | `object_def`, recipes, chain templates, professions | Baked with the build, under `defs_version` (D2) |

> **Definitions describe what things are. Balance describes how strongly things pull.**

**Balance is in tables, not compiled.** Balance will be tuned hundreds of times across a multi-year build; making each tweak a live-world republish (D12) is a permanent tax. Reads are in-memory, so the indirection costs nothing.

**What balance contains — parameters of decision functions, never the values they produce.** There is no city-wide rent or wage (D14): each landlord and each employer sets their own, and those are emergent state.

- **Utility weights** — minutes vs quality vs habit in source choice · bar decay rates and curve thresholds · trait multipliers · matter scoring weights (severity, age, cost vs budget, jurisdiction fit, who raised it)
- **Adjustment coefficients** — employer wage rise per in-city week of vacancy and its revenue ceiling · landlord rent response to desirability and **maximum change per period**, which is where "pressure is legible, never sharp" actually lives · price response to stock turnover · reorder threshold · D14's denial margin
- **Rates and probabilities** — litter per consumption event · complaint filing probability **and its floor** (per D14's habituation risk) · matter expiry window · habit growth and decay per visit · the `citizen_memory` LRU cap
- **Simulation dials** — body zone radius and despawn hysteresis · position update rate · prefetch lead distance

**Live parameters vs seed values — mark them visibly.**

| | Read | Effect of tuning a running world |
|---|---|---|
| **Live parameters** | At every decision point | Immediate, from the next decision |
| **Seed values** | Once, at world generation | **None. The city already exists** |

The GDD's economic figures — 250/week starting flat, 10 per in-city hour, ~90/week necessities, 450 bike, 20/week transit pass — are all **seeds**. Someone will eventually try to tune "starting rent" on a live city and be confused; the marking is what prevents that.

**Shape:** a flat key → value table with a **documented key registry**, so values are enumerable — observability can display them and an agent can find one without grepping. Global by default; scoped overrides (per profession, per ward) only where a case demands one, never speculatively.

### Event System

**Do not build one.** SpacetimeDB *is* the event system: a reducer writes a row, subscribers are notified.

> **No server-side event bus. If a system needs to know something, it reads a table.**

A second, invisible causality path is exactly what agents would otherwise invent.

**Client:** the SDK's `onInsert` / `onDelete` / `onUpdate` callbacks feed the local store. A small typed emitter is acceptable for client-internal decoupling (input → systems, audio triggers) — a few dozen lines, not a framework.

### Debug Tools

**Time control is not optional and is the highest-value tool in the project.** One in-city day is 60 real minutes and rent falls weekly, so **debugging a rent cycle at normal speed costs seven real hours.** A clock multiplier and the ability to jump the clock are what make iteration on anything weekly or seasonal practical for a solo developer.

In descending value after that:

- **Causality inspector** — "why is this citizen here?": L2 state, route, current matter, last decision. This is **the Truth Test as a tool** — if you cannot answer *why*, something is wrong by definition
- **Overlays** — collision footprints, navmesh, chunk boundaries, sort order, citizen routes
- **Matter / chain inspector** — an institution's inbox and its chains' states
- **Determinism harness** — regenerate from seed and diff (serves R3)

**Activation:** compiled in, gated behind a flag not exposed in production.

**Presentation:** DOM or a deliberately non-diegetic style. With no HUD in the game (D17), debug overlays must be unmistakably not part of the world.

---

## Project Structure

### Organization Pattern

**Domain-driven within each build target, with boundaries as the organising principle.** The stack dictates the top level: two build targets that share **no code** (D2), plus an offline pipeline and a single data source of truth.

### The load-bearing rule

> **`sim/` is pure. `reducers/` touches tables.**

Reducers read tables, call pure functions, write tables. All decision logic — utility scoring, matter scoring, diagnostics, appearance generation, distance estimation — lives in `sim/` with **no table access at all**.

This is what makes property testing possible: thousands of simulated citizen-weeks in CI with no database. Without it, every invariant recorded in this document is untestable — no matter starves indefinitely, inventory is a superset after any absence, budget never goes negative, `collider ⊆ footprint`, step bounded by rate limit.

It is also **the only boundary in the project that can be violated silently.** Everything else is enforced by the compiler or by the platform.

### Directory Structure

```
BrowserCity/
├── defs/                    # SOURCE OF TRUTH — data, not code
│   ├── objects/             #   footprints, colliders, sprites, layer, grid
│   ├── items/               #   units, perishability, bulk
│   ├── recipes/
│   ├── professions/         #   procedures, jurisdictions, role triggers
│   ├── chains/              #   templates: steps, actors
│   └── balance/             #   seed values for the balance table
│
├── server/                  # Rust SpacetimeDB module
│   ├── src/
│   │   ├── tables/          #   table declarations by domain
│   │   ├── sim/             #   PURE. No table access. Property-tested
│   │   │   ├── utility/     #     citizen own-time scoring
│   │   │   ├── matters/     #     decider scoring, diagnostics
│   │   │   ├── nav/         #     Manhattan estimate, A*
│   │   │   └── appearance/  #     coherent tuple generation
│   │   ├── reducers/        #   read -> call sim -> write
│   │   │   ├── citizen/     #     L2 transitions, scheduled table
│   │   │   ├── institution/ #     matters, chains, decisions
│   │   │   ├── economy/     #     stock, orders, accounts
│   │   │   ├── boundary/    #     L1: external prices, migration, weather
│   │   │   ├── world/       #     tile objects, generation, nav patches
│   │   │   └── player/      #     movement, interaction intents
│   │   ├── clock/           #   in-city time
│   │   ├── config/          #   balance table access, constants
│   │   └── debug/           #   time control, inspectors
│   └── tests/               #   property tests over sim/
│
├── client/                  # TypeScript + PixiJS
│   ├── src/
│   │   ├── boot/            #   DOM prompt, connect, first frame
│   │   ├── net/             #   SDK bindings, subscription management
│   │   ├── world/           #   derived grids: collision, walkability, tilemap store
│   │   ├── render/          #   PixiJS, sort key, passes, atlases
│   │   ├── entities/        #   character composition, animation, interpolation
│   │   ├── l3/              #   micro brain: steering, avoidance, flavour
│   │   ├── input/           #   intents, keybindings
│   │   ├── ui/
│   │   │   ├── dom/         #     options, notices — out of fiction
│   │   │   └── canvas/      #     container views — transient, object-bound only
│   │   ├── audio/
│   │   └── debug/
│   └── public/
│
├── tools/                   # offline pipeline
│   ├── atlas-packer/        #   theme-grouped pages, content-hashed
│   ├── footprint/           #   S23: propose -> classify -> validate -> contact sheet
│   ├── defs-build/          #   defs/ -> Rust include + client asset, one defs_version
│   └── character-parts/
│
├── ModernTileset/           # source art (existing)
└── _bmad-output/            # planning artifacts (existing)
```

### System Location Mapping

| System | Location | Note |
|---|---|---|
| L1 — the boundary | `server/src/reducers/boundary/` | Deliberately small. It is the boundary, not a layer |
| L2 — citizen brain | `server/src/reducers/citizen/` + `sim/utility/` | Transitions impure, scoring pure |
| L3 — micro brain | `client/src/l3/` | Client-side, non-authoritative (D-L3) |
| Matters, chains, deciders | `server/src/reducers/institution/` + `sim/matters/` | |
| Stock, orders, money | `server/src/reducers/economy/` | |
| Nav graph, walkability | `server/src/reducers/world/` + `sim/nav/` | Client holds only derived walkability |
| Collision (player) | `client/src/world/` | Server does no sub-tile collision (D2) |
| Depth sorting | `client/src/render/` | |
| Character composition | `client/src/entities/` + `sim/appearance/` | Tuple generated server-side, composited client-side |
| Container views | `client/src/ui/canvas/` | D17 — the only in-canvas non-world element |
| Observability | `server/src/debug/` + external watcher | D13 |

### Architectural Boundaries

| # | Rule | Why |
|---|---|---|
| 1 | **`sim/` never reads a table.** Reducers pass data in and take results out | Property-testable without a database |
| 2 | **No code is shared between `server/` and `client/`** | D2 — authority splits by consequence, so there is no common logic. The two footprint parsers are deliberate, not an oversight |
| 3 | **`defs/` is the only source.** Both targets consume *generated* output, never each other | One `defs_version` covers atlases, definitions and schema |
| 4 | **The client writes only player position and intents** | Everything else is server-authoritative |
| 5 | **`ui/canvas/` holds container views and nothing else** | D17 — the structural guarantee against HUD creep is a directory with exactly one job |
| 6 | **`server/` never names a rendering concept; `client/` never names a simulation one** | Sort order and atlases are not the server's business; wages and chains are not the client's |

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Rust modules, functions, fields | `snake_case` | `score_matter`, `citizen_memory` |
| Rust types | `PascalCase` | `MatterKind` |
| TypeScript files | `kebab-case.ts` | `sort-key.ts` |
| TypeScript types and classes | `PascalCase` | `CollisionGrid` |
| TypeScript functions and variables | `camelCase` | `deriveCitizenPosition` |
| Data files in `defs/` | `kebab-case` | `city-props.toml` |
| **Data keys** | `snake_case` | Matches Rust, so no translation layer |
| Balance keys | `snake_case` with dotted namespace | `citizen.bar_decay.rest` |
| Table names | `snake_case`, **singular** | `citizen_state`, not `citizens` |

---

## Implementation Patterns

These patterns ensure multiple AI agents write compatible code. Each one has already appeared two or more times in this document's decisions — that is the test for inclusion: *any time multiple agents might make the same decision differently.*

Code fragments below are **illustrative of shape**, not committed schema.

### Novel Patterns

#### P1 — Divergence storage ("store the surprise")

*Appears in:* citizen memory of places · denial records · cached routes.

> A row exists **only** where reality diverges from the public default. An absent row means "use the default". Rows are written **on surprise**, and are **self-clearing** — when reality returns to the default and is observed, the row is deleted.

```rust
// NOT: a row per citizen per place, kept current
// BUT: a row only where this citizen knows something others do not
match memory.get(citizen, business) {
    None    => public_default(business),   // I know nothing special
    Some(m) => m.known_state,              // I saw something
}
```

Near-zero write volume, no expiry sweep, and knowledge diffusion emerges for free. **Any agent adding a "what does X know about Y" feature must use this shape**, never a full-coverage table.

#### P2 — Derive, don't store

> Store only what a **query must filter on**. Derive everything else.

Citizens carry no `x`/`y`; position is a function of `(location_state, now)`. `chunk` exists **only** because subscriptions filter on stored columns — and that justification is itself the pattern: **if you cannot name the query that needs a column, the column should not exist.**

#### P3 — The matter inbox

Four fluxes (citizen-filed · worker escalation · inter-institutional request · calendar) → jurisdiction-scoped inbox → scored → acted upon.

**This is how all institutional response works.** An agent adding a new municipal service — schools, water, licensing — adds flux sources and profession definitions. It **never** adds a bespoke trigger, and it **never** adds a system that detects and acts in one step.

#### P4 — Every state change has an author

> **If you cannot name the person who did it, it does not happen.**

Stock moves inside a procedure step. Matters carry an origin. A landfill at 96% does not raise itself — a driver tips there and reports it.

**The failure this prevents is the most likely one in the whole project.** Writing a scheduled reducer that scans for a condition and acts on it is fast, obvious, and idiomatic for the platform — and it destroys the Truth Test, the physical-carrier law and P2 simultaneously. **Any reducer that both detects a condition and changes the world without a citizen in between is wrong by construction**, however well it performs.

#### P5 — Pure decision, thin reducer

```rust
// reducer: marshal, call, write
let opts   = load_options(ctx, citizen);
let choice = sim::utility::choose(&state, &opts, &params);   // pure, no ctx
apply(ctx, citizen, choice);
```

`sim/` never reads a table. This is Step 6's structural boundary restated as a coding rule, and it is what makes every invariant in this document property-testable.

#### P6 — Bounded tables

Every table declares a bound — **game-mechanical** (sanitation clears litter) or an **engineering ceiling** (per-chunk cap) — and registers with the metrics sampler. **An unbounded table is a bug**, checkable in review.

#### P7 — Additive schema only

New field → **appended column with a default**. New concept → **new table plus read-through backfill**. Never rename, never retype, never drop. **Primary keys and unique constraints are permanent** and cannot be added later. Anything that might ever need scheduling is **created as a scheduled table**.

#### P8 — Codes, not enums

`u32` code plus a companion data table. A new enum variant is a *type modification*, which automigration forbids — so a new matter kind, provision, or reason code is a **row insert**, never a migration.

#### P9 — Seeded client derivation

> Anything the client computes that must agree across clients is seeded from **stable ids**, never from local RNG.

L3 flavour from `(npc_id, tick_bucket)`. Animation phase from object id. Appearance from citizen id.

The rule exists because D-L3 accepted client-side simulation on the explicit basis that divergence is bounded to what nobody checks. **Unseeded randomness silently voids that bargain.**

### Standard Patterns

| Category | Pattern |
|---|---|
| **Communication** | Tables and subscriptions. **No server-side event bus.** Client: SDK callbacks feeding a local store, plus a small typed emitter for input/audio decoupling |
| **Entity creation** | Rows, created in reducers. No factories, no server-side pooling. **Definitions are data in `defs/`**, never constructors |
| **State transitions** | L2 is a state machine advanced by the scheduled table; chains are declared step sequences. **Both are data, not code** |
| **Data access** | The three tiers — constants compiled, balance in tables, definitions baked under `defs_version` |
| **Client object lifecycle** | Instantiate from derived truth on subscription; despawn snaps to the ledger; **L3 never writes** |

### Consistency Rules

| Rule | Enforcement |
|---|---|
| `sim/` has no table access | Review, plus the fact that its tests run with no database |
| Every table declares a bound | Review; the metrics registry is the artefact |
| **No detection-without-an-author** | Review — **the rule most likely to be broken, and the most damaging** |
| Codes not enums for any extensible set | The compiler will not catch this; review must |
| Client-derived values seeded from stable ids | Property test: two derivations from identical inputs match |
| No new field without a default | **Enforced by the platform** — the publish fails |
| Primary keys correct in the first commit | Enforced by the platform, permanently and unforgivingly |

---

### D20 — Body drivers and reciprocal occupancy  [decided]

Closes validation gap G1. The night shift and the understudy looked like two systems; they are one.

> **A citizen body has exactly one driver, and the driver is swappable: its own L2 · an understudy · a player.**

| Situation | Driver |
|---|---|
| Player connected, awake | `Player` |
| Player disconnected | `Understudy` |
| Player past bedtime, on a borrowed night shift | The borrowed NPC's driver becomes `Player` for the shift, then reverts |
| Any unheld institutional post | `SelfL2` — AI backfill is simply L2 continuing |

**No new machinery**, and it makes P2's "no mechanical seam between a player-held and an AI-held role" structural rather than aspirational: the seam cannot exist, because there is one slot with three possible occupants.

#### Handover is mid-procedure, in both directions

> **The procedure state machine is the shared substrate. Whoever drives the body, the same procedure advances.**

The driver determines *how* a step is performed — a player does it by hand, L2 does it by scheduled transition — never *what the state is*. L2 state is **never suspended** while a player drives; it is advanced by their actions instead. On handover back, the scheduled reducer resumes from the current step.

**Two failure modes, both closed:**

1. **Abandonment mid-step.** A player drives a bus halfway between stops and disconnects. **Handover snaps to the current step boundary** and resumes — the route step already knows which stops remain. Simpler than resumable sub-step state and indistinguishable in practice.

2. **A player doing what L2 cannot represent.** If a player could take the bus off-route, L2 would have no state for "bus in a field."

> **The discretionary middle must be discretionary *within* the procedure's state space.**

A player may perform a procedure well or badly — that is P4 — but never *outside* it. Otherwise every borrowed shift is a potential unrecoverable state, and the seam P2 forbids returns as a bug.

**Bookkeeping:** taking over cancels the citizen's pending scheduled transition; handing back re-creates it. Scheduling is transactional with the state change, so neither can be lost.

**Policy carried from the GDD:** the borrowed shift is bounded and paid, and consequence lands on the NPC rather than the player (A10, recorded there as untested).

### D21 — Generation architecture  [decided]

Closes validation gap G2 — partially. **Scope is split three ways:**

| Where | What belongs there |
|---|---|
| **GDD** | What neighbourhoods should *feel* like; the four parameters (density, building age, affluence, land-use mix). **Already complete** — it explicitly delegates character to generator parameters |
| **This document** | The **shape** of the rule system: passes, rule expression, validation, versioning, emission |
| **A generation design doc owned by E3** | The rule **content** — hundreds of placement constraints, adjacency tables, density curves. Its own artifact, authored incrementally |

"Tile adjacency" understates the problem: *spread municipal services evenly* is a distribution rule over a district, *no skyscraper among villas* is neighbourhood coherence, *no café on the tenth floor* is a placement constraint. Three rule kinds at three scales.

#### Multi-pass, coarse to fine

Each pass consumes the previous pass's output and adds detail:

```
land use -> street network -> plot subdivision -> building envelope
         -> building type -> interior layout -> prop placement
```

#### Rules are data, not code

Adding "no café above floor 2" is a row in `defs/`, evaluated by a generic engine. Same lesson as D14: a rule per special case is the failure mode, not the design.

#### Five constraint kinds

| Kind | Example |
|---|---|
| **Placement** | A café may not appear above floor 2 |
| **Distribution** | Municipal services at ~1 per N dwellings, evenly spread |
| **Coherence** | A type must suit its neighbourhood parameters — no skyscraper in a villa district |
| **Adjacency** | Tile-level: what may abut what, how a doorway is formed |
| **Requirement** | Every dwelling has a door; every room has a light; every business has stock space |

#### One rule set, two consumers

The generator **applies** the rules; E2's validation harness **checks output against the same rules**.

> **If the two ever read different sources, the result is silently bad content** — A5's risk in its most dangerous form. They must read one source.

#### Determinism and versioning

`seed + rule-set version -> the same city`. The city records the rule-set version it was generated under, and **rule changes do not regenerate it** (R3, R8).

**Consequence, and a welcome one:** E13's new neighbourhoods run under the *current* rules, so a district extended two years later can look visibly different from the original. That is not a defect — it is how cities actually look, and it gives the growth mechanism free historical texture.

**Incremental extension (E13):** the same passes run over new area, constrained by adjacency to what already exists.

---

## Architecture Validation

**Date:** 2026-08-28

### Validation Summary

| Check | Result | Notes |
|---|---|---|
| Decision Compatibility | ✅ **PASS** | **8 conflicts found and fixed** — see below |
| GDD Coverage | ✅ **PASS** | 4 gaps found; G1 and G2 closed, G3 and G4 recorded |
| Pattern Completeness | ✅ **PASS** | All standard categories plus 9 novel patterns, each with an example |
| Epic Mapping | ✅ **PASS** | Every epic supported or blocked only on a documented deferral |
| Document Completeness | ✅ **PASS** | No placeholders. Versions verified against live sources with dates |

### Conflicts found and resolved

The document had accumulated stale text as later decisions overturned earlier ones. **An agent reading the Project Context section would have implemented a two-mode L2 that no longer exists.**

| Location | Was | Now |
|---|---|---|
| S17 | L1 does allocation, market clearing, chain initiation | Revised — D14 dissolved clearing; L1 is the boundary |
| S18 and the L2 cadence row | "dual-mode: event-scheduled when far, **ticked when near**" | **At transitions only. Nobody ticks** |
| "One L2, two advance modes" | Two modes kept in agreement | **One mode.** Clients interpolate for rendering |
| S5 | "Variable-resolution simulation" as a system | **Collapsed into S6** — resolution follows attention through *body instantiation* |
| Complexity driver #1 | "a single L2 with two advance modes" | Restated |
| Dependency order, Phase 4 | listed variable resolution | Removed |
| D17's original rule | stated flatly, amended 35 lines later | Flagged as amended inline |

**The S5 collapse is a genuine simplification that had never been written back:** there is no variable-resolution subsystem. Every citizen advances identically; cost varies because bodies exist only where someone is looking.

### Gaps

| # | Gap | Disposition |
|---|---|---|
| **G1** | The night shift / borrowed body — zero coverage | ✅ **Closed by D20** |
| **G2** | Generation rules beyond tile adjacency | ✅ **Frame closed by D21**; content assigned to an E3 design doc |
| **G3** | No frame budget allocated across renderer, L3 and UI against the 60 FPS target | **Open** — resolve with B3/B8 measurement rather than on paper |
| **G4** | In-city clock authority — how time is computed, who reads it, whether clients derive it | **Open** — small, but undecided |

### Deliberate deferrals

S9 interactable state and the procedure machine → resolved by prototyping in E6 (A1) · D18 sharding → measurement (R4) · materialised aggregates → measurement · chain engine detail → described in D14, specified at build.

### Coverage Report

- **Decisions made:** 21 (D1–D21, D-VIS, D-L3, D-ANIM), one deferred (D18)
- **Novel patterns defined:** 9
- **Verification tasks outstanding:** 7 (B1–B4, B6–B8)
- **Escalations to the GDD and epics:** 5

---

## Development Environment

### Prerequisites

| | Notes |
|---|---|
| **Rust toolchain** via rustup, with `rustup target add wasm32-unknown-unknown` | Modules compile to WebAssembly |
| **SpacetimeDB CLI** | `curl -sSf https://install.spacetimedb.com | sh` — **Windows install method must be confirmed from current docs**; the shell installer is the documented Unix path |
| **Node.js** with a package manager | Client build (Vite) |
| **ModernTileset** | Already in the repository — 23,519 PNGs, 135 MB |

### Setup

```bash
# Server module
spacetime init --lang rust --project-path ./server browsercity

# Client
npm create vite@latest client -- --template vanilla-ts
cd client && npm install pixi.js spacetimedb

# Client bindings from the module schema
# (verify current flags against the CLI's own help)
spacetime generate --lang typescript --out-dir client/src/net/bindings

# Iterate with hot reload — rebuilds and republishes on save
spacetime dev

# Publish
spacetime publish <database-identity>
```

### AI Tooling (MCP)

| Tool | Purpose | Source |
|---|---|---|
| **`spacetime mcp`** | Official MCP server over stdio, bridging to SpacetimeDB's HTTP MCP route (v2.8.1) | SpacetimeDB CLI subcommand |
| **Official Claude plugin** | Bundles agent skills and the MCP server (v2.8.2) | Ships with SpacetimeDB |
| **Context7** | Current-documentation lookup — material on a platform releasing weekly | `upstash/context7` |
| **PixiJS agent skills** | Official, June 2026 | PixiJS |

Community SpacetimeDB MCPs exist (`fractaloutlook`, `Fail2Fail-Studios`, `karutoil`); the first-party option supersedes them.

### First steps, in dependency order

1. **Stand up the module and client skeletons**, and confirm a round trip — a row written server-side appears in the browser.
2. **Run the early spikes before anything depends on them.** In priority order: **B7** scheduled-reducer timing fidelity (the entire far-agent model rests on it, and it has been patched twice in a month) · **B6** backup/restore semantics, plus a tested logical export, *before the world holds anything worth losing* · **B3** boot budget.
3. **Fix the permanent decisions first.** Primary keys, unique constraints, and any table that might ever need scheduling cannot be changed later (D12). Get them right in the first commit.
4. **Build `defs/` and `tools/defs-build/` before content.** One source, two generated consumers, one `defs_version`.
5. Then Phase 0 of the dependency order: world data model, collision, player movement.
