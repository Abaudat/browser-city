---
title: "UX Specification: BrowserCity"
project: "BrowserCity"
date: "2026-08-29"
author: "Adrian"
version: "1.0"
status: "draft"
scope: "bounded — six surfaces identified by the implementation readiness assessment"
sources:
  gdd: "docs/gdd.md"
  requirements: "docs/requirements.md"
---

# BrowserCity — UX Specification

## Why this document exists, and what it deliberately is not

BrowserCity has no HUD. That is a design law, not an omission, and architecture decision **D17** makes it structural rather than disciplinary: *all UI is DOM, and the canvas may draw transient, object-bound views but never anything persistent, global or abstract.* There is no in-canvas UI layer, so there is nowhere to accidentally put a counter.

For a long time that was taken to mean the project needed no UX specification at all. **That reasoning conflated UX with UI chrome.** UX also covers how a player knows what is actionable, what the browser page itself does, and what the opening minutes feel like. The implementation readiness assessment found that three such surfaces had no owner in any document, and that one of them — what the player carries — contradicts D17 as currently written.

**This document is deliberately bounded.** It is not a visual identity spec: there is no colour palette, no typography scale and no component library here, because the art direction is fixed by the LimeZu tilesets and the UI surface is three DOM elements. It specifies **six surfaces and nothing else.**

| # | Surface | Status before this document | Needed by |
|---|---|---|---|
| 1 | Interactable affordance | **Unowned** | Epic 1, before Epic 8's prototype |
| 2 | What the player carries | **Unowned, and contradicts D17** | Epic 6 |
| 3 | Container view grammar | Anticipated by the epics, unspecified | Epic 6 |
| 4 | Page and session behaviour | **Unowned** | Epic 4 |
| 5 | First-session flow and teaching | **Unowned** | Epic 8 |
| 6 | Procedure interaction model (A1) | Scheduled for prototyping | Epic 8 |

**The governing constraints**, inherited and not restated elsewhere: no HUD, no counters, no objective markers (GDD design law); progression carried diegetically; *gamey affordances exist only where the experience genuinely breaks without them* (GDD design rule); D17's canvas rule; and D16's rule that **input produces intents, not actions**.

---

## 1 — Interactable affordance

### The problem

Nothing in the GDD, the architecture or the epics states how a player knows an object can be acted on. Every `reachability` reference is server-side resolution logic: a click resolves to an object instance and checks `interact_at` (FR148). That describes what happens *after* the click. Nothing describes what the player sees *before* it.

The gap is visible in the epics' own acceptance criteria. Story 8.11 reads *"**When** the player encounters the affordance"* — the affordance is assumed to exist and is never defined anywhere.

### Why an affordance is permitted here

The GDD's rule is that *gamey affordances exist only where the experience genuinely breaks without them.* This is that case, and the reason is specific to this game rather than general:

- The city is **16×16 pixel art at 3× zoom**, procedurally generated, and deliberately dense with props — that density is the entire point of using the LimeZu library, and it is what makes a street read as busy.
- On a typical screen a player faces dozens of drawn objects, of which a handful are interactable.
- There is **no HUD, no marker, no tutorial and no quest log** to disambiguate them.

Without an affordance a player cannot distinguish the till from the poster behind it, and the failure is not a difficulty curve — it is an inability to find the game.

### The decision

**A transient, object-bound highlight drawn on the object itself, plus a browser cursor change.**

Both are legal under existing decisions with no amendment required:

- **The highlight is drawn on the object.** It is transient, object-bound, and neither persistent nor global nor abstract — precisely the category D17's amendment permits.
- **The cursor is browser-level**, which is where D17 already places things outside the fiction, alongside the DOM name prompt and connection notices.

**Specification:**

| Aspect | Decision |
|---|---|
| Trigger | Pointer is over an object whose definition declares an interaction, **and** the player is within its `interact_at` reachability |
| In-world form | A subtle outline or brightening applied to that object's drawables only |
| Out-of-fiction form | The browser cursor changes to a pointer |
| Reachable but not hovered | No treatment. The world is not pre-lit |
| Hovered but **not** reachable | Cursor changes; the in-world highlight is **withheld** — this is how the player learns reachability without being told |
| Strength | The weakest treatment that survives a busy street at rush hour. Tuned by playing, not by specification |
| Persistence | None. The highlight exists only while hovered and is never a state the world holds |

**What is explicitly excluded:** no floating icons, no labels, no tooltips, no interaction prompts, no outline on every interactable at once, no pulsing to attract attention. These are the affordances the design laws forbid, and none is needed once hover carries the information.

### Why this is a precondition of A1, not part of it

Open item A1 asks whether procedure feels like **handling** or like **clicking**. A player who cannot tell what is clickable will report friction that belongs to *discovery* rather than to the procedure model, and the prototype's signal is confounded — the same confound the epics already anticipate between A1 and grid-inventory tedium.

**The affordance must be settled and in the build before the A1 prototype runs.** It lands in Epic 1.

---

## 2 — What the player carries

### The contradiction

**D19** specifies Tetris-style grid inventories with rotation, and enumerates the containers that carry them: cupboard, drawer, fridge, bag, crate, vehicle. Every one is a world object, so a view opened on it is object-bound and legal under D17.

**But D19 never says what the *player* carries, or how they look at it.** D14's holder model permits a citizen to hold stock directly, and the player is a citizen. If the player holds items directly and a view is opened on that holding, then "the player's inventory" is **persistent and global by definition** — exactly what D17 forbids. The project would violate its own structural guarantee at the first inventory screen.

Searching the GDD, the architecture and the epics for player inventory, pockets or carrying returns nothing. This is undecided rather than decided-and-unwritten.

### The decision

**The player has no inventory. They have hands, and they may own a bag.**

| What the player is carrying | Presentation | Legality |
|---|---|---|
| **An item in hand** — a bottle on the way to the bin, a coffee, a bin bag, a stamp | **No view at all.** The character sprite visibly holds it | Mirrors D19's existing *"on a surface → no view"* rule. Nothing is drawn but the world |
| **Items in a bag** the player owns and carries | **A transient view opened on the bag**, identical in every respect to opening a cupboard | The bag is a world object with a grid from its `object_def`. Object-bound and transient, so D17 needs no amendment |

**Hands hold one thing.** That is all the civic-verb loop requires — pick up bottle, walk, bin it — and it is what makes that loop legible: a player carrying a bottle can *see* they are carrying a bottle.

### Why this is better than a player inventory, not merely legal

- **Carrying capacity becomes a physical object.** A bag can be bought, upgraded, forgotten at home, left on a bus, or stolen. Capacity stops being an attribute of the player and becomes a thing in the world — which is the physical-carrier law paying out rather than being worked around.
- **It is a diegetic progression carrier**, in the same family as the certificate on the wall and the shelf of plushies. A bigger bag is visible progress that no counter reports.
- **It gives money a use that is not minutes**, the role the GDD assigns to collecting.
- **It preserves P2.** NPCs already pack the same grids by first-fit, so a citizen and a player carry things by exactly the same mechanism. There is no seam.
- **It makes the shopping trip a real decision.** What fits is what fits, and a player who did not bring the bag makes two trips — the same arithmetic that makes a badly packed van fit less.

**Consequence to accept:** a player with no bag can carry exactly one thing. This is intended. Acquiring a bag is an early, cheap, meaningful purchase, and the game's opening is more legible for the player having felt its absence first.

---

## 3 — Container view grammar

The epics already name this as something a UX specification would own. It applies to every container view — cupboard, bag, crate, vehicle — with no special case for the player's own bag, because there is no special case.

| Aspect | Decision |
|---|---|
| Where it is drawn | Canvas, in the game's own pixel style. A DOM panel would read as an application; the container is part of the fiction |
| What it is anchored to | The object it belongs to. It opens on that container and is dismissed by walking away, by pressing escape, or by opening another |
| Concurrency | **One container view at a time.** Two open grids invite a drag-between-panels interaction that would read as inventory management rather than handling |
| Grid | The container's own grid from `object_def` — cupboard 4×3, bag 3×2, crate 4×4. Item footprints are reused unchanged from world footprints (D2) |
| Rotation | Supported, as D19 requires |
| Failure to fit | Shown by the item not fitting. No error text, no message — the grid is the explanation |
| Capacity display | **None.** Spatial capacity is its own readout; a "12/20 slots" counter would be exactly the abstract, persistent overlay D17 forbids |
| Bulk contents | A sack occupying 1×2 and holding 340 g reads as a sack. Quantity is a property of the discrete item, shown when that item is examined, never as a global tally |

**Recorded risk, carried from D19:** grid inventories are a known source of tedium, and here the cost is paid in the only currency the game has. The dials are grid sizes and how often a packing decision is forced. *Storing your shopping should be a moment; running a warehouse shift should be the job.* Watch alongside the A1 prototype — but **prototype the two separately before combining them**, or neither result is interpretable.

---

## 4 — Page and session behaviour

The browser page is a UX surface in its own right. Beyond FR144's name prompt, no document addresses it.

| Aspect | Decision |
|---|---|
| **While the payload streams** | The name prompt is the page. The player is typing during the load, so there is no loading screen, no spinner and no progress bar — the boot design already removes the thing a loading indicator would report on |
| **Page title** | The city's name. It is a place, and a browser tab is how the player finds it among their other tabs |
| **Favicon** | A single recognisable mark. Same reasoning |
| **Return visit** | No prompt. Controllable in under a second, spawning wherever cause and elapsed time put the character (FR146). The page looks the same as it did on leaving because nothing was suspended |
| **Browser refresh** | Behaves as a reconnection, not a restart. The character does not move, no state is lost, and nothing is re-prompted |
| **Back button** | Leaves the game. The city keeps running — this is the design's central promise and needs no warning dialog |
| **Two tabs, one character** | **The most recent tab holds the character; the earlier tab is told, in plain language, that the character is being driven elsewhere and is not controllable.** It does not close itself, error, or fight for control |
| **Connection loss mid-procedure** | A connection-state notice appears (FR151). The procedure state machine is server-authoritative and snaps to its current step boundary, so the shift is not lost. On reconnection the player resumes at that step |

### Why the two-tab case is not a small item

FR35 establishes that **a citizen body has exactly one driver**, and reciprocal occupancy rests on that invariant: exactly one of `SelfL2`, `Understudy` or `Player` holds a body at any moment. Two tabs driving one character is the one case a player can create, by accident, that puts two drivers on one body.

It is also **the kind of thing found by a player rather than by a test**, because nobody writes a test for a scenario nobody wrote down. Making the rule explicit — last tab wins, earlier tab told plainly — turns an invariant violation into ordinary, legible behaviour.

---

## 5 — First-session flow, and how a procedure is learned

### The problem

The design has no tutorial (systemic content only), no HUD, no objective markers and no character creation. A player types a name and stands in a flat. **What the opening minutes are is unspecified** — not the mechanics, which exist, but the experience.

The sharper form of the problem: the core activity is a multi-step procedure with real failure modes — *grind → dose → tamp → pull*, or *serve → scan → bag → take payment → make change*. **Nothing in any document states how a player comes to know those steps.**

### Why this threatens the project's own falsification points

The Burger Test asks whether mundane work is intrinsically satisfying. **A player who cannot work out how to do the work fails that test for reasons that have nothing to do with the hypothesis.** Epic 7 and Epic 8 would return a false negative on the single assumption the whole design rests on — the most expensive way this project can be wrong.

### The decision

**Handover teaches the procedure, and handover already exists.**

The GDD's ritual open is *"arrive, change in, equip, handover chat with the person you relieve."* Epic 8 already builds handover and already carries the acceptance criterion that **handover is where information legitimately passes between people, per the carrier law.** It currently carries *world* information — what happened on the previous shift. It should also carry *procedural* information.

| Aspect | Decision |
|---|---|
| Vehicle | The outgoing worker at ritual open. No new system, no new UI |
| Trigger | The player is about to perform a procedure they have not performed before |
| Form | The outgoing worker walks the steps, in the world, on the actual props. Not a text panel, not a tooltip sequence |
| Repetition | Available on request by talking to a colleague — conversation already costs minutes (FR33), which prices asking exactly as the design prices everything else |
| After the first time | Nothing. No reminders, no checklist, no re-teaching. The props carry their own state and that is the standing reminder |
| What it never becomes | A tutorial mode, a skippable cutscene, a step list pinned to the screen, or a quest |

**This satisfies the physical-carrier law rather than bending it.** Knowledge travels through a person at handover — which FR54 already requires of all knowledge in this world, and which is why no other teaching mechanism is needed or permitted.

### The opening minutes

The first session's shape, stated so it is designed rather than incidental:

1. **The flat.** First-ever spawn is the player's own interior — the loop's opening beat, chosen because it is also the cheapest screen to boot (~420 rows against ~28k for a street).
2. **The door.** The street streams behind it. Going outside is the first thing there is to do and needs no prompting.
3. **The commute.** Sixty in-city minutes on foot. This is the game teaching its central arithmetic by charging it, before anything explains it.
4. **The shift.** Handover teaches the procedure, in the world, from a person.
5. **Payment, then rent.** The metronome starts. Rent takes its bite whether or not the player understood any of the above — which is the design's honest opening statement.

**Nothing in this sequence is scripted content.** Each beat is a system already scheduled; the specification is that they land in this order for a new player and that step 4 teaches.

---

## 6 — Procedure interaction model (A1)

**Unchanged and still open.** A1 is resolved by prototyping in Epic 8, insulated by D16's generic intent layer so iteration costs no input-layer rewrite.

This document adds two constraints on how that prototype is run:

1. **The affordance (§1) must be settled and in the build first.** Otherwise the prototype measures discovery friction and calls it procedure friction.
2. **Prototype the procedure model and the grid inventory separately before combining them.** The epics already record that the two *"will be felt together"*; a player fighting both cannot tell you which one they disliked. This is the same argument the GDD used to decline a pre-foundation Burger Test spike, applied to a smaller question.

The prototype's judgement is recorded in the design's own terms — *handling* or *clicking* — by playing rather than by reasoning.

---

## Accessibility floor

The readiness assessment found accessibility absent from all three source documents. It matters more here than in most games for a specific structural reason: **with no HUD and no text readouts, every piece of state travels through 16×16 pixel art at 3× zoom** — prop state, till contents, bin fullness, street degradation. Visual legibility is not a comfort layer; it is the entire information channel, and the GDD's headline success metric is *unprompted noticing*.

Deferring accessibility is a legitimate call for a solo passion project. **Deferring it silently is not**, because the no-HUD law makes it expensive to retrofit. This is the recorded floor:

| Item | v1 position |
|---|---|
| Interactable affordance strength | Tunable in the options menu. The lowest-cost hedge available, in a menu that already exists and already has a display section |
| Colour as sole carrier of state | **Avoided where cheap.** Prop state should differ in shape or content, not only in hue — a full bin has bags in it, not merely a different colour |
| Text size | The DOM surface is three elements and inherits browser text sizing. No custom scaling in v1 |
| Screen reader | **Out of scope for v1**, recorded as a decision. The game is a rendered world, and the DOM surface is a name prompt and an options menu |
| Input remapping | Supported — keybindings live in `localStorage` behind the options menu (FR149) |
| Motion and flashing | No screen shake, no flashing. Nothing in the design calls for either |

---

## Open items carried by this document

| # | Item | Disposition |
|---|---|---|
| **U1** | Affordance treatment strength — outline weight, brightening amount | Tuned by playing on a busy street at rush hour. Epic 1 ships a dial, not a final value |
| **U2** | Whether hands should hold more than one item | Starts at one. Revisit only if the civic-verb loop or a procedure demonstrably needs two |
| **U3** | A1, the procedure interaction model | Unchanged — prototyped in Epic 8, under the two constraints in §6 |
| **U4** | Container view dismissal on walking away — distance and whether it is animated | Falls out of the Epic 6 implementation; no decision needed in advance |
