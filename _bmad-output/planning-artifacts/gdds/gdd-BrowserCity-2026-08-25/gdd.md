---
title: "Game Design Document: BrowserCity"
game_type: "Simulation (persistent multiplayer life-and-city simulation)"
platforms: "Browser (exclusive) — authoritative server-side simulation, thin client"
status: draft-complete
created: 2026-08-25
updated: 2026-08-25
---

# BrowserCity — Game Design Document

**Author:** Adrian
**Game Type:** Simulation — persistent multiplayer life-and-city simulation (MMO hybrid)
**Target Platform(s):** Browser, exclusively

## Executive Summary

BrowserCity is a persistent, browser-based life simulation set in a city that was running before the player arrived and keeps running after they close the tab. The player is not its hero. They are a person in it — with rent due, a job to get to, and a day's worth of minutes to spend. The city has institutions, those institutions are staffed by people, and some of those people are players.

The premise is **significance without centrality**. The player begins materially poor and ends up load-bearing: not the mayor, but the person who approves the budget line, drives the route, or holds the keys others wait on. The endgame deepens the opening fantasy rather than inverting it. At hour 100 the player is still one part of a massive thing — just a part it would notice losing.

What makes it work is a single economy: **time**. One in-city day is 60 real minutes. Work converts minutes into money; money buys minutes back — a bike, a closer flat, a transit pass — and rent takes its bite whether the player earned or not. What is left over is the only thing genuinely theirs, and they spend it on a life: a hobby, a collection, a club. Nothing here will ruin the player. Nothing here will praise them either.

**Core fantasy, in one sentence:** *You live an ordinary life in a city that does not need you — and slowly become someone it depends on.*

**The feeling players walk away with:** the quiet satisfaction of being *somewhere* — a place with its own business that let them in and gave them a spot in it. Not mastery. Belonging without importance.

---

## Target Platform(s)

**Browser, exclusively and non-negotiably.** No install, no plugin, no download gate.

Authoritative simulation runs server-side; the browser is a thin client that renders and takes input. **Boot to standing-in-the-city in under one second**, including load, with no character creation ceremony.

The technical constraint enforces the design thesis: BrowserCity is a place you drop into, not a session you commit to. The server runs continuously — the city ticks whether or not anyone is connected. Spinning down when empty was considered and rejected, because it makes causality a fiction and causality is the product.

Mouse and keyboard. No controller or touch support in v1.

---

## Target Audience

**Primary: cozy-persistent players.** The Animal Crossing and Habbo Hotel lineage — people who want a place to be rather than a game to beat. They log in for thirty minutes to check on something, they value routine and texture over challenge, and they play in a browser tab alongside other things.

**Secondary: systems-first sandbox players** who will tolerate early roughness for a world that is honestly simulated.

**The tension, stated plainly.** The design's closest comparables (Kenshi, Project Zomboid, Space Station 13, Eco) are harsh, opaque, systems-first games for a very different crowd. The stance that resolves it:

> **Cozy in consequence, harsh in arithmetic.**

The maths is real. Minutes are genuinely scarce; rent is 45% of gross; the bike genuinely matters. But nothing bad is ever irreversible. Falling behind starts a slow, visible, interruptible process with a floor beneath it. **Pressure is legible; it is never sharp.**

**Market context:** this is a passion project, not a commercial bid. The relevant opportunity is a gap rather than a market — the cozy-persistent space is almost entirely single-player or socially shallow, and the deep-simulation space is almost entirely hostile to newcomers. Nobody is serving people who want both.

---

## Goals and Context

### Project Goals

1. **Prove that mundane, unsupervised work is intrinsically satisfying** without SS13's round timer and antagonists to give it stakes. This is the hypothesis the whole design rests on, and the first one tested (Epic 7).
2. **Prove that AI citizens can carry aliveness at low concurrency.** At one connected player, AI must carry the entire density burden. This is the project's real engineering risk — harder than multiplayer (Epic 5).
3. **Ship a small multiplayer district** with five playable jobs, real transit, 100+ interiors, reciprocal occupancy live, and at least one institutional chain running end to end.
4. **Build it in a way one person can sustain** — uniform, data-driven, heavily testable systems that agents can extend and validate.

### Background and Rationale

**Design laws.** Not pillars — rules that decide arguments, and that any future feature must satisfy:

- **Consequence needs a physical carrier.** An effect propagates only if something in the world carries it. Litter spreads because litter is there; rudeness does not, because nothing lies in the street. This one rule eliminates morality meters, reputation auras, and invisible simulation nobody can read. *(The brief's narrow stated exception for places-you-have-seen is retired: places is not shipping as a pursuit, so the law now stands unqualified.)*
- **Progression is carried diegetically.** No net-worth display, no HUD balance, no counters. The world holds the evidence.
- **Resolution scales; causality does not.** Distant simulation is cheaper, never falser. Every state survives inspection back to a cause. Cheap is not fake.
- **Systemic content only.** No hand-authored quests, dialogue trees, or set pieces. A solo developer cannot author a city, but can grow one.
- **Every bounded quantity tends toward an equilibrium the non-player simulation actively tries to reach.** Equilibrium-seeking is what the AI layer is *for*. A system that lets a quantity drift with nothing pursuing its equilibrium is incomplete and does not ship. This law matters more here than in most simulations, because BrowserCity has removed every reset mechanism its comparables rely on.

**Why fidelity is a means, not an end.** An earlier position held simulation fidelity as the highest-priority pillar. Under the chosen core fantasy it is demoted: fidelity exists to manufacture felt pressure and social position. This legitimises faking anything a player can never feel the weight of, and is the single largest cost saving available to the project.

**A caution that must survive into production.** "You can watch the city think" is partly a fantasy about the developer's achievement. Players do not get satisfaction from a system being genuinely simulated; they get it from *noticing* something. The physical-carrier law is currently the only legibility mechanism the design has, and it carries that entire burden alone.

**Team and capacity:** one developer with agentic assistance, working evenings and weekends, indefinitely, with no deadline. A meaningful but bounded monthly server spend, self-funded, running for years before anyone plays.

---

## Unique Selling Points

1. **Every link in the institutional machine is a job somebody holds.** Space Station 13's cog-in-the-machine premise, made persistent, made lawful, and made cozy in consequence. Chains run investigation → approval → budget → procurement → logistics → labour, and each link is an occupation — AI-held or player-held, with no mechanical seam between them.
2. **A single currency: time.** Everything is priced in minutes. Money is stored time and nothing else. The bike is not an upgrade; it is a 17% raise in the only thing that is scarce.
3. **Reciprocal occupancy.** An AI understudy holds your life when you leave; you hold an NPC's when you sleep. Absence is safe, the night is populated, and no institution deadlocks because somebody went to bed. It is the most load-bearing single mechanic in the design.
4. **Consequence you can see, because something carries it.** No morality meter, no reputation aura, no HUD. A full bin produces a dropped bottle, which licenses the next, which degrades a street, which triggers complaints, which opens a budget chain. You read it on your commute.
5. **A browser tab that opens in under a second.** No install, no launcher, no character creation. A place you drop into rather than a session you commit to.

**Differentiation, honestly stated.** Each ingredient exists elsewhere; the *set* does not exist anywhere. The rest of the edge is execution and feel — the texture of a shift, the weight of a first bike. Execution is not a moat. There is no technical moat here and this document will not pretend otherwise.

| Comparable | What is taken | What is deliberately left |
|---|---|---|
| **Space Station 13** | Every institutional role is player-holdable; story comes from institutional friction, not authored plot | The round reset, the antagonists, the chaos. Its institutions exist to be disrupted; ours exist to be staffed |
| **Kenshi / Project Zomboid** | A world that genuinely does not care about you | The brutality and the fail-cliff. Nothing in BrowserCity can destroy you |
| **Eco / Ultima Online** | Players holding real economic and institutional positions | Server wipes, and PvP as the engine of drama |
| **Habbo Hotel** | Browser-native, pixel, socially persistent | Social space with nothing underneath it. Ours has a simulation |
| **Receiver 2** | Manual, procedural handling of ordinary objects as an aesthetic rather than a difficulty | Its subject matter and its lethality. Applied here to bin bags and till drawers |

---

## Core Gameplay

### Game Pillars

Four pillars. Each is the fundamental gameplay element that the rest of the design answers to; each carries a **Steers** clause naming the decisions it settles, so a pillar can be used in an argument rather than admired in a document.

#### P1 — Time is the only real currency

Everything the player can want is priced in minutes: the commute, a conversation, a hospital stay, a night in the cells, a hobby. Money is stored time and nothing else — it exists to be converted back into minutes (a bike, a closer flat, a transit pass) or spent on a life. Rent takes its bite whether or not the player earned that day.

**Steers:** every cost in the game is denominated in minutes before it is denominated in currency. No system may introduce a resource that competes with time as the scarce thing. Convenience purchases must be expressible as minutes-per-day returned.

**Cut test:** remove it and BrowserCity is an MMO with a wallet — money accumulates, nothing is traded against anything, and the flat near work stops mattering.

#### P2 — The city is indifferent because it is fully staffed

The city has no opinion of the player, and the reason is structural rather than a missing feature: every institutional function is an occupation, held by somebody with ends of their own. Nobody is waiting for the player, because the post is already covered. This is what makes both halves of the fantasy true at once — the city does not need *you*, but it does need *the role*, and that is the door the player walks through. Late-game significance is not the city changing its mind about the player; it is the player occupying enough of the machine that others route through them.

**Steers:** no morality meter, no reputation aura, no approval score, no destiny — because indifference is achieved by giving agents their own goals, not by deleting a meter. Every institutional link must be an occupation with a work loop, holdable by an AI citizen or a player, with no mechanical seam between the two. Any proposed feature that makes the world reference the player as protagonist fails this pillar.

**Cut test:** remove it and you get quests, an approval bar, and a city that was idling until the player arrived.

#### P3 — You are always covered

Reciprocal occupancy. When the player leaves, an AI understudy holds their life and runs it conservatively. When the player's character sleeps, the player takes over an NPC's working night — a bounded, paid shift in someone else's body. Absence is safe, the night is populated, and no institution deadlocks because somebody went to bed.

**Steers:** no system may punish logging off. Every role has a defined AI fallback. The design may never assume a player is present for a chain to advance. Session boundaries are never world boundaries.

**Cut test:** remove it and the game evicts the player daily, the night city empties, institutional chains stall on absence, and the whole thing degrades into a login-timer game.

#### P4 — Procedure makes work inhabitable and the machine readable

Work decomposes into ordered steps with state — arrange, grip, ink, apply, re-ink — and props deplete: the stamp runs dry, the till runs short of change. Procedure does two jobs. It makes the **discretionary middle** possible: a shift where nobody is watching only means something if there is a thing you are supposed to be doing and could choose not to. And it is how the simulation becomes **legible** at human scale — Design Law "consequence needs a physical carrier" delivered as an object in the player's hands.

**Steers:** an action is worth simulating when it can be performed badly; otherwise it is abstracted. Every playable job must have a ritual open, rhythmic duties, a discretionary middle, and a ritual close. Props carry state. Freedom scales inversely with supervision, so the least supervised post is designed as the most interesting one, not the emptiest.

**Cut test:** remove it and shifts become progress bars, the discretionary middle has nothing to be discretionary about, and the player never sees the simulation working — only its outputs.

#### Pillar tension, stated

P2 (indifference) and the player-experience goal of **being needed** pull in opposite directions by design. The resolution is that significance is positional, not attitudinal: the player becomes load-bearing by occupying links, never by earning the city's regard. Any feature that resolves this tension by making the city *appreciate* the player has broken P2 and should be rejected.

### Core Gameplay Loop

#### The clock

**One in-city day = 60 real minutes. One in-city hour = 2.5 real minutes.** The clock is *detached* from real-world time and runs continuously whether or not anyone is connected, so every player rotates through all in-city hours across their real week rather than always logging in to the same time of day.

#### The day's time budget — a starting player

| Block | In-city | Real | Notes |
|---|---|---|---|
| Sleep | 8h | 20 min | Player logs off (understudy takes over) **or** works a borrowed night shift |
| Work | 8h | 20 min | Includes ritual open and ritual close (~30 in-city min each) |
| Commute | 2h | 5 min | 60 in-city min each way, on foot, from the starting edge flat |
| **Own time** | **6h** | **15 min** | The only genuinely discretionary block |
| **Total** | **24h** | **60 min** | |

#### The cycle

```
   wake in a flat you can barely afford
            │
            ▼
   COMMUTE  ── the city is read here ──────────┐
   (−minutes)                                  │  emergence enters
            │                                  │  the loop at this step
            ▼                                  │
   SHIFT    ritual open → rhythmic duties      │
            → DISCRETIONARY MIDDLE             │
            → ritual close                     │
            │                                  │
            ▼                                  │
   PAID     (+money = stored minutes)          │
            │                                  │
            ▼                                  │
   SPEND    buy minutes back (bike, pass,      │
            closer flat)  ── or ──  spend      │
            them on a life (lateral pursuit)   │
            │                                  │
            ▼                                  │
   RENT     falls due weekly, earned or not ───┘
            │
            ▼
   SLEEP ──┬── log off → AI understudy holds the life
           └── stay up → borrowed night shift in an NPC body
```

#### Which pillar each step serves

| Step | Pillar | Why it is in the loop |
|---|---|---|
| Commute | P1 (cost in minutes), P4 (legibility) | The minute-tax, and the player's primary sensor on the city's state |
| Shift | P4, P2 | Procedure makes the block inhabitable; the post exists because the machine is staffed |
| Paid | P1 | Money enters only as stored time |
| Spend | P1 | The only real decision in the loop: buy minutes back, or spend them on a life |
| Rent | P1 | The metronome — takes its bite whether or not the player earned |
| Sleep branch | P3 | Absence is safe; the night is populated |

#### The commute is the sensor

Emergence reaches the player on the way to and from work. The bin that is full, the street that has degraded, the tram that is late because of a budget decision made in a building the player has never entered — these are read on the route, not reported in a feed. This is what gives the hundredth run of the loop content that the first run did not have, and it is Design Law "consequence needs a physical carrier" doing its job at the scale of a walk.

#### The transport ladder — and the tension it creates

| Rung | Commute each way | Own time/day | Gain |
|---|---|---|---|
| Edge flat, on foot (start) | 60 min | 6h (15 real min) | — |
| Edge flat + bike | 30 min | 7h (17.5 real min) | **+17%** |
| Transit pass / closer flat | 20 min | 7h 20m (18.3 real min) | +22% from start |

**These figures are load-bearing on map scale.** The commute arithmetic above is true only at the settled scale: walking speed is **2.2 cells/sec**, which is what makes a ~333-cell starting commute take exactly 60 in-city minutes on a 512-cell map. The ladder then lands precisely on the design's stated floor — bike at 2x gives 30 in-city minutes, transit pass at 3x gives 20. Because `commute_in_city_minutes = 0.26 x map_width / walk_speed`, **any change to map size or walking speed must be made together, or the ladder and its floor stop being true.**

**Stated tension:** P1 pushes the player to buy the commute down, but the commute is the loop's variance source. Optimise perfectly and you see less of the city. This is a deliberate trade, not a leak, and it is resolved three ways:

1. **There is a floor.** The commute never reaches zero — roughly 20 in-city minutes at best, still real time in the street each leg.
2. **Faster changes *what* you read, not whether.** The tram route passes different streets than the walk did; a closer flat puts the player in a different neighbourhood to notice.
3. **The sensor migrates.** Early game the player reads the city by walking through it. Late game they read it through the paperwork that crosses their desk — institutional position becomes the window. *This is the answer to the brief's open question Q5 (the handoff from early lateral pursuit to late institutional position): the game does not go quiet in between, because the thing that shows you the city changes hands rather than switching off.*

**Second-order consequence, recorded:** once commute nears its floor, the housing ladder stops competing on minutes (the top rung buys only +5% own-time over the bike) and starts competing on **what is within walking distance** — the player's pursuits, their people, their usual places. Housing's late-game value is proximity to a life, not proximity to work.

#### Why the hundredth run

Three answers, in order of load-bearing:

1. **The discretionary middle.** The unsupervised block of the shift is where the game actually lives, and it is different every day because the player chooses what it is.
2. **The commute's variance.** The city's state is genuinely different, and readable.
3. **Lateral pursuit and position.** These carry the *month*, not the day — they are why the player returns tomorrow, not why today's cycle is worth running.

The loop deliberately does not close on novelty of content. There is no content treadmill because there is no authored content (Design Law: systemic content only).

### Win/Loss Conditions

**There is no win condition and no loss condition. There is no death.**

BrowserCity is open-ended by design: the city ran before the player and continues after. Nothing terminates, nothing is scored, and there is no state from which a player cannot return.

**Instead of loss — Ruin By Process.** Falling behind is a bureaucratic chain run *against* the player rather than a fail-state: notice → escalation → judgment → enforcement. Each link is a moment at which the player can intervene, negotiate, pay, or appeal, and each link is a job somebody holds (P2). Consequences are slow, visible, and interruptible.

**The floor is inhabitable.** Destitution is a place with its own routines and community, not a game-over screen. Welfare offices and shelters are simulated institutions with player-holdable roles — the mechanism that rescues a failing player is a career path for a thriving one. The borrowed night shift is always available and always pays, which means there is always a way up.

**Injury, not death.** Injury costs days and savings. Hospitals are institutions with paramedic, triage, nurse, surgeon, admin and billing chains — so being hurt puts the player inside the machine from the other side.

**What replaces winning.** Two non-terminating pursuits, neither of them a ladder with a top:

- **Being needed** — occupying links in the institutional machine until others route through the player.
- **Lateral pursuit** — the many small lives the city offers, chosen rather than assigned.


## Game Mechanics

### Primary Mechanics

Eight mechanics. Each names the pillar it serves and the numbers it runs on. A mechanic that serves no pillar is scope creep — none here are unattached. *(M8 was added 2026-08-29: the architecture found stock and logistics absent from this document and load-bearing.)*

---

#### M1 — Shift work with procedure

**Serves:** P4 (inhabitable, readable), P2 (the post exists because the machine is staffed)

Every playable job runs the same four-beat template, reused across the city:

| Beat | In-city duration | Real | What happens |
|---|---|---|---|
| Ritual open | ~30 min | 1.25 min | Arrive, change in, equip, handover chat with the person you relieve |
| Rhythmic duties | ~3h | 7.5 min | The rounds. Predictable, procedural, low supervision |
| **Discretionary middle** | **~4h** | **10 min** | Nobody is watching. This is where the game lives |
| Ritual close | ~30 min | 1.25 min | Final round, handover, change out, return equipment, goodbye |
| **Total shift** | **8h** | **20 min** | |

**Props carry state.** The stamp runs dry. The till runs short of change. The bin lorry fills. The coffee grinder needs its hopper topped up. State is visible on the object, never in a UI readout.

**Self-imposed standards.** Cleaning the lobby is never required, tracked, or rewarded. It is just cleaner afterwards. No job has a score.

**Freedom scales inversely with supervision.** The emptiest post is designed as the most interesting one, not the most neglected. The night guard's building is where P4 is proven or disproven.

**Launch roster — five playable jobs:**

| Job | Procedure | Fails badly as | Build cost |
|---|---|---|---|
| Sanitation / bin round | Route order, lift, empty, log, depot return | Missed bins, spillage, wrong route order | Vehicle + route |
| Night bus driver | Route, stops, timing, doors, fares | Running early, missed stops, harsh braking | Vehicle + route |
| Security guard (empty building) | Rounds, door checks, log entries | Skipped rounds, unlogged doors | One interior |
| Convenience shop till | Serve, scan, bag, take payment, make change, restock, cash up | Short-changing, queues, wrong change | One interior |
| Café barista | Grind, dose, tamp, pull, steam, serve | Bad shot, burnt milk, wrong order | One interior |

Four of the five need a single interior and no vehicle. The sanitation round is the reference slice's labour end and is required for the plastic-bottle loop.

**Known gap (accepted for v1):** no launch job is a *decision link* in an institutional chain. Players can observe chains — the slow ambulance, the budget that never happened — but cannot staff one. See § Assumptions and Dependencies.

---

#### M2 — Rent as metronome

**Serves:** P1

Rent falls due **every 7 in-city days (≈7 real hours)**, earned or not. It is the pressure source the whole time economy answers to.

| | Value |
|---|---|
| Entry wage | 10 / in-city hour → **80 / day** |
| Weekly gross (7 days) | **560** |
| Rent, edge flat | **250 / week — 45% of gross** |
| Food and necessities | ~90 / week |
| **Weekly surplus** | **~220** |

**Flatshare.** Rent can be split. A shared tenancy halves the metronome — 250/week becomes 125 — in exchange for sharing the space and whatever comes with that. It is the cheapest social content in the design (a shared tenancy record and a split, no new systems) and the most consequential: it is a genuine economic decision rather than flavour, and it means **the player's first friendship is a financial instrument.**

Missing rent does not trigger eviction. It triggers **Ruin By Process** (see § Win/Loss Conditions): a notice, then escalation, then judgment, then enforcement — each link a job somebody holds, each link a moment to intervene.

---

#### M3 — Transport and housing as one optimisation

**Serves:** P1

Money buys minutes back. The exchange rate is designed, not incidental:

| Purchase | Cost | Buys | Effective rate | Verdict |
|---|---|---|---|---|
| **Bike** | 450 one-time | +1h/day (+7h/week) | payback in **6.4 weeks** | ✓ good buy |
| **Transit pass** | 20 / week | +20 min/day (+2.3h/week) | 8.7 per hour vs 10/h wage | ✓ marginal buy |
| **Closer flat** | +130 / week rent | +20 min/day (+2.3h/week) | 56 per hour | ✗ bad on minutes |

**The rule this encodes: one-time purchases buy minutes efficiently; recurring costs do not.** The closer flat is deliberately a poor deal in pure time arithmetic — which is why housing's real value is **proximity to a life** (your pursuits, your people, your usual places) rather than proximity to work. The housing ladder does not compete with the transport ladder; it takes over once the transport ladder runs out.

---

#### M4 — Institutional chains

**Serves:** P2

A city event — an accident, congestion, a complaint, a change in footfall — triggers a multi-agent institutional process:

```
investigation → approval → budget → procurement → logistics → labour
```

Each link is an occupation with its own work loop, held by an AI citizen or (in later job tiers) a player. Chains stall, get denied, get expedited, and their consequences land on citizens who never saw the paperwork.

**Response time is a budget line.** How fast the ambulance arrives depends on a decision made in a building the player has never entered. This is the mechanism that makes the city's indifference *legible* rather than merely asserted.

At v1 the chains run **AI-staffed end to end**; players experience them from the receiving end and read their outputs on the commute.

---

#### M5 — The AI understudy

**Serves:** P3

When the player disconnects, an AI understudy holds their life. Its mandate is **conservative**: it goes to work, pays rent, eats, and sleeps. It never bets the paycheck, never quits the job, never takes a risk with the character's position.

**It banks the surplus.** The understudy pays rent automatically and the remainder accrues untouched, so the player returns with more in the bank than they left. Money is the one axis that advances during absence — which is deliberate, because money is the axis the design cares least about. Everything that actually matters (lateral pursuits, institutional position, the people who know you) still requires presence.

**Absence has a physical carrier: the post.** The absent character reconciles as a *record* rather than a tick-by-tick simulation, and settles on return. The player walks into their flat and the missed time is on the doormat — rent receipts, payslips, a letter from the council, a notice about the bins. This is how the player perceives their financial state without a HUD balance, and it makes logging in a scene rather than a loading screen.

**Understudy drift** is real and bounded: extended absence produces a character shaped by the AI's choices, but never a catastrophe.

---

#### M6 — The night shift

**Serves:** P3 (the night is populated; the floor is always available)

Staying up past the character's bedtime lets the player take over an NPC's working night — a bounded, paid shift in someone else's body, sized to how tired the character is.

**Framing: non-diegetic and deliberately so.** The player goes to sleep, is offered a few available night posts, and picks one. There is no shift board and no agency office. The rationale is honest: transforming into another character already breaks immersion, so wrapping that in diegetic ceremony buys nothing.

**Identity: anonymous.** Borrowed shifts do not accumulate. A player who drives the same night bus fifty times does not become known as the night bus driver — to anyone. The borrowing licence puts consequence on the NPC, not the player, and nothing carries forward.

**Consequence of those two choices, stated:** the night shift is a **utility system, not a second life.** Night posts are differentiated only by pay, duration, and the tiredness cap — there is no social or progression reason to prefer one. This is the safety net (the floor is always available and always pays) and it is not asked to be more than that.

---

#### M7 — The verb vocabulary

**Serves:** P4 (inhabitable time), P1 (talking costs minutes), and the physical-carrier law

M1 establishes that the discretionary middle is where the game lives. M7 is what the player actually **does** there — and on the commute, and in their own time. Without it, the most important claim in the design has nothing behind it.

**Presence verbs.** Sit. Order. Wait. Watch the water. Actions whose entire payload is *being somewhere*. Idleness is designed content, not the gap between content. A bench that can be sat on is a feature.

**Civic verbs.** Bin the bottle. Hold the door. Give up the seat. The commons as an interactive surface at the scale of a single object.

> **Binning the bottle is the player-side reversal of broken windows.** The litter loop is reversible not only through the sanitation chain but through any citizen who picks the bottle up. This is the physical-carrier law giving the player a hand in it: the consequence is a physical object, so the player can physically undo it. One person, one bottle, one street — reversible.

**Conversation as loitering.** Talking is done *instead of* transacting, chosen sentence by sentence, and it **costs minutes**. This is P1 applied to social interaction: a conversation is priced in the only currency that matters. There is no dialogue tree and no branching script — conversation is a way of spending time with someone, and what it buys is that you spent it.

**Dignity work.** The ramp, the ticket, the correct change. Jobs made of small competent courtesies to specific people rather than resource throughput. This is what stops the five playable jobs from reading as chores with sprites.

**The unnecessary, done well.** The most satisfying actions are the socially optional ones — the courtesy, the pause, the tidy-up. **The good move and the efficient move differ**, deliberately, and nothing rewards the good one. This is the reasoning underneath Self-Imposed Standards: cleaning the lobby is never required, tracked or rewarded, and it is worth doing anyway.

**Design rule:** gamey affordances exist only where the experience genuinely breaks without them. Abstraction is a cost paid reluctantly, never a default vocabulary.

**Two pairs of hands — the principle ships, the content does not.** Some procedures may physically require two people (the sofa, the fry station, the beam), so co-op emerges from simulation fidelity rather than from designed multiplayer content — the only kind of multiplayer content the design laws permit. Epic 8 builds procedures so this is possible; specific two-handed tasks beyond a token case are out of scope for v1.

---

#### M8 — Stock, goods and physical money

**Serves:** P4 (props carry state, and the machine is readable), P1 (money is stored time, and here it is also an object)

*Added 2026-08-29. The architecture found this absent from the original seven and load-bearing — it is the substrate the institutional layer consumes, so it precedes it.*

**Things exist in quantities, and move only when somebody moves them.** Goods are not spawned into a shop by a restock timer; they arrive because an order chain ran and somebody carried them. This is Design Law *consequence needs a physical carrier* applied to the economy itself, and it is what turns logistics from a background system into a job somebody holds.

**Physical cash is ordinary stock.** Denominations are items. A till holds a specific set of coins and notes, and a customer paying with a large note when the till holds three coins is an inventory failure the procedure branches on. **This is why "the till runs short of change" is not special-cased** — it falls out of stock being real. Card settles against the account with no cash movement; cash moves stock in both directions and can fail. The payment method acquires real texture for free.

**Why it earns its place against "systemic content only".** It removes special cases rather than adding systems: the café's beans depleting as citizens buy coffee, the supplier ordering across the city boundary, and the till running short are one mechanic seen three times, not three features.

**Cut test:** remove it and restocking becomes a timer, change-making becomes a scripted failure, and the sanitation and supply chains lose the physical carrier that makes them legible.


### Controls and Input

**Target:** browser, mouse and keyboard, no install, no plugin, no character creation ceremony. Boot to standing-in-the-city in under one second.

**Movement:** WASD / arrow keys, continuous, on an oblique tile grid.

**Interaction:** click a world object to act on it. Procedure steps are performed on objects in sequence, not selected from a menu — the interaction model for multi-step procedures (grind → dose → tamp → pull) is the single most important unresolved control question, because P4 lives or dies on whether procedure feels like handling or like clicking. See § Assumptions and Dependencies.

**No HUD.** Design Law: progression is carried diegetically. No net-worth display, no balance, no counters, no minimap-with-objectives. The world holds the evidence.

## Simulation & Persistence Specific Design

### Core Simulation Systems

**What is being simulated:** a contemporary city district — its people, their work, their money, their movement, and the institutions that connect them. Not a city-builder's abstractions (zones, demand curves) but the people themselves, each with a home, a job, a schedule and ends of their own.

**Simulation depth: variable by attention, uniform in kind.** One simulation runs at different timesteps and levels of detail — never a separate "background approximation" alongside a "real" foreground. Full procedure runs where players are; statistical resolution runs elsewhere; the two reconcile on approach. This is what structurally prevents drift between simulated and faked regions.

**The city always ticks.** Simulation is continuous and authoritative everywhere, whether or not anyone is connected. Rendering instantiates bodies on demand from computed truth. Spinning the server down when empty was considered and rejected: it breaks causality, and causality is the product.

**The Truth Test.** Would this event have happened identically if no player had ever come? Nothing is authored into being by proximity. Every state survives inspection back to a cause.

**Resolution scales; causality does not.** Distant simulation is cheaper, never falser. Cheap is not fake.

**Population target — settled 2026-08-29.** The citizen count was deferred to `gds-game-architecture` as a cost question as much as a design one. It has since been settled by the Scale Baseline, measured against the tileset: **a 512x512 map (~435 m square) carrying ~5,000 citizens** at a density of one per 52.4 cells — roughly Paris-to-Manhattan — across ~894 buildings and ~344 workplaces, costing ~$25/mo at ~42 L2 transactions per second with no overage. The 100+ enterable-interiors target is ~11% of building stock and is therefore never the binding constraint. Full derivation lives in `../../epics/index.md`.

The design constraints below are what that number had to satisfy. They remain the standing test for any future change to scale:

| Constraint | Requirement |
|---|---|
| Local density | A busy street at rush hour must read as busy; a residential street at 3am must read as quiet. Aliveness is measured per screen, not per database. |
| Sparse periphery | District edges read as character, not as budget. Emptiness must look intentional. |
| Labour-market depth | Enough distinct professions (most AI-held) that wage self-balancing has something to balance. *Target was ~100; the Scale Baseline settles v1 at ~69 professions at 5+ employers each, growing toward ~100 as the city extends (see A2).* |
| Recognisability | Individual agents must be encounterable often enough to become familiar — the barista who greets you requires that you keep meeting the same barista. |
| AI carries density | At low concurrency, AI citizens carry the entire feeling of aliveness. Player count must never be the source of the city feeling populated. |

### Institutional Chains

A city event — an accident, congestion, a complaint, a change in footfall — triggers a multi-agent institutional process. Each link is an occupation with its own work loop, held by an AI citizen or (in later job tiers) a player.

```
investigation → approval → budget → procurement → logistics → labour
```

**Friction is the narrative.** Chains stall, get denied, get expedited. Consequences land on citizens who never saw the paperwork. There is no authored story; institutional latency *is* the story.

**Response time is a budget line.** How fast the ambulance arrives depends on a decision made in a building the player has never entered.

**Municipal memory.** The city observes and alters itself, readable like weather.

> *Adjudicated 2026-08-29.* The readiness assessment found this to be the only assertion in this GDD with no counterpart in the epics — no requirement, story or acceptance criterion mentions it. **It is a summary of mechanisms that already exist, not a distinct system, and it needs no epic of its own.** The city observes itself through complaint filing with a probability floor so habituation cannot starve the signal (FR80), through workers escalating an out-of-range condition they notice (FR71), and through matters arriving by four fluxes each with a person and a physical carrier (FR70). It alters itself through the chains those matters open (FR81). It is readable because consequence has a physical carrier and is met on the commute rather than in a feed. "Like weather" is the register, not a mechanism: no city-wide mood, index or memory object exists or should be built.

**The reference chain — the plastic-bottle loop.** The vertical slice that exercises institutions, emergence, jobs and physical consequence on a single street:

```
sanitation budget shortfall
  → a bin goes unemptied
    → a dropped bottle (litter licenses litter)
      → the street degrades
        → complaints are filed
          → a budget chain opens
            → staffed by people players can be
```

**Second chain — development.** Introduced by the growth mechanism (see § Emergence Boundaries): population pressure → survey → approval → budget → procurement → construction → a new neighbourhood. This chain is the natural home for the decision-link job the v1 roster currently lacks.

**v1 status:** chains run AI-staffed end to end. Players experience them from the receiving end and read their outputs on the commute.

### Management & Decision Mechanics

Largely **not applicable** in the conventional simulation sense: the player is a citizen, not a manager. There is no god-view, no zoning tool, no budget spreadsheet, no direct control of any system.

Two mechanics occupy the space the genre normally fills:

- **Delegation is the understudy.** The only thing the player delegates is their own life, and only by leaving. The understudy's mandate is fixed and conservative — it is not configurable, because a configurable understudy would become an optimisation surface and turn absence into a strategy.
- **Decision-making is positional.** Later job tiers put players on institutional links where their choices propagate — an approval granted or delayed, a procurement order placed. This is management, but experienced from inside a chair rather than above a map.

### Economic and Resource Loops

**The single scarce resource is time.** Money is stored time and nothing else. No system may introduce a resource that competes with time as the scarce thing.

**Income:** wages from shift work (10 / in-city hour at entry level), plus borrowed night shifts. The AI understudy earns the same wage the player would — never more.

**Expenses:** rent (250/week at the starting edge flat, 45% of gross), food and necessities (~90/week), transport (transit pass 20/week if held), and the costs of lateral pursuits.

**Market dynamics:**

- **Labour market saturation** — popular jobs depress wages; unpopular roles pay better. Self-balancing with no designer intervention.
- **Housing market** — desirability tracks physical state and demand; rent follows. See § Emergence Boundaries for how this is kept survivable.

**Economic balance:** the weekly surplus of ~220 against a bike at 450 sets the first meaningful savings goal at roughly two weeks of surplus. The exchange rate between money and minutes is fixed deliberately so that one-time purchases are efficient and recurring costs are not (see M3).

### Persistence, Concurrency & Reciprocal Occupancy

**Authoritative simulation, thin client.** The world lives server-side; the browser renders and takes input. This serves the one-second boot, the multiplayer, and anti-cheat simultaneously.

**Reciprocal occupancy** is the mechanism that makes a persistent world safe to leave:

| Player state | What holds their life | What they do |
|---|---|---|
| Connected, awake | The player | Lives the day loop |
| Connected, past bedtime | The player, in a borrowed body | Works an anonymous night shift |
| Disconnected | The AI understudy | Works, pays rent, eats, sleeps, banks the surplus |
| Any unheld institutional role | AI backfill | The post is always covered |

**No system may punish logging off.** Absence costs nothing. Services degrade only when someone *chooses* it — never because the server was quiet. Decay always has an author.

**Kinematic continuity.** The player returns exactly where cause and elapsed time put them. Reconnection has no seam because nothing was suspended.

**Separate the ledger from the body.** Chains simulate to the floor as *records*; bodies instantiate only where observed. This applies to absent players too: an absent character reconciles as a record and settles on return, delivered physically as the pile of post on the doormat.

**Player/AI indistinguishability.** There is no mechanical seam between a role held by a player and the same role held by an AI citizen. This is what lets the city be fully staffed at any concurrency.

### Emergence Boundaries

**The law:** *every bounded quantity tends toward an equilibrium state that the non-player simulation actively tries to reach.*

This is a mandate, not a prohibition. Equilibrium-seeking is what the AI layer is **for** — the simulation is not merely permitted to drift within bounds, it is working to restore them. Any proposed system that lets a quantity drift with nothing pursuing its equilibrium is incomplete and does not ship.

The law matters more here than in most simulations because **BrowserCity has removed every reset mechanism its comparables rely on.** Space Station 13 has the round reset; Eco and Ultima Online have server wipes — both deliberately rejected. The city never resets and ticks continuously for years, so an undamped ratchet is permanent.

**Audit of expected emergent behaviours:**

| Emergent behaviour | Equilibrium-seeking force | Status |
|---|---|---|
| Broken windows — litter licenses litter | The sanitation chain works to clear it | ✓ bounded, reversible |
| Labour market saturation | Unpopular roles pay better; wages seek clearing | ✓ self-balancing |
| Institutional decay from churn | Prevented outright — AI backfills every unheld role | ✓ prevented |
| Rush hour from schedules | Cyclical by construction | ✓ bounded |
| Understudy drift | Bounded by the conservative mandate | ✓ bounded |
| **Local gentrification** | **Deliberately undamped — see below** | ✓ **desired** |
| Geographic social graph — friendships form along commutes | Not a built system; falls out of schedules, routes and agents remembering individuals | ✓ expected |

**Gentrification is a feature, and the growth mechanism is its answer.**

Local gentrification is *wanted*: physical state → desirability → rent → demographics → physical state is a real loop, and rising desirability makes players congregate, which is the social outcome the design is after. The failure it threatens is not the drift itself but the **entry point** — if the whole map gentrifies, a new player has nowhere affordable to begin, and the opening fantasy (materially poor but survivable) stops being true.

So the ratchet is not damped. **Supply is added instead: the city grows as the active player population grows.** There is always somewhere to begin.

**This passes the Truth Test.** Growth keyed to active player count reads at first like the city special-casing itself around players — a #61 violation. It is not. Players *are* citizens. More players is more population; more population is housing pressure; housing pressure is development. The causal chain is genuinely real and the city responds to it exactly as a city does. No exception is carved out and no fiction is papered over.

**Consequences:**

- Growth is delivered by a **development chain** (survey → approval → budget → procurement → construction), which is content, and which is the natural home for a player-holdable decision-link role.
- New building is physically visible: construction sites, hoardings, converted buildings. The player watches the city grow rather than finding a new area already there.
- In v1, growth means **new neighbourhoods adjacent to district one**, not new districts. Districts beyond the first remain out of scope.

**The geographic social graph.** You know the people whose routes cross yours. This is not designed, built or tracked — it emerges because citizens have schedules, routes exist, and agents remember individual people. It gives the commute a third job alongside the minute-tax and reading the city's state.

**Wait-and-see:** emergent norms — queueing, tipping, a usual table, a standing Sunday ride. Culture as content nobody writes. Only observable with real players, and deliberately unengineered.

### End-State Definition

**There is no end state.** BrowserCity is open-ended by construction: no win, no loss, no death, no level cap, no server wipe, no round reset.

**What replaces an end state** is two non-terminating axes, neither of them a ladder with a top:

- **Being needed** — occupying links in the institutional machine until others route through you. This axis has no ceiling because the machine grows with the city.
- **Lateral pursuit** — the many small lives the city offers, chosen rather than assigned: a hobby, a golf tournament, a plushy collection, getting decent at cooking, the wooded north. Renews without needing more map, which is what makes it compatible with a one-district launch.

**Money is deliberately not one of these axes.** The wealth ladder does not terminate, but it is never the only game, it has no display, and a player optimising for it is optimising something the design neither rewards nor shows.

**Content runway.** With no authored content, the runway is the systems themselves: a growing city, a labour market that shifts, institutions that can be entered from new positions, and other players. The design's honest position is that if the systems do not sustain a five-hundred-hour player, no amount of authored content would have.

## Progression and Balance

### Player Progression

There is no experience bar, no level, no skill tree and no net-worth display. Progression runs on two non-terminating axes, and both are carried diegetically — the world holds the evidence.

#### Axis 1 — Being needed (institutional position)

Climbing into the machine is gated **twice**: by qualification and by vacancy.

| Gate | What it is | Cost | Carrier |
|---|---|---|---|
| **Qualification** | A licence, certificate or course for the role | **Minutes** — evening classes taken out of own-time | The certificate on the wall, the licence in the wallet |
| **Vacancy** | An actual open post in an actual institution | Timing, and an application | Your name on a roster, a set of keys |

**Advancement is bought with time, not with skill points.** This is P1 applied to careers: the player's ~15 real minutes of daily own-time are contested between becoming someone the city needs and having a life. That contest is the central choice of the game, and it recurs every day rather than being made once in a menu.

**The wall risk and its mitigation.** Two gates means a qualified player can be blocked on timing. Three things prevent this reading as a wall: qualification is always available to work on, so there is never nothing to do; the night shift and lateral pursuits fill the interval; and **city growth opens new posts as the player population rises** — vacancy pressure eases exactly when player pressure increases.

#### Axis 2 — Lateral pursuit

The city offers many small lives; the player picks which are theirs. Progress is sideways and personal, never heroic. **v1 ships three pursuits, deep rather than many:**

| Pursuit | Activity | Diegetic carrier | Economic interaction |
|---|---|---|---|
| **Cooking** | Buy ingredients, learn dishes by doing, build a kitchen worth cooking in | The right pan; food that comes out well | Cheaper than eating out — indirectly buys minutes back |
| **Collecting** | Acquire and display (plushies the reference case) | The shelf *is* the progress bar | Gives money a use that is not minutes |
| **A sport or club** | A scheduled, recurring, social commitment — the golf tournament | A trophy, a scorecard, a standing fixture | Membership fees; a real time cost at a fixed hour |

**Places is deliberately not a v1 pursuit.** It was the only candidate with no physical carrier, and the addendum carried a narrow stated exception to Design Law "consequence needs a physical carrier" to accommodate it. With places dropped, **that exception is retired and the law stands unqualified.**

#### What "being needed" actually means, mechanically

**Dependency is carried by decisions, not by presence.** The player's absence changes nothing — an AI holds the post exactly as well as the player would, because P2 forbids any mechanical seam between a player-held role and an AI-held one. What persists is the *choices made while present*: the budget approved, the route scheduled, the application expedited or left in the tray. The player is load-bearing through consequence, not through attendance.

**Accepted trade, stated:** this fully protects P3 (absence is safe and costs nothing) and the cozy promise is unqualified — but it means nobody is literally waiting on *you*. The felt fantasy of being missed is weaker than the alternative of a degraded AI backfill, which was considered and rejected because it would have made players and AI mechanically distinguishable and broken P2.

### Difficulty Curve

**The curve is inverted, deliberately: BrowserCity is hardest at hour one.**

| Phase | Pressure | What the player is doing |
|---|---|---|
| **Opening** (first weeks) | Highest. Rent is 45% of gross; 60-min commute each way; 6h own-time/day | Surviving the arithmetic. Saving for the bike. |
| **Middle** | Easing. Bike bought (+17% own-time), transit pass, surplus accumulating | Choosing: qualification, or a life. Both cost the same minutes. |
| **Late** | Self-imposed | Lifestyle is chosen, not forced. Better flat, club fees, a kitchen. |

This is not a flaw to be corrected. The game is hardest when the player knows least, and becomes **wider rather than harder** — the late game is a game about choice, not survival.

**Pressure does not evaporate, it becomes self-imposed.** Surplus does not grow unboundedly, because a life costs money: a closer flat is +130/week, club membership recurs, a kitchen worth cooking in is an investment. A player could always live cheaply and bank the difference. They choose not to. This is Self-Imposed Standards (the lobby nobody asked you to clean) operating at the scale of a whole life.

**No system may add late-game pressure to "keep the game interesting."** If the late game is not interesting, the problem is the breadth of choice, not the absence of threat.

### Economy and Resources

See § Game Mechanics M2 and M3 for the full rate table. Summary:

| | Value |
|---|---|
| Entry wage | 10 / in-city hour → 80 / day → **560 / week gross** |
| Rent (edge flat) | 250 / week — **45% of gross** |
| Food and necessities | ~90 / week |
| **Weekly surplus** | **~220** |
| First savings goal (bike) | 450 — **~2 weeks of surplus**, payback in 6.4 weeks |

**Balance rules that must hold:**

1. Time is the only scarce resource. No system introduces a competing scarcity.
2. One-time purchases buy minutes efficiently; recurring costs do not. This forces housing's value to be proximity-to-a-life rather than proximity-to-work.
3. The understudy earns the same wage the player would — never more, never less.
4. Qualification costs minutes, never money alone. A rich player cannot buy a career.
5. Wages self-balance: popular roles depress wages, unpopular roles pay better, with no designer intervention.

## Level Design Framework

### The city is generated, not authored

**Everything is procedurally generated from a city seed** — street layout, plot subdivision, building exteriors, and interiors. Nothing is hand-placed. This follows directly from the design law *systemic content only*: a solo developer cannot author a city, but can grow one.

**Consequence, stated plainly: the generator's rules are the entire content pipeline.** There is no fallback of hand-authoring a good street if the rules produce a bad one. This makes the tile-semantics and authoring-rules work (Epic 2) load-bearing rather than plumbing, and it is the project's single largest content risk.

**Determinism:** the same seed produces the same city. The city is not re-rolled; it is generated once and then lived in.

### Level types

BrowserCity has no levels. It has one continuous district, composed of:

| Type | Character | Generated from |
|---|---|---|
| **Streets** | The player's primary sensor on the city's state — where emergence is read | Street layout + plot rules |
| **Interiors** | 100+ enterable, from flats to shops to institutional back rooms | Room grammar + building type |
| **Workplaces** | Interiors with a procedure attached and props that carry state | Building type + job definition |
| **Institutions** | Depot, council, hospital, welfare office, shelters, shops, cafés | Placement constraints on generated types |
| **The periphery** | Deliberately quiet. Sparse edges read as character, not as budget | Density falloff |

### Neighbourhood character

The brief requires "multiple neighbourhoods with distinct character." With nothing hand-placed, that character must come from **generator parameters** rather than from the designer's hand:

- **Density** — how tightly plots are packed
- **Building age** — which affects physical state, and therefore desirability, and therefore rent
- **Affluence** — which affects shop types, interior quality, and who lives there
- **Land-use mix** — residential, commercial, industrial, institutional

These parameters are also what makes the gentrification loop legible: physical state → desirability → rent → demographics → physical state runs on quantities the generator already understands.

### Level progression

There is none. The player does not advance through spaces; they inhabit one and it grows around them. **The city extends** (Epic 14) as the active player population rises: new neighbourhoods are generated adjacent to district one, built visibly by the development chain, so that there is always somewhere affordable to begin.

### Density is local

Aliveness is measured **per screen, not per database**. A busy street at rush hour must read as busy; a residential street at 3am must read as quiet. This is what makes a city affordable to a solo developer: the LimeZu asset library supports high local density cheaply, and the periphery costs nothing because it is supposed to be empty.

---

## Art and Audio Direction

### Art Style

**Fixed by the assets already in hand.** LimeZu **Modern Exteriors** and **Modern Interiors** — 16×16 pixel art, oblique perspective with a front-facing bias in the manner of Stardew Valley. Pre-split, including buildings, interiors and a large prop library. Character spritesheets are unsplit and represent known work.

**The constraint is a gift.** A large, coherent, pre-existing prop and tile library is what makes local density affordable — which is precisely what makes a city feel alive per screen rather than per database. The art direction is not a preference; it is the reason the scope is possible.

**World:** a contemporary city, unnamed and unremarkable. No fantasy, no near-future, no apocalypse. Its texture comes from institutions and weather, not from lore.

**No HUD.** Progression is carried diegetically — plushies on a shelf, a trophy, a certificate on the wall, a keyring, a roster with your name on it, a barista who greets you, a pile of post on the doormat. No net-worth display, no balance, no counters, no objective markers.

### Audio and Music

**The city is the soundtrack.** Traffic, rain, a distant tram, room tone that changes when you step indoors. Ambience does the work that a score would do elsewhere, and it carries the same job the art does: making the place feel like somewhere with its own business.

**Music is rare and diegetic** — a radio, a busker. **There is no composed score.**

Audio is also a legibility channel: the tram you hear but do not see is evidence the city is running.

---

## Technical Specifications

GDD-level targets only. Engine selection, system architecture, netcode model and data design belong to `gds-game-architecture`.

### Performance Requirements

| Target | Measurement |
|---|---|
| **Boot to standing-in-the-city: under 1 second** | Cold load in a browser tab on a mid-range laptop over a typical domestic connection, measured from navigation to player-controllable. Includes load. No character creation ceremony. |
| **Sustained 60 FPS** | On a mid-range laptop at 1080p, measured over a 10-minute session including a busy street at rush hour and an interior transition. |
| **Server tick: continuous** | The city simulates whether or not any client is connected. Spinning down when empty is rejected — it breaks causality. |
| **Reconnection: no seam** | The player returns exactly where cause and elapsed time put them. Nothing is suspended, so nothing needs resuming. |

**The one-second boot is the hardest technical constraint in the project.** It is the constraint that enforces the design thesis — a place you drop into rather than a session you commit to — and the brief records honestly that it has not yet been designed against.

### Platform-Specific Details

- **Browser, exclusively and non-negotiably.** No install, no plugin, no download gate.
- **Authoritative simulation server-side; thin client.** The world lives on the server; the browser renders and takes input. This serves the boot target, the multiplayer, and anti-cheat simultaneously.
- **Mouse and keyboard.** No controller or touch support in v1.
- **Always-on server** with a meaningful but bounded monthly spend, self-funded, expected to run for years before anyone plays.

### Asset Requirements

| Asset class | Status | Notes |
|---|---|---|
| Exterior tiles | **In hand** — LimeZu Modern Exteriors, pre-split | |
| Interior tiles and props | **In hand** — LimeZu Modern Interiors, pre-split | Large prop library; the basis for local density |
| Character spritesheets | **In hand, unsplit** | Splitting is known work, scheduled in Epic 1 |
| Tile semantic metadata | **To be authored** | Epic 2. The rules that let agents place tiles correctly — the project's real content pipeline |
| Ambient audio | **To be sourced** | Traffic, rain, tram, room tone, interior/exterior transitions |
| Music | **Minimal** | Rare and diegetic only; no composed score |

**Systems must be uniform, data-driven and heavily testable** so that agents can extend and validate them. This is a design-level requirement, not an implementation preference: it is the constraint that makes a city buildable by one person.

---

## Development Epics

**Fifteen epics — Epic 0 plus fourteen.** The full breakdown (goal, scope, exclusions, dependencies, playable deliverable, stories and acceptance criteria) lives in `../../epics/`, one file per epic, which is **authoritative for epic structure, numbering and sequence**. Its `index.md` also carries the numbered requirements inventory (FR1–FR172, NFR1–NFR46) derived from this GDD and from the architecture; this GDD deliberately does not duplicate it.

**This table was restructured on 2026-08-29** after the architecture document completed. The design intent of every epic below is unchanged from this GDD's original E1–E13; what changed is grouping, ordering and numbering. The three reasons, recorded by the epics document:

1. **Citizens move before the day loop.** The architecture found that the shop till requires customers, so the first job epic already depended on NPC capability. Building a stubbed customer to preserve the old order would repeat the mistake this GDD itself declined when it rejected a pre-foundation Burger Test spike — a spike's answer might not transfer.
2. **Stock, Goods and Money is a new epic.** The architecture found it absent from this GDD's breakdown and load-bearing. It is L1's substrate, it makes "the till runs short of change" fall out rather than be special-cased, and it turns logistics into a job.
3. **Foundation epics are consolidated.** The original E1–E4 all churn the same files, so they are now organised by the boundary they own rather than the layer they sit in, with the three gating spikes pulled into Epic 1.

| # | Epic | Was | Playable deliverable |
|---|---|---|---|
| 0 | The Development Team | *new* | Dispatch work to agents with tracking, a review gate and CI. Builds no game |
| 1 | Foundations and Gating Spikes | E1 | Walk an avatar down a hand-laid test street in a browser, with the three overturning measurements already taken |
| 2 | The Content Pipeline | E2 | A block validates against the rules; a broken one is rejected with a named violation |
| 3 | The Generated City | E3 | Walk a generated 512×512 district with neighbourhoods that read as different |
| 4 | The Living Wire | E4 | Two browsers standing in the same city, in under a second |
| 5 | **Citizens** | E8 | A city that feels populated with one player connected — **the AI-density answer** |
| 6 | Stock, Goods and Money | *new* | Beans deplete, an order chain refills them, a till runs short of change |
| 7 | **The Day Loop** | E5 | Wake, commute, work a shop-till shift, get paid, have rent taken — **first read on the Burger Test** |
| 8 | **Procedure and Props** | E6 | Two jobs performable well or badly, nothing scoring you — **the hard Burger Test: the empty post** |
| 9 | Reciprocal Occupancy | E7 | Log off for a day, return, read your post, find your life intact and richer |
| 10 | Institutions and the Reference Slice | E9 | The plastic-bottle loop end to end, read on your commute |
| 11 | Transit and the Full Roster | E10 | The MVP: five playable jobs, real transit, 100+ interiors, institutions running |
| 12 | A Life | E11 | Three genuinely different things to spend spare minutes on, and a shelf that shows it |
| 13 | Careers | E12 | Qualify in the evenings, wait for a post, take it, make decisions that outlast you |
| 14 | Growth | E13 | Watch a new neighbourhood get built, caused by population pressure you are part of |

**Sequence:**

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
    └─── foundation ───┘  └density┘   └ Burger Test ┘  └── content & depth ──┘
```

**Two falsification points.** Epics 7 and 8 together answer whether mundane work is intrinsically satisfying without SS13's round timer and antagonists — Epic 7 with a customer-facing job, Epic 8 with the unsupervised empty post, which is the hard case. Everything after Epic 8 assumes yes. Epic 5 answers whether AI citizens can carry the feeling of aliveness at low concurrency, which the addendum names as the real engineering risk.

> **Recorded decision — the Burger Test runs later, and that is accepted.** In this GDD's original sequence the first falsification point was epic 5 of 13. Under the restructure it is epic 7 of 15, behind Citizens and Stock/Goods/Money, so the design's most critical unfalsified assumption (A8) sits behind roughly two additional epics of work. The epics document raised this as the single largest cost of the restructure. **Decided 2026-08-29: accepted — the epic breakdown stands as written.** The reasoning that carries it is the same one this GDD used to reject a pre-foundation Burger Test spike: the shop till requires customers, so the first job epic always depended on NPC capability, and an answer obtained against a stubbed customer might not transfer. A later test whose result is trustworthy beats an earlier one that is not.

**Multiplayer is not an epic.** Authoritative simulation means the server runs the city with zero clients; a second connected player is close to incrementally free. Netcode is Epic 4's architecture. Building single-player first would mean retrofitting it — the more expensive path.

---

## Success Metrics

This is a passion project with no commercial target, no deadline and no audience yet. Metrics exist to tell the developer whether the design is working, not to satisfy a stakeholder. They are deliberately few.

### Technical Metrics

| Metric | Target |
|---|---|
| Cold boot to player-controllable | **< 1 second**, mid-range laptop, domestic connection |
| Sustained frame rate | **60 FPS** at 1080p over a 10-minute session including rush hour |
| Server uptime | Continuous; the city never stops ticking |
| Monthly server spend | Within the self-funded bounded budget (figure set at architecture) |
| Reconnection seam | Zero — position and state consistent with elapsed time, every time |

### Gameplay Metrics

Each connects to a pillar. Adjectives are not metrics.

| Metric | What it tests | Pillar |
|---|---|---|
| **Voluntary time in the discretionary middle** — do players stay in an unsupervised shift when nothing requires them to? | The Burger Test. If players skip or idle through the middle, P4 has failed and the design's foundation is wrong | P4 |
| **Perceived aliveness at 1 connected player** — does a solo player describe the city as populated? | Whether AI carries density, the project's named engineering risk | P2 |
| **Return rate after absence** — do players who log off for a week come back? | Whether "absence is safe" reads as safe, or as abandonment | P3 |
| **Minute-spend split** — how own-time divides between qualification and lateral pursuit | Whether the central choice is a real contest or a foregone conclusion. A heavy skew either way means one side is underpriced | P1 |
| **Unprompted noticing** — do players mention city state (a full bin, a late tram) without being asked? | Whether emergence is legible or merely present. The addendum flags this as the thing the Truth Test cannot measure | P4, P2 |

**The honest position:** the last metric is the one that matters most and is the hardest to instrument. Players do not get satisfaction from a system being genuinely simulated; they get it from *noticing* something. If nobody notices, the fidelity was money burned regardless of how true it is.

---

## Out of Scope

### Cut from v1.0

| Cut | Note |
|---|---|
| **Player criminality** | Players stay lawful. Crime exists in the world; players engage the response side — police, detectives, insurance, repair, courts. Revisited with real player data |
| **Districts beyond the first** | Growth in v1 means new neighbourhoods adjacent to district one, not new districts |
| **Player-owned businesses and infrastructure** | Public office and private ownership are one mechanic under two labels, and belong to a later job tier |
| **Player-holdable institutional chain links** | Accepted gap. Chains run AI-staffed end to end in v1; players observe rather than staff them. See § Assumptions and Dependencies |
| **Places as a lateral pursuit** | Deliberately dropped — the only pursuit with no physical carrier. Dropping it retires the stated exception to the physical-carrier law |
| **Two-handed co-op tasks** | The *principle* ships — procedures may require two people, and Epic 8 builds for it — but specific two-handed tasks beyond a token case are deferred |
| **Controller and touch support** | Mouse and keyboard only |
| **Composed musical score** | Music is rare and diegetic; the city is the soundtrack |
| **Character creation ceremony** | Boot straight into the city. The one-second target forbids it |

### Never in scope — these are design positions, not deferrals

- **Hand-authored quests, dialogue trees or set pieces.** Systemic content only.
- **Morality meters, reputation auras, approval scores, destiny.** The city has no opinion of the player.
- **A HUD with net worth, balances, counters or objective markers.** Progression is carried diegetically.
- **Death.** Injury costs days and savings; nothing is permanent.
- **Server wipes or round resets.** The city ran before the player and continues after.
- **A configurable understudy.** It would become an optimisation surface and turn absence into a strategy.
- **Late-game pressure added to keep the game interesting.** If the late game is dull, the problem is breadth of choice, not absence of threat.

---

## Assumptions and Dependencies

### Open items

| # | Item | Impact | Disposition |
|---|---|---|---|
| **A1** | **[NOTE FOR DESIGNER]** The multi-step procedure interaction model — how grind → dose → tamp → pull is actually performed | **High.** P4 lives or dies on whether procedure feels like *handling* or like *clicking*. Not resolvable on paper | Resolved by prototyping in **Epic 8** |
| **A2** | **[ASSUMPTION]** District one's citizen count, and its monthly server cost | **High.** The brief calls this "the number that constrains everything else". Requires engine choice and per-agent budget | **Answered 2026-08-29.** The Scale Baseline settles it: a 512x512 map (~435 m square) carries **~5,000 citizens**, ~894 buildings, ~344 workplaces and **~69 professions** at 5+ employers each, for ~42 L2 transactions/sec and **~$25/mo** with no overage. Note the profession target is therefore **~65-70 for v1, not the ~100 stated above**, growing toward it as the city extends |
| **A3** | **Known gap (accepted):** no v1 job is a decision link in an institutional chain | **Medium.** P2 says the machine is staffed and the endgame is occupying links others route through — at launch, players can observe chains but not staff one, so the pillar's most distinctive half ships unplayable | Accepted for v1. Mitigated by job access tiers being a tuning dial: a chain role is an addition, not a rebuild. First candidate is the council permits clerk or a development-chain role, in **Epic 13**. **Update 2026-08-29:** the architecture found this gap far cheaper to close than assumed — a decider is a citizen whose work-time option set is matters rather than procedure steps, so a player-holdable decision link is an addition, not a rebuild. Epic 13 now closes A3 rather than merely being its first candidate |
| **A4** | **[ASSUMPTION]** The one-second boot is achievable against MMO asset streaming | **High.** The hardest technical constraint in the project, and the brief records that it has not been designed against | Architecture supplies a boot design, but it is **arithmetic rather than evidence**. Benchmark **B3 (boot budget, measured)** is scheduled as a gating spike in Epic 1, before anything depends on it. Still open until B3 reports |
| **A5** | **Known risk:** the generator's rules are the entire content pipeline | **High.** Nothing is hand-authored, so there is no fallback if the rules produce a bad street. Single largest content risk | Mitigated by making tile semantics a first-class epic (**Epic 2**) with a validation harness |
| **A6** | **Recorded tension:** because the understudy banks surplus while a present player spends, absence is technically the money-optimal play | **Low.** Money is explicitly the least-valued axis and has no display, so a player optimising it is optimising something the design neither rewards nor shows | Accepted. Re-examine if players report feeling punished for playing |
| **A7** | **Accepted trade:** dependency is carried by decisions, not presence — so nobody is literally waiting on *you* | **Medium.** Weakens the felt "being needed" fantasy | Accepted deliberately. The alternative (a degraded AI backfill) would make players and AI mechanically distinguishable and break P2 |
| **A8** | **[ASSUMPTION]** The Burger Test holds without SS13's round timer and antagonists | **Critical.** Everything after Epic 7 assumes yes | Answered by **Epic 7**. A pre-foundation throwaway spike was considered and declined — the foundation is needed regardless and a spike's answer might not transfer |
| **A9** | **[ASSUMPTION]** AI citizens can carry the entire feeling of aliveness at low concurrency | **Critical.** The addendum names this as harder than multiplayer | Answered by **Epic 5** |
| **A10** | **Untested:** the borrowing licence as an anti-griefing measure | **Medium.** Consequence for a borrowed body lands on the NPC, not the player | Observable only with real players. Revisit post-launch |
| **A11** | **[ESCALATED TO DESIGN 2026-08-28]** Social continuity across long absence. At 24 in-city days per real day, a fortnight offline is roughly an **in-city year** | **Medium-High.** Money and rent scale fine and the understudy holds the role, but **recognisability and the geographic social graph are the exposed surface** — both assume the player keeps meeting the same people. An in-city year of uniform churn would empty the player's social world while they were away, which is a P3 failure (absence must be safe) reached by a route P3 did not anticipate | Architecture escalated this to the GDD and it is accepted as a design position: **established citizens are sticky rather than churning uniformly**, which is also more accurate than uniform churn rather than a concession to the player. Built in the Citizens epic |

### Dependencies

- **Art assets are in hand** (LimeZu Modern Exteriors and Modern Interiors, pre-split). Character spritesheets are unsplit; splitting is known work scheduled in Epic 1.
- **Always-on server budget** — self-funded, bounded, expected to run for years before anyone plays. This is a standing commitment, not a launch cost.
- **Agentic development capacity** — the scope assumes systems uniform, data-driven and heavily testable enough that agents can extend and validate them. This is not an optimisation; it is what makes the scope possible for one person.
- **`gds-game-architecture`** is the next workflow. It owns engine selection, the simulation architecture, the netcode model, and the two deferred numbers (A2, A4).

### Scope, honestly

The brief's headline risk stands and is repeated here so it is not lost: a persistent multiplayer district of 100+ interiors with five procedurally simulated jobs, built by one person on evenings and weekends, is a multi-year commitment with a monthly bill running throughout. This was raised twice during briefing and affirmed deliberately.

Two mitigations exist and should be used. **The reference slice (Epic 10) is a genuine vertical slice** that exercises institutions, emergence, jobs and physical consequence on a single street. And **job access tiers make the job count a dial rather than a commitment** — this is the project's primary scope valve and should be used deliberately.
