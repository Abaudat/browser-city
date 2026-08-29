---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - _bmad-output/planning-artifacts/gdds/gdd-BrowserCity-2026-08-25/gdd.md
  - _bmad-output/planning-artifacts/architecture/architecture-BrowserCity-2026-08-25/architecture.md
  - _bmad-output/planning-artifacts/epics.md
supportingDocuments:
  - _bmad-output/planning-artifacts/briefs/brief-BrowserCity-2026-08-24/brief.md
  - _bmad-output/planning-artifacts/briefs/brief-BrowserCity-2026-08-24/addendum.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-29
**Project:** BrowserCity

## Step 1 — Document Inventory

### GDD Documents

**Whole documents:**
- `gdds/gdd-BrowserCity-2026-08-25/gdd.md` — 69 KB, 854 lines, modified 2026-08-25 19:35

**Sharded documents:** none

Companion files in the same folder:
- `gdds/gdd-BrowserCity-2026-08-25/decision-log.md`

### Architecture Documents

**Whole documents:**
- `architecture/architecture-BrowserCity-2026-08-25/architecture.md` — 135 KB, 1922 lines, modified 2026-08-28 23:25

**Sharded documents:** none

### Epics & Stories Documents

**Whole documents:**
- `planning-artifacts/epics.md` — 312 KB, 6442 lines, modified 2026-08-29 16:03
  - 15 epics (Epic 0 through Epic 14), 200 stories
  - Frontmatter declares `stepsCompleted: [1,2,3,4]` with GDD + Architecture as input documents
  - **Sole authoritative epic breakdown.** The superseded design-level charter that previously sat at `gdds/gdd-BrowserCity-2026-08-25/epics.md` has been deleted.

**Sharded documents:** none

**No per-story story files exist.** There is no `stories/` folder anywhere under `_bmad-output`. All story detail lives inline in `planning-artifacts/epics.md`.

### UX Design Documents

**None found.** No `*ux*.md` anywhere in the project. `planning-artifacts/epics.md` states this explicitly: "No UX Design Specification exists for this project."

### Supporting Documents (not assessment inputs)

- `briefs/brief-BrowserCity-2026-08-24/brief.md` — 14 KB, 135 lines
- `briefs/brief-BrowserCity-2026-08-24/addendum.md` — 12 KB, 116 lines
- `briefs/brief-BrowserCity-2026-08-24/.decision-log.md`
- `brainstorming-session-2026-08-24.md`

### Issues Found

**✅ RESOLVED — duplicate epics files**

Two epics files previously coexisted:
- `gdds/gdd-BrowserCity-2026-08-25/epics.md` — the **design-level charter** written alongside the GDD (2026-08-25), before the architecture was complete.
- `planning-artifacts/epics.md` — the **implementation-level breakdown** (2026-08-29), which explicitly folded in the architecture's findings where they superseded the charter.

The charter has been **deleted**. `planning-artifacts/epics.md` is now the single authoritative epic breakdown, and the three inbound references were repointed to it:
- `architecture.md` frontmatter `epics:` → `_bmad-output/planning-artifacts/epics.md`
- `gdd.md` "Development Epics" pointer → `../../epics.md`
- the source note in `epics.md` itself, rewritten to record the supersession

The GDD retains its own E1–E14 summary table, which stands as the design-level view.

**⚠️ WARNING — no UX Design Specification**

No UX document exists. UX/HUD/diegetic-interface coverage will have to be traced into the GDD and epics directly, and any gap there is a real gap rather than a missing-document artefact. This will limit the UX-alignment portion of the assessment.

**ℹ️ NOTE — no per-story story files**

Story detail is inline in `epics.md` rather than in individual context-filled story files. That is normal at this stage (story files are generated per-sprint), but it means this assessment validates story *definitions*, not story *contexts*.

**No untracked-version conflicts.** `planning-artifacts/epics.md` is currently untracked in git (new since the last commit); everything else is committed.

---

## Step 2 — GDD Analysis

**Source:** `gdds/gdd-BrowserCity-2026-08-25/gdd.md`, read in full (854 lines, all sections).

### Extraction method — read this before using the lists below

**The GDD contains no numbered requirements.** It is a design document written in prose, tables and design laws. Every requirement below was derived by me from GDD source text and numbered `G-FRn` / `G-NFRn` for this assessment.

This numbering is deliberately **distinct from the `FR1–FR172` / `NFR1–NFR46` inventory inside `planning-artifacts/epics.md`.** That inventory is the epics author's own derivation, and a large part of it (the L1/L2/L3 layering, matters and fluxes, driver swapping, subscription prefetch) is **architecture-derived vocabulary that does not appear in the GDD at all**. Validating the epics against their own inventory would be circular and would catch nothing. Step 3 traces GDD-derived requirements against epic coverage, and separately checks whether the epics' inventory has drifted from, or quietly dropped, anything the GDD asserts.

### Functional Requirements

**Time and the core loop**

G-FR1: One in-city day = 60 real minutes; one in-city hour = 2.5 real minutes.
G-FR2: The clock is detached from real-world time and runs continuously whether or not anyone is connected, so every player rotates through all in-city hours across their real week.
G-FR3: A starting player's day budget is sleep 8h (20 real min), work 8h (20 min, including ritual open and close of ~30 in-city min each), commute 2h (5 min; 60 in-city min each way on foot from the starting edge flat), own-time 6h (15 min) — total 24h = 60 real min.
G-FR4: The cycle runs wake → commute → shift → paid → spend → rent → sleep, and repeats.
G-FR5: The commute is the player's primary sensor on the city's state; emergence enters the loop at that step.
G-FR6: The commute has a floor — roughly 20 in-city minutes at best, never zero, still real time in the street each leg.
G-FR7: At sleep the player either logs off (the AI understudy holds the life) or stays up (a borrowed night shift in an NPC body).
G-FR8: The transport ladder runs edge flat on foot (60 min each way, 6h own-time) → bike (30 min, 7h, +17%) → transit pass or closer flat (20 min, 7h20m, +22% from start).
G-FR9: A faster commute changes *what* the player reads, not whether — the tram route passes different streets than the walk did; a closer flat puts the player in a different neighbourhood to notice.
G-FR10: The sensor migrates — early game the player reads the city by walking through it, late game through the paperwork that crosses their desk.
G-FR11: Housing's late-game value is proximity to a life (pursuits, people, usual places), not proximity to work.

**Shift work and procedure**

G-FR12: Every playable job runs the same four-beat template: ritual open (~30 in-city min), rhythmic duties (~3h), discretionary middle (~4h), ritual close (~30 min) — 8h total, 20 real min.
G-FR13: Props carry state, and that state is visible on the object itself, never in a UI readout — the stamp runs dry, the till runs short of change, the bin lorry fills, the coffee grinder hopper needs topping up.
G-FR14: Procedure steps are performed on world objects in sequence, not selected from a menu.
G-FR15: An action is worth simulating when it can be performed badly; otherwise it is abstracted.
G-FR16: Self-imposed standards (cleaning the lobby) are never required, tracked or rewarded — it is just cleaner afterwards. No job has a score.
G-FR17: Freedom scales inversely with supervision; the emptiest post is designed as the most interesting one, not the most neglected. The night guard's building is where P4 is proven or disproven.
G-FR18: Five playable jobs ship at launch, each with a named procedure and named failure modes: sanitation/bin round (route order, lift, empty, log, depot return), night bus driver (route, stops, timing, doors, fares), security guard in an empty building (rounds, door checks, log entries), convenience shop till (serve, scan, bag, take payment, make change, restock, cash up), café barista (grind, dose, tamp, pull, steam, serve).
G-FR19: Procedures are built so some may physically require two people; the principle ships (E6 builds for it), specific two-handed tasks beyond a token case do not.

**Rent, money and the time economy**

G-FR20: Rent falls due every 7 in-city days (≈7 real hours), earned or not.
G-FR21: Entry wage is 10 per in-city hour (80/day, 560/week gross); edge-flat rent is 250/week (45% of gross); food and necessities ~90/week; weekly surplus ~220.
G-FR22: Rent can be split through a shared tenancy — 250/week becomes 125 — in exchange for sharing the space.
G-FR23: Missing rent does not trigger eviction; it triggers Ruin By Process.
G-FR24: Bike costs 450 one-time (+1h/day, payback 6.4 weeks); transit pass 20/week (+20 min/day); closer flat +130/week rent (+20 min/day, deliberately a poor deal on minutes).
G-FR25: One-time purchases buy minutes efficiently; recurring costs do not.
G-FR26: Income is wages from shift work plus borrowed night shifts; the understudy earns the same wage the player would, never more.
G-FR27: Labour market saturation self-balances — popular jobs depress wages, unpopular roles pay better, with no designer intervention.
G-FR28: Housing market desirability tracks physical state and demand; rent follows.
G-FR29: Money is stored time and nothing else; no system may introduce a resource that competes with time as the scarce thing.
G-FR30: Qualification costs minutes, never money alone — a rich player cannot buy a career.

**Win/loss and the floor**

G-FR31: There is no win condition, no loss condition, no death, nothing scored, and no state from which a player cannot return.
G-FR32: Ruin By Process runs notice → escalation → judgment → enforcement; each link is a job somebody holds and a moment at which the player can intervene, negotiate, pay or appeal. Consequences are slow, visible and interruptible.
G-FR33: The floor is inhabitable — destitution is a place with its own routines and community. Welfare offices and shelters are simulated institutions with player-holdable roles.
G-FR34: The borrowed night shift is always available and always pays, so there is always a way up.
G-FR35: Injury, not death — injury costs days and savings, and routes the player through hospital institutions with paramedic, triage, nurse, surgeon, admin and billing chains.

**Institutional chains**

G-FR36: A city event (accident, congestion, complaint, change in footfall) triggers a multi-agent institutional process running investigation → approval → budget → procurement → logistics → labour.
G-FR37: Each link is an occupation with its own work loop, held by an AI citizen or a player, with no mechanical seam between the two.
G-FR38: Chains stall, get denied and get expedited; consequences land on citizens who never saw the paperwork. Institutional latency *is* the story.
G-FR39: Response time is a budget line — how fast the ambulance arrives depends on a decision made in a building the player has never entered.
G-FR40: Municipal memory — the city observes and alters itself, readable like weather.
G-FR41: The reference chain is the plastic-bottle loop: sanitation budget shortfall → a bin goes unemptied → a dropped bottle → the street degrades → complaints are filed → a budget chain opens → staffed by people players can be.
G-FR42: The second chain is development: population pressure → survey → approval → budget → procurement → construction → a new neighbourhood.
G-FR43: At v1 chains run AI-staffed end to end; players experience them from the receiving end and read their outputs on the commute.

**Reciprocal occupancy**

G-FR44: On disconnect an AI understudy holds the player's life with a conservative mandate — it goes to work, pays rent, eats and sleeps; it never bets the paycheck, never quits the job, never risks the character's position.
G-FR45: The understudy banks the surplus untouched, so the player returns with more in the bank than they left. Money is the only axis that advances during absence.
G-FR46: The absent character reconciles as a record rather than a tick-by-tick simulation and settles on return; the missed time is delivered physically as the pile of post on the doormat — rent receipts, payslips, a council letter, a notice about the bins.
G-FR47: Understudy drift is real and bounded — extended absence produces a character shaped by the AI's choices, but never a catastrophe.
G-FR48: The understudy's mandate is fixed and not configurable — a configurable understudy would become an optimisation surface and turn absence into a strategy.
G-FR49: Staying up past bedtime lets the player take over an NPC's working night — a bounded, paid shift in someone else's body, sized to how tired the character is.
G-FR50: The night shift is framed non-diegetically and deliberately so — the player is offered a few available night posts and picks one. No shift board, no agency office.
G-FR51: Borrowed shifts are anonymous and do not accumulate; a player who drives the same night bus fifty times does not become known as the night bus driver, to anyone. Consequence lands on the NPC, not the player.
G-FR52: Night posts are differentiated only by pay, duration and the tiredness cap — the night shift is a utility system, not a second life.
G-FR53: Any unheld institutional role is AI-backfilled; the post is always covered.
G-FR54: No system may punish logging off. Absence costs nothing. Services degrade only when someone *chooses* it, never because the server was quiet — decay always has an author.
G-FR55: Kinematic continuity — the player returns exactly where cause and elapsed time put them; reconnection has no seam because nothing was suspended.
G-FR56: Separate the ledger from the body — chains simulate to the floor as records; bodies instantiate only where observed. This applies to absent players too.
G-FR57: Player/AI indistinguishability — there is no mechanical seam between a role held by a player and the same role held by an AI citizen.

**The verb vocabulary**

G-FR58: Presence verbs are supported — sit, order, wait, watch the water — actions whose entire payload is being somewhere. Idleness is designed content, not the gap between content; a bench that can be sat on is a feature.
G-FR59: Civic verbs are supported — bin the bottle, hold the door, give up the seat — the commons as an interactive surface at the scale of a single object.
G-FR60: Binning the bottle is the player-side reversal of broken windows; the litter loop is reversible through any citizen who picks the bottle up, not only through the sanitation chain.
G-FR61: Conversation is loitering — done instead of transacting, chosen sentence by sentence, and it costs minutes. There is no dialogue tree and no branching script.
G-FR62: Dignity work — the ramp, the ticket, the correct change; jobs made of small competent courtesies to specific people rather than resource throughput.
G-FR63: The good move and the efficient move differ, deliberately, and nothing rewards the good one.
G-FR64: Gamey affordances exist only where the experience genuinely breaks without them; abstraction is a cost paid reluctantly, never a default vocabulary.

**Simulation and persistence**

G-FR65: What is simulated is a contemporary city district — its people, their work, their money, their movement, and the institutions that connect them; the people themselves, each with a home, a job, a schedule and ends of their own. Not city-builder abstractions.
G-FR66: Simulation depth is variable by attention but uniform in kind — one simulation at different timesteps and levels of detail, never a separate background approximation alongside a real foreground. Full procedure runs where players are, statistical resolution elsewhere, and the two reconcile on approach.
G-FR67: The city always ticks — simulation is continuous and authoritative everywhere, whether or not anyone is connected.
G-FR68: Rendering instantiates bodies on demand from computed truth.
G-FR69: The Truth Test — would this event have happened identically if no player had ever come? Nothing is authored into being by proximity; every state survives inspection back to a cause.
G-FR70: Resolution scales; causality does not. Distant simulation is cheaper, never falser. Cheap is not fake.
G-FR71: The citizen count is deferred to architecture, but must satisfy five design constraints: local density (a busy street at rush hour reads busy, a residential street at 3am reads quiet), sparse periphery (emptiness looks intentional), labour-market depth (~100 distinct professions, most AI-held), recognisability (agents encounterable often enough to become familiar), and AI carries density (player count is never the source of the city feeling populated).
G-FR72: Every bounded quantity tends toward an equilibrium state that the non-player simulation actively tries to reach. A system that lets a quantity drift with nothing pursuing its equilibrium is incomplete and does not ship.
G-FR73: Local gentrification is deliberately undamped and wanted; the ratchet is answered by adding supply — the city grows as the active player population grows, so there is always somewhere affordable to begin.
G-FR74: Growth is delivered by the development chain and is physically visible — construction sites, hoardings, converted buildings. The player watches the city grow rather than finding a new area already there.
G-FR75: In v1, growth means new neighbourhoods adjacent to district one, not new districts.
G-FR76: The geographic social graph emerges from citizens having schedules, routes existing, and agents remembering individual people — it is not designed, built or tracked.

**Progression**

G-FR77: There is no experience bar, no level, no skill tree and no net-worth display; both progression axes are carried diegetically.
G-FR78: Institutional position is gated twice — by qualification (a licence, certificate or course, costing minutes as evening classes out of own-time) and by vacancy (an actual open post, timing, and an application).
G-FR79: Progression carriers are diegetic objects — the certificate on the wall, the licence in the wallet, your name on a roster, a set of keys.
G-FR80: City growth opens new posts as the player population rises, so vacancy pressure eases exactly when player pressure increases.
G-FR81: v1 ships three lateral pursuits, deep rather than many: cooking (diegetic carrier: the right pan, food that comes out well; indirectly buys minutes back), collecting/plushies (the shelf *is* the progress bar; gives money a use that is not minutes), and a sport or club/golf (a trophy, a scorecard, a standing fixture; membership fees and a real time cost at a fixed hour).
G-FR82: Places is deliberately not a v1 pursuit, and dropping it retires the stated exception to the physical-carrier law.
G-FR83: Dependency is carried by decisions, not by presence — what persists is the choices made while present (the budget approved, the route scheduled, the application expedited or left in the tray).
G-FR84: The difficulty curve is inverted — hardest at hour one, becoming wider rather than harder.
G-FR85: Pressure does not evaporate, it becomes self-imposed. No system may add late-game pressure to keep the game interesting.

**Level design and generation**

G-FR86: Everything is procedurally generated from a city seed — street layout, plot subdivision, building exteriors and interiors. Nothing is hand-placed.
G-FR87: The generator's rules are the entire content pipeline; there is no fallback of hand-authoring a good street if the rules produce a bad one.
G-FR88: Determinism — the same seed produces the same city. The city is generated once and then lived in, not re-rolled.
G-FR89: One continuous district composed of streets (from street layout + plot rules), interiors (100+ enterable, from room grammar + building type), workplaces (building type + job definition), institutions (placement constraints — depot, council, hospital, welfare office, shelters, shops, cafés) and periphery (density falloff).
G-FR90: Neighbourhood character comes from generator parameters — density, building age, affluence, land-use mix — the same quantities that make the gentrification loop legible.
G-FR91: There is no level progression; the player inhabits one district and it grows around them.
G-FR92: Density is local — aliveness is measured per screen, not per database.

**Art, audio and controls**

G-FR93: Art is fixed by assets in hand — LimeZu Modern Exteriors and Modern Interiors, 16×16 pixel art, oblique perspective with a front-facing bias, pre-split.
G-FR94: Character spritesheets are unsplit; splitting is known work scheduled in E1.
G-FR95: The world is a contemporary city, unnamed and unremarkable — no fantasy, no near-future, no apocalypse. Texture comes from institutions and weather, not lore.
G-FR96: No HUD — no net-worth display, no balance, no counters, no objective markers. Diegetic carriers instead: plushies on a shelf, a trophy, a certificate on the wall, a keyring, a roster, a barista who greets you, a pile of post.
G-FR97: Ambient audio carries the city — traffic, rain, a distant tram, room tone that changes when you step indoors.
G-FR98: Music is rare and diegetic (a radio, a busker); there is no composed score.
G-FR99: Audio is a legibility channel — the tram you hear but do not see is evidence the city is running.
G-FR100: Browser, mouse and keyboard, no install, no plugin, no character creation ceremony.
G-FR101: Movement is WASD / arrow keys, continuous, on an oblique tile grid.
G-FR102: Interaction is clicking a world object to act on it.
G-FR103: No controller or touch support in v1.

**Total FRs extracted: 103**

### Non-Functional Requirements

G-NFR1: **Boot to standing-in-the-city in under 1 second** — cold load in a browser tab on a mid-range laptop over a typical domestic connection, measured from navigation to player-controllable, including load. Named in the GDD as the hardest technical constraint in the project.
G-NFR2: **Sustained 60 FPS** on a mid-range laptop at 1080p, measured over a 10-minute session including a busy street at rush hour and an interior transition.
G-NFR3: **Server tick continuous** — the city simulates whether or not any client is connected. Spinning down when empty is rejected because it breaks causality.
G-NFR4: **Reconnection seam: zero** — position and state consistent with elapsed time, every time. Nothing is suspended, so nothing needs resuming.
G-NFR5: **Server uptime continuous** — the city never stops ticking.
G-NFR6: **Monthly server spend within the self-funded bounded budget** (figure set at architecture).
G-NFR7: **Browser, exclusively and non-negotiably** — no install, no plugin, no download gate.
G-NFR8: **Authoritative simulation server-side, thin client** — this serves the boot target, the multiplayer and anti-cheat simultaneously.
G-NFR9: **Systems must be uniform, data-driven and heavily testable** so that agents can extend and validate them. The GDD states explicitly this is a design-level requirement, not an implementation preference — it is the constraint that makes a city buildable by one person.
G-NFR10: **Always-on server** with a bounded self-funded spend, expected to run for years before anyone plays.
G-NFR11: **Generation determinism** — the same seed produces the same city, which is a testability requirement as much as a design one.
G-NFR12: **Mouse and keyboard only** — no controller or touch support in v1.

**Total NFRs extracted: 12**

### Additional Requirements and Constraints

**The five Design Laws** (rules that decide arguments; any future feature must satisfy them):

1. **Consequence needs a physical carrier.** An effect propagates only if something in the world carries it. Eliminates morality meters, reputation auras and invisible simulation. The narrow exception for "places" is retired now that places is not shipping — the law stands unqualified.
2. **Progression is carried diegetically.** No net-worth display, no HUD balance, no counters.
3. **Resolution scales; causality does not.** Distant simulation is cheaper, never falser. Cheap is not fake.
4. **Systemic content only.** No hand-authored quests, dialogue trees or set pieces.
5. **Every bounded quantity tends toward an equilibrium the non-player simulation actively tries to reach.** Matters more here than in comparables because BrowserCity has removed every reset mechanism they rely on.

**The four Pillars, each with a Steers clause** — P1 time is the only real currency; P2 the city is indifferent because it is fully staffed; P3 you are always covered; P4 procedure makes work inhabitable and the machine readable. The GDD records a deliberate, unresolved tension between P2 and the player-experience goal of being needed, resolved positionally rather than attitudinally.

**Five balance rules that must hold:** time is the only scarce resource; one-time purchases buy minutes efficiently and recurring costs do not; the understudy earns the same wage as the player; qualification costs minutes and never money alone; wages self-balance without designer intervention.

**Five gameplay success metrics, each tied to a pillar:** voluntary time in the discretionary middle (P4 — the Burger Test); perceived aliveness at 1 connected player (P2); return rate after absence (P3); minute-spend split between qualification and lateral pursuit (P1); unprompted noticing of city state (P4/P2). The GDD flags the last as the one that matters most and is hardest to instrument.

**Two falsification points:** E5 and E6 together answer whether mundane work is intrinsically satisfying without a round timer or antagonists. E8 answers whether AI citizens carry aliveness at low concurrency.

**Ten open items (A1–A10)** carried by the GDD, of which four are Critical or High and bear directly on readiness:

| # | Item | Impact | GDD disposition |
|---|---|---|---|
| A1 | Multi-step procedure interaction model | High — P4 lives or dies on it | Resolved by prototyping in E6 |
| A2 | District one citizen count and monthly server cost | High — "the number that constrains everything else" | Deferred to architecture |
| A3 | No v1 job is a decision link in an institutional chain | Medium — P2's most distinctive half ships unplayable | Accepted for v1; first candidate in E12 |
| A4 | One-second boot achievable against MMO asset streaming | High — hardest constraint, not yet designed against | Deferred to architecture |
| A5 | The generator's rules are the entire content pipeline | High — single largest content risk | Mitigated by E2 + validation harness |
| A6 | Absence is technically the money-optimal play | Low | Accepted |
| A7 | Dependency by decisions not presence — nobody waits on you | Medium | Accepted deliberately |
| A8 | The Burger Test holds without round timer/antagonists | **Critical** — everything after E5 assumes yes | Answered by E5 |
| A9 | AI citizens carry aliveness at low concurrency | **Critical** | Answered by E8 |
| A10 | The borrowing licence as anti-griefing | Medium | Observable only with real players |

**Out of scope — cut from v1:** player criminality; districts beyond the first; player-owned businesses and infrastructure; player-holdable institutional chain links; places as a lateral pursuit; two-handed co-op tasks beyond a token case; controller and touch support; composed musical score; character creation ceremony.

**Never in scope (design positions, not deferrals):** hand-authored quests/dialogue trees/set pieces; morality meters, reputation auras, approval scores, destiny; a HUD with net worth, balances, counters or objective markers; death; server wipes or round resets; a configurable understudy; late-game pressure added to keep the game interesting.

**Dependencies:** art assets in hand (LimeZu, pre-split; character sheets unsplit); always-on server budget as a standing commitment; agentic development capacity, which the GDD states is not an optimisation but what makes the scope possible for one person.

**Scope valve:** job access tiers make the job count a dial rather than a commitment — named as the project's primary scope valve, to be used deliberately.

### GDD Completeness Assessment

**Overall: the GDD is unusually complete and internally disciplined.** It is decision-dense rather than description-dense, it names its own weaknesses, and it consistently ties mechanics back to pillars and pillars back to design laws. Several qualities materially help traceability:

- **Every mechanic names the pillar it serves** and the numbers it runs on. There is no unattached scope.
- **Cut tests on every pillar** make the design falsifiable rather than merely asserted.
- **The economy is fully specified numerically** — wage, rent, food, surplus, bike cost, payback period, transit pass, closer-flat delta. Rare at GDD stage and directly implementable.
- **Open items are recorded honestly with impact and disposition**, including two rated Critical that the GDD explicitly says everything downstream depends on.
- **Out-of-scope is split into deferrals and design positions**, which prevents a later epic from quietly reintroducing a rejected mechanic.

**Gaps and risks carried into Step 3:**

1. **No numbered requirements in the GDD.** Traceability has to be reconstructed rather than checked. This is the single biggest structural obstacle to a clean coverage audit, and it is why the epics' own inventory cannot serve as the baseline.
2. **No UX Design Specification exists**, and the GDD pushes the project's single most important unresolved control question — the multi-step procedure interaction model (A1) — to "resolved by prototyping in E6". That is a legitimate disposition for a feel question, but it means **P4, the pillar the design says lives or dies on it, has no specification to trace against** until E6 produces one.
3. **Two Critical assumptions (A8, A9) are unfalsified** and are answered by epics rather than before them. The GDD is explicit that everything after E5/E6 assumes A8 holds. Step 3 must confirm the epic sequence genuinely *gates* on these rather than merely scheduling them.
4. **A3 is an accepted gap that removes half of a pillar from v1.** P2's endgame — occupying links others route through — ships unplayable. The GDD accepts this; Step 3 should check the epics carry the mitigation (job access tiers as a dial, first chain role in E12) rather than losing it.
5. **Two numbers the GDD depends on were deferred to architecture** (A2 citizen count, A4 boot feasibility). Step 4 must verify the architecture actually returned them, since the GDD's density and boot requirements are unquantified without them.
6. **Epic count and ordering mismatch — flagged for Step 3.** The GDD's Development Epics section describes **thirteen epics (E1–E13)** and its sequence diagram confirms E1→E13. `planning-artifacts/epics.md` carries **fifteen (Epic 0–Epic 14)** in a different order — the GDD places Reciprocal Occupancy at E7 and Citizens at E8, while the epics file has Citizens at 5 and Reciprocal Occupancy at 9. The epics file states the architecture's findings restructured the list. That is plausibly correct and deliberate, but it means **the GDD's own epic table is now stale**, and a reader trusting the GDD's sequence would be misled. Step 3 confirms whether the restructure is justified and complete; the stale GDD table warrants an update either way.

---

## Gap Resolution — 2026-08-29

The six items carried out of Step 2 were checked against `planning-artifacts/epics.md` and the architecture before being treated as gaps. **Four were already handled by the epics document and were not gaps at all** — they were unverified claims on my side. One was a genuine, pervasive document defect and has been fixed. One is a real open decision that belongs to the developer and has been surfaced rather than closed.

### Resolved by fixing the GDD

**Gap 6 — the GDD's epic references were systematically stale. FIXED.**

This was the only true document defect, and it was larger than first reported. The GDD did not merely carry a stale summary table: **sixteen separate cross-references throughout the document pointed at the old E1–E13 numbering**, including four of the ten open items. Under the restructure these did not merely go out of date, they pointed at the *wrong epics* — A8 said "answered by E5" when the Burger Test is now Epic 7, and A9 said "answered by E8" when Citizens is now Epic 5. A reader following either would have gone to the wrong place.

Applied to `gdds/gdd-BrowserCity-2026-08-25/gdd.md`:

- **The Development Epics table replaced** with the current fifteen-epic structure, carrying a `Was` column mapping every epic back to its original E-number, the three recorded reasons for the restructure, and a statement that `epics.md` is authoritative for epic structure, numbering and sequence.
- **Fifteen inline cross-references repointed** — project goals 1 and 2, the two-hands principle (M7), the generator-risk note, the city-extends note, two asset-table rows, the out-of-scope row, the dependencies note, the scope-valve note, and open items A1, A3, A5, A8, A9.
- **The sequence diagram and both falsification-point statements rewritten** to the new numbering.

**Gap 1 — the GDD carries no numbered requirements. ADDRESSED BY POINTER.**

The GDD is prose-and-tables by design and adding 103 invented FR numbers to it would create a second competing inventory. Instead the Development Epics section now states that `epics.md` carries the numbered inventory (FR1–FR172, NFR1–NFR46) and that the GDD deliberately does not duplicate it. The `G-FR`/`G-NFR` extraction in Step 2 above remains the independent baseline for this assessment's traceability audit.

**Gap 5 — A2 and A4 were deferred to architecture. BOTH NOW RECORDED IN THE GDD.**

Verified that the architecture returned them, and the GDD's open-items table has been updated so it no longer reads as unanswered:

- **A2 — answered.** The Scale Baseline (settled 2026-08-29, measured against the tileset) fixes a 512×512 map at ~5,000 citizens, ~894 buildings, ~344 workplaces, ~69 professions, ~42 L2 transactions/sec, ~$25/mo with no overage.
- **A4 — partially answered, honestly marked.** The architecture supplies a boot design, but the epics document states it is *"arithmetic, not evidence."* Benchmark **B3 (boot budget, measured)** is scheduled as a gating spike in Epic 1, before anything depends on it. The GDD now records A4 as still open until B3 reports, rather than as resolved.

**Consequential correction found while recording A2.** The Scale Baseline revises the GDD's labour-market target from ~100 professions to **~69 for v1**, because ~100 was thin at the architecture's original citizen count and the settled scale supports 69 at 5+ employers each. The GDD asserted ~100 in its Core Simulation Systems constraint table with no qualification. Both that table row and the A2 entry now carry the corrected figure and the reason. **This is a design number that had silently drifted between documents** — the epics file instructs that stories enumerating professions be written against 69.

### Not gaps — already handled by the epics document

**Gap 2 — no UX Design Specification. NOT A GAP.**

`epics.md` carries a reasoned *"Not applicable"* section rather than an omission. The argument holds: the GDD's diegetic-progression law plus architecture decision D17 (*all UI is DOM; nothing persistent, global or abstract is drawn into the canvas*) leave the conventional UX surface nearly empty — a boot name prompt, an options menu, connection notices, and transient object-bound container views. Everything else that would be UX work is world-building. The UX-shaped requirements are captured as FR144–FR152, FR102, FR104, FR30–FR34 and NFR22, and the document names what a later UX spec would own. **Downgraded from warning to noted condition.**

**Gap 3 — A8 and A9 gating. VERIFIED PRESENT.**

Both are genuinely gated, not merely scheduled. Epic 7 is labelled *"the project's first falsification point"* with the note that everything after it assumes mundane work is intrinsically satisfying. Epic 5 carries A9 and measures D-L3's falsification gate — whether client-side L3 for ~200 agents stays inside ~2 ms per frame — *before anything depends on it*. Epic 1 additionally pulls three gating spikes (B7 scheduled-reducer timing, B6 backup/restore, B3 boot budget) ahead of the work that rests on them. The epics document also preserves the GDD's signal-quality caveat: the shop till is the softer test and the unsupervised post is deliberately held one epic back rather than dropped.

**Gap 4 — A3's chain-link gap. IMPROVED ON, NOT LOST.**

The mitigation did not merely survive — the architecture strengthened it. A3 is no longer an accepted v1 deferral: Epic 13 *closes* it. The finding is that a decider is not a different kind of agent but a citizen whose work-time option set is matters instead of procedure steps, using the same utility evaluator, and Epic 10 already builds the inbox, the scoring, the four actions and the chain templates. Putting a player in that slot is an addition rather than a rebuild. The GDD's A3 entry now records this closure.

### Open — requires a decision from the developer

**⚠ The Burger Test now runs two epics later than the GDD planned.**

This is the one item that cannot be closed by editing a document, and it is the most consequential finding of the assessment so far.

In the GDD's original sequence the first falsification point was **epic 5 of 13**. Under the restructure it is **epic 7 of 15**, sitting behind Citizens (5) and Stock, Goods and Money (6). A8 — *the Burger Test holds without SS13's round timer and antagonists* — is rated **Critical**, and the GDD states plainly that everything after it assumes yes.

The restructure's reasoning is sound on its own terms: the shop till requires customers, so the first job epic always depended on NPC capability, and stubbing a customer to preserve the old order would repeat the mistake the GDD itself declined when it rejected a pre-foundation spike. The epics document does not hide this — it names the slip as **"the single largest cost of this restructure, flagged for decision."**

**It remains flagged. Nobody has decided it.** The trade is: more work at risk before the project's foundational hypothesis is tested, against a cleaner build order and a test whose answer actually transfers. That is a judgement about risk appetite on a multi-year solo project, and it belongs to the developer, not to this assessment. It is now recorded in the GDD's Development Epics section as an explicit open decision so it cannot be lost.

### Status after resolution

| # | Gap | Status |
|---|---|---|
| 1 | GDD carries no numbered requirements | Addressed — GDD now points at the authoritative inventory |
| 2 | No UX Design Specification | Not a gap — reasoned N/A, downgraded to noted condition |
| 3 | A8/A9 critical assumptions unfalsified | Verified — genuinely gated, not merely scheduled |
| 4 | A3 removes half of P2 from v1 | Improved — Epic 13 now closes it; GDD updated |
| 5 | A2/A4 deferred to architecture | Both recorded in GDD; A4 honestly marked still-open pending B3 |
| 6 | GDD epic references stale | **Fixed** — table replaced, 15 cross-references repointed |
| — | Profession target drifted ~100 → ~69 | **Fixed** — found during resolution, corrected in two places |
| — | Burger Test slips from position 5 to 7 | **OPEN — developer decision required** |

---

## GDD Alignment — 2026-08-29

**Decision recorded:** the epic breakdown in `planning-artifacts/epics.md` is correct and authoritative. The GDD has been aligned to it. Where the two disagreed, the epics document won.

This closes the one item the gap-resolution pass left open, and folds in four substantive divergences that were not numbering problems at all.

### The open decision is now decided

**The Burger Test running at position 7 of 15 is accepted.** The GDD's ⚠ open-decision block is replaced with a recorded decision. The reasoning entered into the record is the GDD's own: the shop till requires customers, so the first job epic always depended on NPC capability, and an answer obtained against a stubbed customer might not transfer — the same argument the GDD used when it rejected a pre-foundation Burger Test spike. A later test whose result is trustworthy beats an earlier one that is not.

### Four substantive alignments beyond numbering

**1. Stock, goods and physical money is now a GDD mechanic (M8).** The architecture found it *absent from the GDD and load-bearing*, and it became Epic 6. The GDD described seven mechanics and asserted "the till runs short of change" as a prop state with nothing underneath it. M8 now records the substrate: things exist in quantities and move only when somebody moves them; physical cash is ordinary stock, so denominations are items and a large note against a three-coin till is an inventory failure the procedure branches on. This is why the till running short is not special-cased. The mechanics count is corrected from seven to eight, with the addition dated and attributed.

**2. Social continuity across long absence is now open item A11.** This is the most consequential find of the alignment pass. **The architecture explicitly escalated it to the GDD and it was never folded in** — it appears in the architecture's "Escalated to the GDD" section and in the epics' findings list, and the epics carry a story for it, but the GDD had no design position on it at all. At 24 in-city days per real day, a fortnight offline is roughly an **in-city year**. Money and rent scale fine and the understudy holds the role, but recognisability and the geographic social graph both assume the player keeps meeting the same people. An in-city year of uniform churn would empty the player's social world while they were away — **a P3 failure ("absence is safe") reached by a route P3 never anticipated.** Recorded with the accepted position: established citizens are sticky rather than churning uniformly, which is more accurate than uniform churn rather than a concession to the player.

**3. The population target is settled, not deferred.** The GDD said the citizen count was "deferred to `gds-game-architecture`". It has been settled: 512×512 map (~435 m square), ~5,000 citizens at one per 52.4 cells, ~894 buildings, ~344 workplaces, ~$25/mo at ~42 L2 transactions/sec. Also recorded: the 100+ enterable-interiors target is ~11% of building stock and therefore never the binding constraint. The five design constraints the figure had to satisfy are retained as the standing test for any future scale change.

**4. The commute arithmetic is now bound to map scale.** The GDD's transport ladder (60 → 30 → 20 in-city minutes) reads as a free design choice. It is not: it holds only at walking speed **2.2 cells/sec** on a 512-cell map, where a ~333-cell starting commute takes exactly 60 in-city minutes and the ladder lands precisely on the design's stated floor. Since `commute_in_city_minutes = 0.26 × map_width / walk_speed`, **any change to map size or walking speed must be made together** or the ladder and its floor stop being true. This is exactly the kind of coupling that gets broken silently by a later tuning pass, and it now sits next to the table it governs.

### Full change inventory

| Area | Change |
|---|---|
| Development Epics | Table replaced with the 15-epic structure, `Was` column mapping each back to its E-number, three recorded reasons for the restructure, `epics.md` named authoritative |
| Development Epics | Sequence diagram and both falsification-point statements rewritten to the new numbering |
| Development Epics | Burger Test position recorded as a decision taken, not an open question |
| Development Epics | Pointer added to the numbered requirements inventory (FR1–FR172, NFR1–NFR46), which the GDD deliberately does not duplicate |
| Cross-references | 15 inline references repointed — goals 1–2, M7 two-hands, generator risk, city-extends, two asset-table rows, out-of-scope, dependencies, scope valve, and open items A1, A3, A5, A8, A9 |
| Game Mechanics | M8 (stock, goods and physical money) added; count corrected seven → eight |
| Core Simulation | Population target changed from deferred to settled, with the Scale Baseline figures |
| Core Simulation | Labour-market depth corrected from ~100 professions to ~69 for v1 |
| Core Gameplay Loop | Commute arithmetic bound to map size and walking speed, with the governing formula |
| Open items | A2 answered (Scale Baseline); A4 marked still-open pending the B3 spike rather than resolved |
| Open items | A3 updated — Epic 13 now closes it rather than it being an accepted v1 deferral |
| Open items | **A11 added** — social continuity across long absence, escalated by the architecture and previously unrecorded |

### Alignment status

The GDD and `epics.md` no longer disagree on epic structure, numbering, sequence, scale figures, the profession target, the mechanics roster, or the disposition of any open item. Three items remain genuinely open in the GDD and are correctly marked as such: **A1** (procedure interaction model, resolved by prototyping in Epic 8), **A4** (one-second boot, pending the B3 measurement in Epic 1), and **A10** (the borrowing licence as anti-griefing, observable only with real players).

---

## Step 3 — Epic Coverage Validation

**Sources:** `planning-artifacts/epics.md` (6,442 lines, read in full), traced against the 103 `G-FR` requirements extracted from the GDD in Step 2.

All structural checks in this step were run programmatically rather than by eye, because a 172-requirement map across 15 epics and 200 stories is not reliably auditable by reading.

### Part 1 — Internal integrity of the epics document

The epics document claims: *"All 172 functional requirements map to exactly one epic. Verified programmatically: no requirement is unmapped and none is claimed by two epics."* **I re-verified that claim independently rather than accepting it. It holds.**

| Check | Result |
|---|---|
| Inventory numbering contiguous FR1–FR172 | **PASS** — no gaps, no duplicates |
| Every inventory FR appears in the coverage map | **PASS** — 172/172 mapped |
| Every mapped FR exists in the inventory | **PASS** — no phantom entries |
| Any FR claimed by two epics | **PASS** — none double-claimed |
| Each epic's declared `FRs covered:` list matches the map | **PASS** — all 15 agree exactly |
| Story number prefix matches containing epic | **PASS** — all 200 stories |

**FR distribution across epics:**

| Epic | FRs | Epic | FRs | Epic | FRs |
|---|---|---|---|---|---|
| 0 — Development Team | 0 *(deliberate)* | 5 — Citizens | 20 | 10 — Institutions / Reference Slice | 20 |
| 1 — Foundations & Spikes | 19 | 6 — Stock, Goods, Money | 14 | 11 — Transit & Full Roster | 5 |
| 2 — Content Pipeline | 6 | 7 — The Day Loop | 9 | 12 — A Life | 6 |
| 3 — The Generated City | 15 | 8 — Procedure and Props | 14 | 13 — Careers | 6 |
| 4 — The Living Wire | 18 | 9 — Reciprocal Occupancy | 14 | 14 — Growth | 6 |

**Stories: 200 across 15 epics**, ranging from 9 (Careers) to 19 (Citizens).

**One apparent discrepancy, investigated and cleared.** Epic 11 declares FR14 (the five-job roster) while the coverage map assigns FR14 to Epic 8. This is not a defect: Epic 11's line reads *"(and completes FR14's job roster: night bus driver and cafe barista)"* — parenthetical and italicised, deliberately not claiming ownership. FR14 is owned by Epic 8 and its delivery genuinely spans two epics. The document is more careful here than a naive checker would credit.

### Part 2 — GDD requirement traceability

Every `G-FR` extracted from the GDD in Step 2, traced to the epics' numbered inventory and thence to an epic.

| G-FR | Requirement | Epics FR | Epic | Status |
|---|---|---|---|---|
| G-FR1 | in-city day = 60 real min | FR1 | Epic 4 | OK |
| G-FR2 | clock detached + continuous | FR2, FR3 | Epic 4 | OK |
| G-FR3 | day budget 8/8/2/6 | FR4 | Epic 7 | OK |
| G-FR4 | wake->commute->shift->paid->spend->rent->sleep | FR5 | Epic 7 | OK |
| G-FR5 | commute is the sensor | FR6 | Epic 7 | OK |
| G-FR6 | commute floor ~20 min | FR7 | Epic 7 | OK |
| G-FR7 | sleep: log off or night shift | FR8 | Epic 9 | OK |
| G-FR8 | transport ladder 60/30/20 | FR26, FR27, FR28 | Epic 12 | OK |
| G-FR9 | faster commute changes WHAT you read | — | **no numbered FR** | REVIEW |
| G-FR10 | the sensor migrates to paperwork | — | **no numbered FR** | REVIEW |
| G-FR11 | housing = proximity to a life | — | **no numbered FR** | REVIEW |
| G-FR12 | four-beat shift template | FR9 | Epic 8 | OK |
| G-FR13 | props carry visible state | FR10 | Epic 8 | OK |
| G-FR14 | procedure on objects, not menus | FR11 | Epic 8 | OK |
| G-FR15 | simulate what can be done badly | FR12 | Epic 8 | OK |
| G-FR16 | no score; self-imposed standards | FR13 | Epic 8 | OK |
| G-FR17 | freedom inverse to supervision | FR15 | Epic 8 | OK |
| G-FR18 | five playable jobs | FR14 | Epic 8 | OK |
| G-FR19 | two-handed principle ships | FR16 | Epic 8 | OK |
| G-FR20 | rent every 7 in-city days | FR19 | Epic 7 | OK |
| G-FR21 | wage/rent/food/surplus figures | FR20 | Epic 7 | OK |
| G-FR22 | flatshare halves rent | FR21 | Epic 12 | OK |
| G-FR23 | no eviction; Ruin By Process | FR22, FR23 | Epic 7 | OK |
| G-FR24 | bike/pass/closer-flat costs | FR26, FR27 | Epic 12 | OK |
| G-FR25 | one-time buys minutes, recurring doesn't | — | **no numbered FR** | REVIEW |
| G-FR26 | understudy earns same wage | FR41 | Epic 9 | OK |
| G-FR27 | labour market self-balances | FR67, FR68 | Epic 5 | OK |
| G-FR28 | housing desirability tracks state | — | **no numbered FR** | REVIEW |
| G-FR29 | money is stored time only | FR29 | Epic 7 | OK |
| G-FR30 | qualification costs minutes not money | FR100 | Epic 13 | OK |
| G-FR31 | no win/loss/death/score | FR23 | Epic 7 | OK |
| G-FR32 | Ruin By Process 4 links | FR22 | Epic 7 | OK |
| G-FR33 | floor inhabitable; welfare/shelters | FR24 | Epic 10 | OK |
| G-FR34 | night shift always available/pays | FR43 | Epic 9 | OK |
| G-FR35 | injury routes through hospital chains | FR25 | Epic 11 | OK |
| G-FR36 | chain investigation->...->labour | FR81 | Epic 10 | OK |
| G-FR37 | each link an occupation, no seam | FR82 | Epic 10 | OK |
| G-FR38 | chains stall/deny/expedite | FR74, FR76, FR77 | Epic 10 | OK |
| G-FR39 | response time is a budget line | FR83 | Epic 10 | OK |
| G-FR40 | municipal memory | — | **no numbered FR** | REVIEW |
| G-FR41 | plastic-bottle reference chain | FR84 | Epic 10 | OK |
| G-FR42 | development chain | FR158 | Epic 14 | OK |
| G-FR43 | v1 chains AI-staffed end to end | FR18 | Epic 10 | OK |
| G-FR44 | understudy conservative mandate | FR36 | Epic 9 | OK |
| G-FR45 | understudy banks surplus | FR36, FR37 | Epic 9 | OK |
| G-FR46 | absence reconciles as record; post | FR39, FR40 | Epic 9 | OK |
| G-FR47 | understudy drift bounded | FR38 | Epic 9 | OK |
| G-FR48 | understudy not configurable | FR36 | Epic 9 | OK |
| G-FR49 | night shift in NPC body, tiredness cap | FR42 | Epic 9 | OK |
| G-FR50 | night shift non-diegetic pick | FR42 | Epic 9 | OK |
| G-FR51 | borrowed shifts anonymous | FR43 | Epic 9 | OK |
| G-FR52 | night posts differ only by pay/duration | FR43 | Epic 9 | OK |
| G-FR53 | AI backfill; post always covered | FR44 | Epic 9 | OK |
| G-FR54 | never punish logging off | FR47 | Epic 9 | OK |
| G-FR55 | kinematic continuity, no seam | FR140 | Epic 4 | OK |
| G-FR56 | ledger vs body separation | FR56, FR57, FR58 | Epic 5 | OK |
| G-FR57 | player/AI indistinguishability | FR35, FR82 | Epic 9, Epic 10 | OK |
| G-FR58 | presence verbs | FR30 | Epic 8 | OK |
| G-FR59 | civic verbs | FR31 | Epic 8 | OK |
| G-FR60 | binning reverses litter | FR32, FR85 | Epic 8, Epic 10 | OK |
| G-FR61 | conversation as loitering, costs minutes | FR33 | Epic 8 | OK |
| G-FR62 | dignity work | FR34 | Epic 8 | OK |
| G-FR63 | good move != efficient move | — | **no numbered FR** | REVIEW |
| G-FR64 | gamey affordances only where needed | — | **no numbered FR** | REVIEW |
| G-FR65 | simulate people not abstractions | FR48 | Epic 5 | OK |
| G-FR66 | variable depth, uniform in kind | FR49, FR57 | Epic 5 | OK |
| G-FR67 | city always ticks | FR3 | Epic 4 | OK |
| G-FR68 | bodies instantiate from computed truth | FR58 | Epic 5 | OK |
| G-FR69 | the Truth Test | — | **no numbered FR** | REVIEW |
| G-FR70 | resolution scales, causality doesn't | — | **no numbered FR** | REVIEW |
| G-FR71 | five population design constraints | — | **no numbered FR** | REVIEW |
| G-FR72 | equilibrium-seeking law | — | **no numbered FR** | REVIEW |
| G-FR73 | gentrification undamped; supply added | FR157 | Epic 14 | OK |
| G-FR74 | growth physically visible | FR159 | Epic 14 | OK |
| G-FR75 | v1 growth = adjacent neighbourhoods | FR157 | Epic 14 | OK |
| G-FR76 | geographic social graph emerges | FR55 | Epic 5 | OK |
| G-FR77 | no XP/level/skill tree/net worth | FR104 | Epic 12 | OK |
| G-FR78 | gated by qualification and vacancy | FR99, FR100, FR101 | Epic 13 | OK |
| G-FR79 | diegetic progression carriers | FR102 | Epic 13 | OK |
| G-FR80 | growth opens new posts | FR157 | Epic 14 | OK |
| G-FR81 | three lateral pursuits | FR103 | Epic 12 | OK |
| G-FR82 | places dropped; exception retired | — | **no numbered FR** | REVIEW |
| G-FR83 | dependency by decisions not presence | FR106 | Epic 13 | OK |
| G-FR84 | difficulty curve inverted | — | **no numbered FR** | REVIEW |
| G-FR85 | no late-game pressure added | — | **no numbered FR** | REVIEW |
| G-FR86 | everything generated from a seed | FR107 | Epic 3 | OK |
| G-FR87 | generator rules ARE the pipeline | FR111, FR112 | Epic 2 | OK |
| G-FR88 | determinism: same seed same city | FR108, FR109 | Epic 3 | OK |
| G-FR89 | one district: streets/interiors/etc | FR114, FR116 | Epic 3 | OK |
| G-FR90 | neighbourhood character params | FR113 | Epic 3 | OK |
| G-FR91 | no level progression; city extends | FR157 | Epic 14 | OK |
| G-FR92 | density local, per screen | — | **no numbered FR** | REVIEW |
| G-FR93 | LimeZu 16x16 oblique | — | **no numbered FR** | REVIEW |
| G-FR94 | character sheets unsplit -> split | — | **no numbered FR** | REVIEW |
| G-FR95 | contemporary unnamed city | — | **no numbered FR** | REVIEW |
| G-FR96 | no HUD; diegetic carriers | FR102, FR104, FR152 | Epic 1, Epic 12, Epic 13 | OK |
| G-FR97 | ambient audio beds | FR153 | Epic 11 | OK |
| G-FR98 | music rare and diegetic | FR154 | Epic 11 | OK |
| G-FR99 | audio as legibility channel | FR155 | Epic 11 | OK |
| G-FR100 | browser, no install, no ceremony | FR144, FR145 | Epic 4 | OK |
| G-FR101 | WASD on oblique grid | FR149 | Epic 1 | OK |
| G-FR102 | click a world object | FR148 | Epic 1 | OK |
| G-FR103 | no controller/touch in v1 | — | **no numbered FR** | REVIEW |

**83 of 103 GDD requirements trace directly to a numbered FR.** The remaining 20 were each investigated individually rather than counted as gaps — a design document legitimately contains rationale, design laws and exclusions that are not functional requirements and should not be forced into becoming them.

### Part 3 — Disposition of the 20 untraced requirements

**Covered as non-functional requirements (6).** These are constraints, not features, and the epics correctly classified them as NFRs:

| G-FR | Requirement | Covered by |
|---|---|---|
| G-FR69 | The Truth Test | NFR19 |
| G-FR70 | Resolution scales; causality does not | Design law, realised through FR49 (L2 advances every citizen identically) |
| G-FR71 | Five population design constraints | NFR7, NFR8, NFR9, NFR10 |
| G-FR72 | Equilibrium-seeking law | NFR20 |
| G-FR92 | Density is local, per screen | NFR7, NFR15a |
| G-FR103 | No controller or touch in v1 | NFR6 |

**Substantively covered in stories, but unnumbered (3).** Real work exists; only the traceability number is absent:

| G-FR | Requirement | Where it actually lives |
|---|---|---|
| G-FR28 | Housing desirability tracks physical state and demand; rent follows | **Story 14.9 — Gentrification Stays Desirable**, plus Story 3.7's requirement that physical state, desirability and land use be readable quantities |
| G-FR93 | LimeZu 16×16 oblique art | Epic 2's atlas and footprint stories, which reason explicitly about oblique projection with front-facing bias and validate against LimeZu wall sprites |
| G-FR94 | Character spritesheets unsplit — splitting is known work | **Story 2.7 — Character-Part Atlases** |

**Correctly not requirements (10).** These are design rationale, stated tensions, exclusions or art direction. Turning them into acceptance criteria would be a category error:

G-FR9 (a faster commute changes *what* you read) · G-FR10 (the sensor migrates to paperwork — narrated in Epic 13's preamble) · G-FR11 (housing is proximity to a life) · G-FR25 (one-time purchases buy minutes efficiently; recurring do not — a balance rule the FR26/FR27 figures already encode) · G-FR63 (the good move and the efficient move differ) · G-FR64 (gamey affordances only where the experience breaks) · G-FR82 (places dropped; the physical-carrier exception retired) · G-FR84 (the difficulty curve is inverted) · G-FR85 (no late-game pressure may be added) · G-FR95 (a contemporary, unnamed city).

**Genuinely absent (1).**

> **G-FR40 — Municipal memory.** The GDD asserts, in its Institutional Chains section: *"Municipal memory. The city observes and alters itself, readable like weather."* This phrase appears **nowhere in the epics document** — no FR, no NFR, no story, no acceptance criterion.
>
> **Assessment: low severity, but it should be closed deliberately rather than left ambiguous.** The capability is plausibly subsumed — the city does observe itself through complaint filing (FR80), matters arriving through four fluxes (FR70), and citizen memory written on surprise (FR55), and it does alter itself through chains. What is missing is any *city-level* observation-and-adjustment distinct from per-citizen memory and per-institution matters. Either the GDD phrase is a poetic restatement of those mechanisms — in which case it needs no epic and the GDD should say so — or it names a distinct system nobody has scoped. **This is the only GDD assertion in the entire document with no traceable counterpart, which is a strong result; it is worth one sentence of adjudication rather than being carried forward as an unknown.**

### Part 4 — Non-functional requirement traceability: the real gap

**This is the significant finding of Step 3, and it is structural rather than a matter of missing content.**

The epics document builds a complete, machine-verified coverage map for its 172 functional requirements. **It builds nothing equivalent for its 46 non-functional requirements.**

| Measure | FRs | NFRs |
|---|---|---|
| Declared in the inventory | 172 | 46 |
| Coverage map exists | **Yes** — every FR mapped to exactly one epic | **No — none exists** |
| Claimed by any epic | 172 (100%) | 6 (13%) — NFR18, NFR27, NFR28, NFR29, NFR37, NFR44, all by Epic 0 |
| Never referenced outside their own declaration line | 0 | **39 of 46 (85%)** |

**Does the substance exist even where the number does not?** I spot-checked 22 high-stakes NFRs against all 200 story bodies, searching for the *behaviour* rather than the identifier. **All 22 have substantive story coverage:**

| NFR | Constraint | Found in |
|---|---|---|
| NFR1 | 1-second cold boot | Story 1.14 — Spike: Boot Budget Measured |
| NFR2 / NFR11 | 60 FPS; L3 within ~2 ms/frame | Story 5.4 — Falsification Gate: The L3 Frame Budget |
| NFR3 | Server never spins down | Story 4.1 — clock advances with zero clients |
| NFR4 | Zero reconnection seam | Story 4.4 |
| NFR12 | GPU texture-unit limit | Story 2.7 — atlases count toward the limit |
| NFR18 / NFR28 | Every state change has an author; `sim/` purity | Story 0.2 — Project Context for Agents |
| NFR25 | Generation determinism | Story 0.9 (CI), Stories 3.13–3.14 (harness) |
| NFR29 | Property tests over `sim/` in CI | Story 0.9 |
| NFR33 / NFR34 | Additive-only schema; scheduled-table permanence | Story 0.6, Story 1.2 — Permanent Schema Decisions |
| NFR37 | Every table declares a bound | Story 4.12 |
| NFR39 | Backup and a *tested* restore | Story 1.4 — Spike: Backup, Export and a Tested Restore |
| NFR41 | Reducers return `Result`, never panic | Story 3.x — "the transaction aborts cleanly… the reducer did not panic" |
| NFR43 | The shrug test | Story 0.2 — empty till, denied budget are content, not errors |
| NFR45 / NFR46 | Runtime-tunable balance; seed values visibly marked | Story 5.7, Story 6.14 |

**So the risk is not unbuilt work — it is unverifiable completion.** The FR side can answer "is every requirement scheduled?" with a script. The NFR side cannot answer it at all. On this project that asymmetry is pointed in exactly the wrong direction: BrowserCity's hardest and most falsifiable constraints are **non-functional** — the 1-second boot (A4, the hardest constraint in the project), sustained 60 FPS, generation determinism, the ~40 GB storage wall, and the schema decisions that *cannot be changed after the first commit*. Those are the requirements where a silent omission is expensive and late-discovered.

**Recommendation:** add an NFR coverage map alongside the FR one before implementation starts. This is roughly an hour of work against a document that already contains all the evidence — the spot check above located 22 of them in minutes. Unlike the FR map it will not be one-to-one; several NFRs are standing constraints that every epic must satisfy rather than work any single epic performs, and the map should say so explicitly (a `standing constraint` disposition) rather than forcing a false assignment.

### Coverage Statistics

| Measure | Count | Percentage |
|---|---|---|
| GDD functional requirements extracted (`G-FR`) | 103 | — |
| Traced to a numbered FR in the epics | 83 | 80.6% |
| Covered as an NFR or realised design law | 6 | 5.8% |
| Substantively covered in stories, unnumbered | 3 | 2.9% |
| Correctly not requirements (rationale, exclusions, art direction) | 10 | 9.7% |
| **Genuinely absent** | **1** | **1.0%** |
| **Effective GDD coverage** | **102 / 103** | **99.0%** |
| | | |
| Epics' own FRs mapped to exactly one epic | 172 / 172 | 100% |
| Epics' NFRs with a coverage mapping | 6 / 46 | **13.0%** |
| Sampled NFRs with substantive story coverage | 22 / 22 | 100% |

### Verdict

**Functional coverage is excellent and independently verified.** 99% of GDD requirements have a traceable implementation path; the single absence is a one-line GDD phrase of uncertain intent, not a missing system. The epics' internal integrity claims are true — I re-derived all of them rather than taking the document's word, and every one held. The document is also more careful than a naive audit would credit: FR14's split delivery across Epics 8 and 11 is correctly marked rather than fudged.

**Non-functional traceability is absent and should be built before implementation starts.** The work appears to be scheduled; nobody can currently prove it, and the constraints in question are the ones that are expensive to discover late.

---

## NFR Traceability — Resolved 2026-08-29

**Decision:** NFRs are covered by tests. Development is TDD throughout, and **each NFR gets its test in the earliest epic that makes it testable.**

This is a better answer than the coverage map recommended in Step 3. A coverage map records an intention; a test placement records an obligation that fails a build. It also removes the awkwardness the recommendation had to concede — that several NFRs are standing constraints no single epic "covers" — because a standing constraint is naturally expressed as a CI invariant that runs from its first epic onward rather than as an assignment to one owner.

**Built:** an **NFR Test Placement Map** in `planning-artifacts/epics.md`, immediately after the FR Coverage Map. All **47 NFRs** (NFR1–NFR46 plus NFR15a) are placed exactly once — verified programmatically: none missing, none duplicated, none placed that was not declared.

Each entry carries the earliest epic that makes the NFR testable and one of four test kinds:

- **Gate** — a spike or benchmark that must pass before dependent work proceeds; failing it overturns a decision rather than producing a bug (NFR1, NFR2, NFR10, NFR11, NFR25, NFR39)
- **Test** — an ordinary automated test, written first, in the named epic
- **Invariant** — an architectural, lint or property test running in CI from that epic onward, failing the build for every later epic too
- **Review** — not mechanically testable; enforced by Epic 0's review gate (NFR21, NFR27 only)

**Distribution of first tests:**

| Epic | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| NFRs first tested | 1 | **17** | 3 | 2 | 8 | 12 | 2 | 1 | 1 |

**The shape is right, and it is front-weighted.** 31 of 47 are first tested by the end of Epic 4 — before the project's expensive falsification points, so a constraint that is going to overturn a decision does so while the decision is still cheap to revisit.

**The seventeen in Epic 1 are the point, not a burden.** Most are properties of the module and schema rather than of any feature, and two of them — NFR33 (schema additive only; primary keys and unique constraints permanent and correct in the first commit) and NFR34 (anything that might ever need scheduling must be created as a scheduled table) — describe decisions that **cannot be corrected afterwards at all**. Their tests have to exist before there is a schema to get wrong. Under TDD that is the natural order rather than an imposition.

**Three placements are judgement calls worth a glance:**

- **NFR1 (1-second boot)** is gated in Epic 1 by the existing boot-budget spike, but only becomes an end-to-end assertion in Epic 4 when the real boot sequence exists. The Epic 1 gate is what stops the budget being spent before anyone is measuring it.
- **NFR2 (60 FPS)** is baselined in Epic 1 on the hand-laid test street and only fully assertable in Epic 5 with a rush-hour crowd to render. Placing it in Epic 1 also closes open item **G3** (no frame budget allocated across renderer, L3 and UI).
- **NFR21 (consequence needs a physical carrier)** is partly mechanical from Epic 5 — assert no reputation or approval scalar exists on any table — but the full claim stays a review judgement, so it is marked Review at Epic 10 rather than given a test that would only appear to cover it.

**Status: closed.** The Step 3 finding is resolved. Non-functional requirements now have a stronger traceability story than the functional ones: an FR is mapped to an epic, whereas an NFR is mapped to a test that fails a build.
