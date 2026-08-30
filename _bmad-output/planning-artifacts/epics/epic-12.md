[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 12: A Life

A player with spare minutes has three genuinely different things to spend them on, and a shelf that shows it.

**This is where money becomes minutes and minutes become a life.** The transport ladder is priced so that one-time purchases buy minutes efficiently and recurring costs do not - which is exactly why housing's real value is proximity to a life rather than proximity to work.

**Three pursuits, deep rather than many.** Cooking, collecting, and a sport or club. **Places is deliberately not among them**: it was the only candidate with no physical carrier, and dropping it retires the stated exception to the physical-carrier law, which now stands unqualified.

**Pursuits enter the own-time catalogue built in Story 5.15**, shared with citizens. The cafe has people in it because citizens spent their own time there, and the player's pursuits are drawn from the same list.

**The stated tension, carried from the GDD.** P1 pushes the player to buy the commute down, but the commute is the loop's variance source. Optimise perfectly and you see less of the city. This is a deliberate trade, resolved three ways: the commute has a floor, faster changes *what* you read rather than whether, and the sensor migrates to institutional position in Epic 13.

### Story 12.1: The Bike

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim, artie

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

**Leads:** quentin, derek, tim, artie

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

**Leads:** quentin, derek, tim, artie

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

**Leads:** quentin, derek, artie

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

**Leads:** quentin, derek

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
