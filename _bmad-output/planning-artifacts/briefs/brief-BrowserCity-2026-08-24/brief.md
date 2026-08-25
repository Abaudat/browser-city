---
title: "Game Brief: BrowserCity"
status: draft
created: 2026-08-24
updated: 2026-08-25
---

# Game Brief: BrowserCity

## Executive Summary

BrowserCity is a persistent, browser-based life simulation set in a city that was running before you arrived and will keep running after you close the tab. You are not its hero. You are a person in it — with rent due, a job to get to, and a day's worth of minutes to spend. The city has institutions, and those institutions are staffed by people. Some of them are players.

Its premise is significance without centrality. You begin materially poor and end up load-bearing: not the mayor, but the person who approves the budget line, drives the route, or holds the keys others wait on. The endgame deepens the opening fantasy rather than inverting it. At hour 100 you are still one part of a massive thing — just a part it would notice losing.

What makes it work is a single economy: **time**. Every in-city day is one to two real hours. Work converts minutes into money, money buys minutes back — a bike, a closer flat, a transit pass — and rent takes its bite whether you earned or not. What is left over is the only thing that is genuinely yours, and you spend it on a life: a hobby, a collection, a community, a place. Nothing here will ruin you. Nothing here will praise you either.

## Vision

**Core fantasy, in one sentence:** *You live an ordinary life in a city that does not need you — and slowly become someone it depends on.*

**Elevator pitch:** A browser MMO where you are a citizen, not a chosen one. The city genuinely simulates itself — its bureaucracies, its work, its traffic — and every link in that machine is a job somebody holds. You get one life, priced in minutes, and no opinion from the game about how you spend it.

**The feeling players walk away with:** the quiet satisfaction of being *somewhere* — a place with its own business that let you in and gave you a spot in it. Not mastery. Belonging without importance.

Two related fantasies are supporting texture, deliberately not the spine: *the breathing machine* (the pleasure of watching the city think) and *possibility vertigo* (the awe of discovering that scenery is enterable). Both are welcome; neither gets to decide what we cut.

## Target Players & Market

**Primary audience: cozy-persistent players.** The Animal Crossing and Habbo Hotel lineage — people who want a place to be rather than a game to beat. They log in for thirty minutes to check on something, they value routine and texture over challenge, and they play in a browser tab alongside other things.

**The tension we are designing against, stated plainly:** our comparables (Kenshi, Project Zomboid, Space Station 13, Eco) are harsh, opaque, systems-first games for a very different crowd. Our stance resolves it: **cozy in consequence, harsh in arithmetic.** The maths is real. Minutes are genuinely scarce and the bike genuinely matters. But nothing bad is ever irreversible: falling behind starts a slow, visible, interruptible process with a floor beneath it. Pressure is legible; it is never sharp.

**Secondary audience:** systems-first sandbox players who will tolerate early roughness for a world that is honestly simulated.

**Market context:** this is a passion project, not a commercial bid. The relevant opportunity is a gap rather than a market — the cozy-persistent space is almost entirely single-player or socially shallow, and the deep-simulation space is almost entirely hostile to newcomers. Nobody is serving people who want both.

## Core Fundamentals

**Genre:** persistent multiplayer life-and-city simulation. Oblique-perspective pixel art, browser-native.

**Core loop — the day's time budget:**

> Wake in a flat you can barely afford → commute, which costs minutes → work a shift (ritual open, rhythmic duties, a discretionary middle where nobody is watching, ritual close) → get paid → spend what remains: buy minutes back, or spend them on a life → rent falls due, again.

The day ends one of two ways. Leave, and your character sleeps while an AI understudy keeps your life running — conservatively, never gambling with it. Stay past your character's bedtime, and you take over an NPC's working night: a bounded, paid shift in someone else's body, sized to how tired you are.

**Pillars:**

1. **Time is the only real currency.** Everything is priced in minutes — the commute, a conversation, a hospital stay, a night in the cells. Money is stored time and nothing more.
2. **The city is indifferent.** It ran before you, it does not need you, and it has no opinion of you. No morality meter, no approval, no destiny. Virtue is the player's own business.
3. **You are always covered.** Reciprocal occupancy: AI holds your life when you leave, you hold an NPC's when you sleep. Absence is safe, the night is populated, and institutions never deadlock on somebody's bedtime.
4. **Procedure over prompt.** An action is worth simulating when it decomposes into ordered steps with state — arrange, grip, ink, apply, re-ink. If it cannot be performed badly, it is abstracted.

**Primary mechanics:** shift work with real procedure and props that deplete; rent as a recurring metronome; transport and housing as a single felt optimisation in minutes; institutional chains, where a city response to an accident, a complaint or a budget runs through investigator, approval, procurement and labour, each link a job somebody holds; the night shift; the AI understudy.

**Player-experience goals.** Two things a player chases besides money. **Being needed** — climbing into the machine until others route through you, carried physically by the people waiting on your signature and the role only you hold. And **lateral pursuit** — the city offers many small lives and you pick which ones are yours: a hobby, a golf tournament, a plushy collection, getting decent at cooking, the wooded north. Progress is sideways and personal, never heroic.

**Being known** and **competence** are texture rather than pursuit. Agents remember individual people, and doing the work well feels good, but neither is a ladder to climb.

## Design Laws

Not pillars — rules that decide arguments, and that any future feature must satisfy.

- **Consequence needs a physical carrier.** An effect propagates only if something in the world carries it. Litter spreads because litter is there; rudeness does not, because nothing lies in the street. This one rule eliminates morality meters, reputation auras, and invisible simulation nobody can read. *Stated exception:* places-you-have-seen is carried only by player memory.
- **Progression is carried diegetically.** No net-worth display, no HUD balance, no counters. The world holds the evidence — plushies on a shelf, a trophy, a keyring, a roster with your name on it, a barista who greets you.
- **Resolution scales; causality does not.** Distant simulation is cheaper, never falser. Every state survives inspection back to a cause. Cheap is not fake.
- **Systemic content only.** No hand-authored quests, dialogue trees, or set pieces. A solo developer cannot author a city, but can grow one.

## References & Differentiation

| Comparable | What we take | What we deliberately leave |
|---|---|---|
| **Space Station 13** | Every role in an institution is player-holdable; story comes from institutional friction, not authored plot. Its closest living relative. | The round reset, the antagonists, the chaos. Its institutions exist to be disrupted; ours exist to be staffed. |
| **Kenshi / Project Zomboid** | A world that genuinely does not care about you. Simulation-first, no chosen one, no plot waiting on your arrival. | The brutality and the fail-cliff. Nothing in BrowserCity can destroy you. |
| **Eco / Ultima Online** | Players holding real economic and institutional positions; a world shaped by who staffs it. | Server wipes, and player-versus-player as the engine of drama. |
| **Habbo Hotel** | Browser-native, pixel, socially persistent — a place you drop into rather than a session you commit to. | Social space with nothing underneath it. Ours has a simulation. |
| **Receiver 2** | Manual, procedural handling of ordinary objects as an aesthetic rather than a difficulty. | Its subject matter and its lethality. Applied here to bin bags and till drawers. |

**Differentiators, honestly stated.** The genuine one is the *combination*: Space Station 13's cog-in-the-machine premise, made persistent, made lawful, made cozy in consequence, and put in a browser tab that opens in under a second. Each ingredient exists elsewhere; the set does not exist anywhere. The rest of the edge is execution and feel: the texture of a shift, the weight of a first bike. Execution is not a moat. There is no technical moat here and this brief will not pretend otherwise.

## Scope & MVP

**Platform:** browser, exclusively and non-negotiably. Authoritative simulation server-side, thin client. Boot to standing-in-the-city in under one second including load, with no character creation ceremony — the technical constraint enforces the design thesis.

**Team and capacity:** one developer with agentic assistance, working evenings and weekends, indefinitely, with no deadline. Systems must be uniform, data-driven and heavily testable so that agents can extend and validate them.

**Budget:** a meaningful but bounded monthly server spend, self-funded, running for years before anyone plays. The city ticks continuously whether or not anyone is connected; spinning down when empty was considered and rejected because it breaks causality.

**MVP — a small multiplayer district:**

- One full district: multiple neighbourhoods with distinct character, 100+ interiors, real transit, several institutions.
- Five or more playable jobs, each with genuine procedure — including at least one deliberately empty post, because the least supervised shift offers the most agency.
- The full day loop: rent, commute, shift, pay, lateral pursuit, sleep-or-night-shift.
- Reciprocal occupancy live: AI understudies, playable night shifts, AI backfill for every unheld role.
- AI citizens indistinguishable from players, carrying the entire density burden at low concurrency.
- At least one institutional chain running end to end. The plastic-bottle loop is the reference slice: a sanitation budget shortfall produces a full bin, which produces a dropped bottle, which licenses the next, which degrades a street, which triggers complaints, which starts a budget chain staffed by people players can be.

**Not in the MVP:** player criminality, districts beyond the first, player-owned businesses and infrastructure.

## Content & Direction

**World:** a contemporary city, unnamed and unremarkable. No fantasy, no near-future, no apocalypse. Its texture comes from institutions and weather, not from lore.

**Narrative:** entirely emergent. No written quests or dialogue trees. Stories are produced by institutional latency and physical consequence — the ambulance that was slow because of a decision made in a building you have never entered.

**Art:** fixed by the assets already in hand — LimeZu Modern Exteriors and Modern Interiors, 16×16, oblique perspective with a front-facing bias in the manner of Stardew Valley, pre-split, including buildings, interiors and a large prop library. Character spritesheets are unsplit and represent known work. The constraint is a gift: local density is affordable, which is what makes a city feel alive per screen rather than per database.

**Audio:** the city is the soundtrack. Traffic, rain, a distant tram, room tone that changes when you step indoors. Music is rare and diegetic — a radio, a busker. No composed score.

**Content breadth for the MVP:** one district, 100+ interiors, five or more playable job procedures, roughly a hundred professions of which most stay AI-held, and enough lateral pursuits that no player is left with only one thing to be into.

## Risks & Open Questions

**Headline risk — scope against capacity.** A persistent multiplayer district of 100+ interiors with five or more procedurally simulated jobs, built by one person on evenings and weekends, is a multi-year commitment with a monthly bill running throughout. This was raised twice during briefing and affirmed deliberately. It is recorded here so it can be re-examined honestly rather than rediscovered.

Two mitigations exist and should be used. The plastic-bottle loop is a genuine vertical slice that exercises institutions, emergence, jobs and physical consequence on a single street. And job access tiers mean playable roles can be added one at a time, so the job count is a dial rather than a commitment.

**AI density is a harder problem than multiplayer.** At low concurrency, AI citizens carry the entire feeling of aliveness. This is the real engineering risk. Multiplayer, given authoritative simulation, is close to incrementally free.

**The one-second boot against MMO streaming** remains the hardest technical constraint in the project, and it has not been designed against.

**The Burger Test — substantially de-risked.** The design rests on mundane work being intrinsically satisfying. Space Station 13 is a decade of evidence that players will voluntarily hold unglamorous institutional roles. What remains unproven is whether that holds *without* the round timer and the antagonists that give SS13's janitor his stakes.

**The borrowing licence is untested** as an anti-griefing measure. Consequence for a borrowed body lands on the NPC, not on the player.

**Gentrification is undampened.** Player presence raising rents will price newest players out of the best areas unless rent caps or social housing exist — both of which are institutions, and therefore content.

**Open questions for the GDD:**

- Which five-plus jobs are player-accessible first, and where exactly does procedural granularity apply to each? The admission test exists — can the action be performed badly? — but it has not been run against a job list.
- How many citizens does district one hold, and what does that cost per month? This is the number that constrains everything else, and it is still unpriced.
- Can a player take the same night shift repeatedly and become known as the night bus driver, or do borrowed shifts stay anonymous?
- Is the night shift framed diegetically, or as a shift board?
- How does the handoff work between early lateral pursuit and late institutional position, so that the game does not go quiet in between?
