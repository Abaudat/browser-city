---
title: "BrowserCity — Development Epics"
status: draft
created: 2026-08-25
updated: 2026-08-25
---

# BrowserCity — Development Epics

Detailed breakdown. `gdd.md` carries the summary table and the sequence; this file carries goal, scope, exclusions, dependencies and the playable deliverable for each epic.

**Context for sizing.** One developer with agentic assistance, evenings and weekends, no deadline. Epics are ordered so that each ends in something a person can actually do, and so that the two project-killing hypotheses are tested as early as the foundation allows.

**Multiplayer is not an epic.** Authoritative simulation means the server runs the city with zero clients connected; a second connected player is close to incrementally free. Netcode is E4's architecture, not a later milestone. Building single-player first would require retrofitting netcode — the more expensive path.

---

## E1 — Client and Render Foundation

**Goal:** a browser client that can render the city and let a person move through it.

**In scope:**
- Engine selection and project setup
- LimeZu tile import pipeline (Modern Exteriors + Modern Interiors, 16×16, pre-split)
- Layered oblique renderer with correct depth sorting for a front-facing-bias perspective
- Camera follow, viewport management
- Input handling (WASD/arrows movement, click-to-interact plumbing)
- Character spritesheet splitting (known work — the character sheets are unsplit)
- Barebones options menu (audio, display, controls)

**Out of scope:** any simulation, any server, any procedural generation, any job.

**Dependencies:** none. This is the first epic.

**Playable deliverable:** walk an avatar down a hand-laid test street in a browser tab.

---

## E2 — Tile Semantics and Authoring Rules

**Goal:** the data model that lets agents build the city correctly without a human placing tiles.

This epic is load-bearing, not plumbing. Because the design ships **no hand-authored content** and the entire city is generated (E3), the generator's rules *are* the content pipeline. Everything downstream inherits their quality.

**In scope:**
- Tile taxonomy: what each tile means semantically, not just what it looks like
- Adjacency and constraint rules (what may sit next to what, what a wall corner requires, how a doorway is formed)
- Room and building grammar primitives
- A validation harness that can check a block against the rules and report violations
- Enough documentation and test coverage that an agent can extend the rule set and verify its own work

**Out of scope:** the generator itself (E3); gameplay of any kind.

**Dependencies:** E1 (needs the tile import pipeline and renderer to see results).

**Playable deliverable:** a hand-laid or scripted block validates against the rules, and a deliberately broken one is correctly rejected.

---

## E3 — City Generation

**Goal:** a whole district, generated from a seed.

The largest and riskiest epic in the project.

**In scope:**
- Street layout generation
- Plot subdivision and building placement
- Building exterior generation from the grammar
- Interior generation (100+ interiors is the MVP target)
- **Neighbourhood character parameters** — density, building age, affluence, land-use mix. With nothing hand-placed, distinct neighbourhood character must come from the rules, and the brief requires it explicitly
- Institution placement (depot, council building, shops, cafés) as generated types with placement constraints
- Determinism: the same seed produces the same city

**Out of scope:** citizens, simulation, transit routing (E10), the growth mechanism (E13).

**Dependencies:** E2.

**Playable deliverable:** walk a generated district, enter buildings, and find neighbourhoods that read as different from one another.

---

## E4 — Authoritative Server and Netcode

**Goal:** the world lives server-side; the browser renders and takes input.

**In scope:**
- Authoritative server tick (continuous, runs with zero clients connected)
- Thin client state sync
- Multiple concurrent connected clients in one city
- Connection, reconnection and kinematic continuity (you return where cause and elapsed time put you)
- **Boot to standing-in-the-city in under one second**, including load, with no character creation ceremony

**Out of scope:** anti-cheat hardening, scaling beyond a single district, matchmaking of any kind.

**Dependencies:** E1, E3.

**Playable deliverable:** two browsers standing in the same generated city, seeing each other move.

**Risk note:** the one-second boot against MMO streaming is the hardest technical constraint in the project and the brief records that it has not been designed against.

---

## E5 — The Day Loop

**Goal:** live one day. This epic answers the Burger Test.

**In scope:**
- The in-city clock: 60 real minutes per day, detached, continuous
- Home (the starting edge flat), the commute (60 in-city min each way, on foot)
- **The first playable job: convenience shop till** — one interior, no vehicle, no route. Serve, scan, bag, take payment, make change; the till runs short of change
- Wage payment (10 / in-city hour)
- Rent falling due weekly (250/week)
- Sleep

**Out of scope:** the full shift template (E6), other jobs, the understudy, AI citizens.

**Dependencies:** E4.

**Playable deliverable:** wake, commute, work a shift, get paid, have rent taken. **And a first read on whether that is fun.**

**Signal-quality note.** The shop till is the more engaging first job but the *softer* Burger Test: it may be satisfying because of customers and feedback, in ways that do not generalise to an unsupervised post. The hard case is deliberately held one epic back rather than dropped — see E6.

---

## E6 — Procedure and Props

**Goal:** work that can be done badly.

**In scope:**
- The four-beat shift template (ritual open / rhythmic duties / discretionary middle / ritual close) generalised across jobs
- **The multi-step procedure interaction model** — how grind → dose → tamp → pull is actually performed. This is the most important unresolved control question in the design and is resolved here, by prototyping
- Props with state: the till short of change, the stamp dry, the hopper empty
- Toys inside jobs (solitaire on the guard computer)
- Self-imposed standards: actions that are never required, tracked or rewarded, but change the world
- **Second job: security guard, empty building** — one interior, no customers, no supervision, solitaire on the computer. **This is the hard Burger Test case**: if an unsupervised shift with nothing demanding attention is not satisfying, P4 has failed and the design's foundation is wrong
- **The verb vocabulary (M7):** presence verbs (sit, order, wait), civic verbs (bin the bottle, hold the door, give up the seat), conversation as loitering priced in minutes, dignity work
- Procedures built so that some **may require two people** — the principle, not yet the content

**Out of scope:** vehicle-based jobs (E10).

**Dependencies:** E5.

**Playable deliverable:** two jobs with real procedure, each of which can be performed well or badly, with nothing scoring you. **And the hard Burger Test answer** — does the empty post hold a player?

---

## E7 — Reciprocal Occupancy

**Goal:** leave and come back safely.

**In scope:**
- The AI understudy: conservative mandate (works, pays rent, eats, sleeps, banks surplus, never gambles, never quits), non-configurable
- Absent-character reconciliation as a record, settled on return
- **The pile of post on the doormat** — rent receipts, payslips, council letters — as the diegetic carrier for missed time and for financial state
- The night shift: sleep, choose from a few offered posts, work an anonymous bounded shift in a borrowed body
- Tiredness cap sizing the night shift
- AI backfill for any unheld role

**Out of scope:** understudy drift as a designed narrative surface (emergent, watched, not engineered).

**Dependencies:** E6.

**Playable deliverable:** log off for a day, come back, read your post, and find your life intact and slightly richer.

---

## E8 — Citizens

**Goal:** the city is alive without you. This epic answers the AI-density hypothesis.

The addendum names this as the real engineering risk — harder than multiplayer.

**In scope:**
- AI citizen population with homes, jobs, schedules and ends of their own
- Variable-resolution simulation: full procedure near players, statistical elsewhere, reconciled on approach
- Separation of ledger from body — records simulate everywhere, bodies instantiate where observed
- Local density tuning (a busy street reads busy; a residential street at 3am reads quiet; the periphery is quiet by design)
- The labour market: ~100 professions, most AI-held, with wage self-balancing
- Agents remembering individual people

**Out of scope:** institutional chains (E9).

**Dependencies:** E7.

**Playable deliverable:** a city that feels populated with one player connected. **And the answer to whether AI can carry density.**

---

## E9 — The Reference Slice

**Goal:** the plastic-bottle loop, end to end. The thesis proof.

**In scope:**
- **Third playable job: sanitation / bin round** (the loop's labour end; vehicle + route)
- Bins with state; litter as a physical entity
- Broken windows: litter licenses litter, reversibly — **reversible by the sanitation chain *and* by any citizen who bins the bottle** (M7 civic verbs)
- Complaints as generated events
- The institutional chain: investigation → approval → budget → procurement → logistics → labour, AI-staffed end to end
- Municipal memory; response time as a budget line
- **Emergence surfaced on the commute** — the player reads the city's state on the route to work

**Out of scope:** player-holdable chain links (deferred; see Known Gap in `gdd.md`).

**Dependencies:** E8.

**Playable deliverable:** a sanitation budget shortfall produces a full bin, produces a dropped bottle, degrades a street, triggers complaints, and opens a budget chain — and the player watches it happen on their way to work.

---

## E10 — The District

**Goal:** the MVP's content breadth.

**In scope:**
- 100+ interiors populated and enterable
- Multiple neighbourhoods with distinct character (via E3's parameters)
- Real transit: routes, stops, timetables
- **Remaining two playable jobs: night bus driver** (vehicle + route) **and café barista** (one interior, deep procedure)
- Institutions present and staffed: shops, cafés, the depot, the council, a hospital, a welfare office, shelters

**Out of scope:** districts beyond the first.

**Dependencies:** E9.

**Playable deliverable:** the MVP district — five playable jobs, real transit, enterable interiors, institutions running.

---

## E11 — A Life

**Goal:** somewhere for the player's own minutes to go.

**In scope:**
- **Cooking**: ingredients, dishes learned by doing, a kitchen worth cooking in; cheaper than eating out
- **Collecting**: acquisition and display; the shelf is the progress bar
- **A sport or club**: a scheduled recurring social commitment with fees, a venue and a fixture
- The transport ladder: bike (450), transit pass (20/week)
- The housing ladder: closer flats, priced so they are a poor deal on minutes and a good deal on proximity-to-a-life
- **Flatshare:** shared tenancy and a rent split — 250/week becomes 125
- Diegetic progress carriers throughout — no counters anywhere

**Out of scope:** places-as-a-pursuit (deliberately not shipping; it was the only pursuit with no physical carrier).

**Dependencies:** E10.

**Playable deliverable:** a player with spare minutes has three genuinely different things to spend them on, and a shelf that shows it.

---

## E12 — Careers

**Goal:** climb into the machine.

**In scope:**
- Qualifications bought with minutes: courses, licences, certificates taken out of own-time
- Vacancies: real open posts in real institutions, opening when someone leaves
- Application and hiring
- Job access tiers — the project's primary scope valve
- Diegetic carriers: the certificate on the wall, the licence in the wallet, your name on a roster, a set of keys
- Positional consequence: decisions made in a role persist and shape the city

**Out of scope:** public office and private ownership as distinct systems (they are one mechanic under two labels, and belong to a later tier).

**Dependencies:** E11.

**Playable deliverable:** a player can spend their evenings qualifying for a post, wait for it to open, take it, and make decisions in it that outlast them.

**Note:** this is where the v1 chain-link gap can be closed — the council permits clerk or a development-chain role becomes the first player-holdable decision point.

---

## E13 — Growth

**Goal:** the city grows as the active player population grows, so there is always somewhere to begin.

**In scope:**
- The development chain: survey → approval → budget → procurement → construction
- New neighbourhoods generated adjacent to district one, keyed to active player population
- Construction physically visible: sites, hoardings, buildings appearing over time
- Housing supply feeding the rent market so local gentrification stays desirable rather than exclusionary

**Out of scope:** new districts (out of MVP scope entirely).

**Dependencies:** E12, E3 (generation must support incremental extension).

**Playable deliverable:** the player watches a new neighbourhood get built, caused by population pressure they are part of.

---

## Sequence and rationale

```
E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9 → E10 → E11 → E12 → E13
└──── foundation ────┘   └─ Burger Test ─┘   └ density ┘  └── content & depth ──┘
```

**Two falsification points:**

- **E5** gives a first read on the Burger Test, and **E6** delivers the hard case (the unsupervised empty post) — is mundane, unsupervised work intrinsically satisfying without SS13's round timer and antagonists? Everything after E5 assumes yes.
- **E8** answers AI density — can AI citizens carry the entire feeling of aliveness at low concurrency?

A pre-foundation throwaway spike for the Burger Test was considered and **declined**: the renderer and tile rules are needed regardless, and a spike's answer might not transfer to the real thing. The accepted cost is that the project's deciding question is answered after four foundation epics rather than in the first weeks.

## Mechanic coverage check

Every mechanic in `gdd.md` lands in an epic:

| Mechanic | Epic |
|---|---|
| M1 Shift work with procedure | E5 (shop till), E6 (template, procedure model, empty-post guard), E10 (remaining jobs) |
| M2 Rent as metronome | E5 |
| M3 Transport and housing optimisation | E11 |
| M4 Institutional chains | E9 (AI-staffed), E12 (player-holdable), E13 (development chain) |
| M5 The AI understudy | E7 |
| M6 The night shift | E7 |
| M7 The verb vocabulary | E6 (built), E9 (civic verbs reverse the litter loop) |
| Flatshare | E11 |
| Lateral pursuits | E11 |
| Career progression | E12 |
| Emergence / equilibrium-seeking | E8 (labour market), E9 (broken windows), E13 (housing supply) |
| Geographic social graph | E8 — emergent, not built |
| City growth | E13 |
