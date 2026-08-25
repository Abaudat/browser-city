---
title: "Game Brief Addendum: BrowserCity"
status: draft
created: 2026-08-25
updated: 2026-08-25
---

# Addendum — BrowserCity

Depth that earned a place but does not belong in a 1–2 page brief. Most of this is input for `gds-gdd` or `gds-game-architecture`. The full idea catalogue lives in `_bmad-output/brainstorming-session-2026-08-24.md` (106 numbered ideas); references below use those numbers.

## Why the core fantasy is #1 and not #2 or #3

Three fantasies were live going into briefing, and they fail differently:

| | Promise | Makes load-bearing | Failure mode |
|---|---|---|---|
| #1 The Citizen, Not The Chosen One | You are not special | Rent, Tier 0, commute tax, position | Pressure alone may not be fun |
| #2 The Breathing Machine | Watch the machine work | Truth Test, chains, causality | Fidelity nobody notices is money burned |
| #3 Possibility Vertigo | Everything is enterable | Affordance ladder, interiors, job breadth | Solo-scope death; breadth cannot be faked |

#1 was chosen because it is the only one whose endgame (#49, becoming a dependency) *fulfils* the opening rather than inverting it, and because it is the cheapest of the three to deliver honestly.

**Consequence for a prior decision.** The brainstorm settled "simulation fidelity is the highest-priority pillar." Under #1, fidelity is demoted from an end to a means — it exists to manufacture felt pressure and social position. This legitimises faking anything a player can never feel the weight of, and is the single largest cost saving available to the project.

**A caution on #2 that should survive into the GDD.** "You can watch the city think" is partly a fantasy about the developer's achievement. Players do not get satisfaction from a system being genuinely simulated; they get it from *noticing* something. The Truth Test (#61) cannot distinguish the two. Law #38 (physical carrier) is currently the only legibility mechanism the design has, and it will have to carry that entire burden.

## Rejected alternatives and why

- **#105 The Low Ceiling** — a deliberately terminating wealth ladder. Rejected: the ladder does not terminate; money is simply one axis among several, so it never becomes the only game.
- **#14 Sleep Is Handover** — sleeping equals logging off. Rejected: at a 1–2 hour day cycle this evicts the player daily. Superseded by #23, the night shift.
- **#20 Staggered Sleep Windows** — per-character sleep need. True and retained as world texture, but it does not solve the *player's* own sleep gap.
- **#101 Institutional Decay From Churn** — abandoned player roles slow their chains. Rejected and replaced by #104: AI backfills every unfilled role, so services degrade only when someone *chooses* it. The city must never rot because the server was quiet. Decay always has an author.
- **Single-player vertical slice as MVP** — recommended during briefing, declined. See below.
- **Spin the server down when empty** — offered as a way to cut burn. Declined: it breaks #60/#61 and makes causality a fiction.
- **Comps offered and declined:** Stardew Valley / Animal Crossing, Papers Please / Shenmue. Animal Crossing survives as an *audience* reference only, not a design one.

## The MVP debate, recorded

The coach argued for a single-player vertical slice — one street, one job, a rent clock, one pursuit, no server — on the grounds that the core hypothesis is a single-player question and the MMO is the project's largest cost.

Adrian chose a small multiplayer district. **The coach subsequently retracted the cost half of that argument**, and the retraction matters for planning: because #62 (authoritative sim, thin client) is already committed, the server simulates the city with zero clients connected regardless. A second connected player is close to incrementally free, and building single-player first would mean retrofitting netcode later — the more expensive path, not the cheaper one.

What survives of the concern, and is carried into the brief's risk section: the always-on burn during a multi-year pre-revenue build, and content breadth (100+ interiors, 5+ job procedures) as the real cost driver.

## Pillar selection

Five candidates were considered. A, B, D, E ship. C became a design law.

- **C (consequence needs a physical carrier)** is an engineering rule that *produces* pillars rather than being one. Demoted to a law, where it decides arguments without competing for pillar slots.
- **D (you are always covered)** was recommended for demotion to architecture and deliberately kept, on the grounds that reciprocal occupancy answers absence, sleep, night population, the AI/player blend, and institutional fault tolerance simultaneously. It is the most load-bearing single mechanic in the design and the brief should not bury it.
- **E (procedure over prompt)** is weakened by the decision to treat competence as texture rather than pursuit, but retained: without it the Burger Test has no foundation and the game becomes ordinary.

## The #106 / #109 contradiction and its resolution

The brainstorm simultaneously held **#106 Hide The Number** (no net worth, no HUD balance) and **#109 Steer The Optimiser** (let the right quantities visibly accrue — districts seen, people who know you, procedures mastered). These are incompatible as written.

Resolved as **diegetic carriers only**: no UI counters for anything, but the world holds physical evidence of progress. Adrian initially conceded that places-seen would simply break law #38 — but most of the lateral pursuits carry themselves naturally (plushies on a shelf, a trophy, a scorecard, a kitchen with the right pan, food that comes out well). Only places-seen genuinely lacks a carrier, so the exception is narrow and stated, and law #38 stands.

## Player goals — the fuller picture

Adrian's reframe during briefing: discovery is not territory. It is the whole field of optional, non-heroic pursuits — hobbies, golf tournaments, a plushy collection, getting good at cooking, places. This dissolves two problems at once. Territory as a goal is self-terminating and would have collided with a one-district launch; lateral pursuit renews without needing more map.

**Demoted from goals to conditions:** the social cluster — #52 flatshare (your first friendship is a financial instrument), #53 group leisure (the guild is a routine, not a raid), #75 failure is social glue, #98 the geographic social graph (friendships form along commutes). These remain designed content; they are simply not ladders players climb.

## The shift template (#89) — for the GDD

Reusable across every job in the city:

1. **Ritual open** — arrive, change in, equip, handover chat with the person you relieve (#92).
2. **Rhythmic duties** — the rounds. Predictable, procedural, low-supervision.
3. **Discretionary middle** — nobody is watching. This is where the game actually lives (#88): freedom scales inversely with supervision, so the emptiest shift offers the most agency. Toys inside jobs (#90) — solitaire on the guard post computer — make downtime inhabitable rather than designed away.
4. **Ritual close** — final round, handover, change out, return equipment, goodbye.

Supporting: **#93 self-imposed standards** — cleaning the lobby is never required, tracked, or rewarded; it is just cleaner afterwards. **#36 props with state** — the stamp runs dry, the till runs short of change. **#77 the Burger Test** — any legitimate job must be intrinsically satisfying enough to compete with the most exciting alternative available.

## The bureaucratic chain — for the GDD

A city event (accident, congestion, complaint, footfall change) triggers a multi-agent institutional process: investigation → approval → budget → procurement → logistics → labour. Each link is an occupation with its own work loop, held by an AI citizen or a player (#10, #11).

Design consequences: **#12 friction as narrative** — chains stall, get denied, get expedited, and consequences land on citizens who never saw the paperwork. **#83 response time is a budget line** — how fast the ambulance arrives depends on decisions made in a building you have never entered. **#5 municipal memory** — the city observes and alters itself, readable like weather. **#49 becoming a dependency** — late progression means occupying links others need; public office and private ownership are one mechanic under two labels.

## Failure, crime and safety nets

**Settled: no death (#82).** Injury costs days and savings; hospitals are institutions with paramedic, triage, nurse, surgeon, admin and billing chains.

**#71 Ruin By Process** — failure is a bureaucratic chain run against the player: notice, escalation, judgment, enforcement, each link a moment to intervene. No fail-state cliff; you lose slowly, visibly, with recourse.

**The safety nets, which together make the game cozy in consequence:** #72 the playable floor (destitution is inhabitable, with its own routines and community), #73 the net is content (welfare and shelters are simulated institutions with player-holdable roles — the mechanism rescuing failing players is a career path for thriving ones), #74 the night shift is the floor (borrowed-body work is always available and always pays), #75 failure is social glue.

**Crime, v1:** players stay lawful (#86). Crime exists in the world and players engage the response side — police, detectives, insurance, repair, courts (#81). Revisited with real player data (#87). If opened later: #78 opportunity not occupation (crime grows where simulation produces an opening), #79 time is the punishment, #80 the record (convictions persist as a physical file).

## Architecture — for `gds-game-architecture`

- **#56 Separate the ledger from the body** — chains simulate to the floor as *records*; bodies instantiate only where observed. Truth is cheap; bodies are expensive.
- **#57 Fidelity follows attention** — full procedure near players, statistical elsewhere, reconciled on approach. The player is both camera and simulation budget.
- **#60 The city always ticks** — simulation continuous and authoritative everywhere; rendering instantiates on demand from computed truth.
- **#61 The Truth Test** — would this event have happened identically if no player ever came? Nothing is authored into being by proximity.
- **#62 Authoritative sim, thin client** — the world lives server-side; the browser renders and takes input. Serves the 1s boot, the MMO, and anti-cheat at once.
- **#66/#67 One simulation, variable resolution** — a single system at different timesteps and detail levels, never a separate background approximation. Structurally prevents drift between "real" and "faked" regions.
- **#68 Kinematic continuity** — you return exactly where cause and elapsed time put you. Reconnection has no seam because nothing was suspended.
- **#63 Agent-maintainable by construction** — uniform, data-driven, heavily testable systems; behaviour as data agents can generate and validate.
- **#21 Compressed detached clock** — one in-city day is 1–2 real hours, unmoored from real-world time, so everyone rotates through all hours.
- **#69/#70 Density is local; the periphery is quiet** — aliveness measured per screen, not per database. Sparse edges read as character, not as budget.

## Emergence to watch for

Liked and expected: **#95 rush hour from schedules** (congestion, delay, incident and institutional response emerging from shift times alone), **#96 player gentrification** (physical state → desirability → rent → demographics → physical state; undampened, flagged as a risk), **#97 reputation without a system** (individual agents remember individual people; unfarmable because there is nothing to farm), **#100 labour market saturation** (popular jobs depress wages, unpopular roles pay better — self-balancing with no designer intervention), **#39 broken windows** (a full bin produces one dropped bottle, which licenses the next, reversibly).

Bounded: **#99 understudy drift** — extended absence produces a character shaped by the AI's choices. Must never produce catastrophe (#103, the conservative understudy: it goes to work, pays rent, eats, sleeps; it never bets the paycheck or quits the job).

Wait-and-see: **#102 emergent norms** — queueing, tipping, a usual table, a standing Sunday ride. Culture as content nobody writes. Only observable with real players.

## Job access tiers (#94)

Some roles stay NPC-only; others open to players. Accessibility is a tuning dial, not a fixed property — ship a city with a hundred professions and build five or ten playable ones, adding more over time. This is the project's primary scope valve and should be used deliberately.
