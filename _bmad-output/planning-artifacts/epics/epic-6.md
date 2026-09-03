[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 6: Stock, Goods and Money

Things exist in quantities, move only when somebody moves them, and money is a physical object before it is a number.

**This epic is absent from the GDD's breakdown.** The architecture identified it as core, previously unwritten, and load-bearing: it is L1's substrate, so it comes first among the economy systems. It also makes the GDD's "the till runs short of change" **fall out** rather than be special-cased, and it turns logistics from a background system into a job.

**It builds the chain engine.** D14 records that logistics needs no new machinery because it is the institutional chain engine pointed at goods. An order is the engine's first instance; Epic 10 adds institutional templates on top without touching it.

**Recorded risk, to be watched from the first story.** Grid inventories are a known source of tedium, and here the cost is paid in the only currency the game has: minutes spent packing are minutes not spent on a life. The dials are grid sizes and how often a packing decision is forced. Storing your shopping should be a moment; running a warehouse shift should be the job. **If packing becomes the dominant interaction, the design has drifted** - watch it alongside Epic 8's procedure prototyping, since the two will be felt together.

### Story 6.1: Items

**Leads:** quentin, tim

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

**Leads:** quentin, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, tim

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

**Leads:** quentin, tim, artie

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

**Leads:** quentin, tim

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

**Leads:** quentin, tim

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

**Leads:** quentin, tim

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

**Leads:** quentin, derek, tim

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

**Leads:** quentin, derek, tim, artie

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

**Leads:** quentin, tim, artie

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
