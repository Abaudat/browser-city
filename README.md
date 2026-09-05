# BrowserCity

A persistent, browser-based life simulation set in a city that runs whether or not anyone is
watching. The server is a SpacetimeDB module; the client is a thin PixiJS renderer. The game is
built by an agentic team that takes its work from GitHub.

## Layout

```
docs/               what the game is
  requirements.md     every FR and NFR, one line each — the only place a requirement is stated
  gdd.md              the game design: pillars, mechanics, progression, art and audio
  ux.md               the UX specification: affordance, carrying, container views, first session

agentic-team/       who builds it
  high-level-agentic-flow.mmd   the flowchart the orchestrator executes
  scripts/                      that flowchart made executable — see its README

server/             the SpacetimeDB module (Rust) — see its README
ModernTileset/      the licensed 16x16 art source
.claude/            agent definitions and skills for the team's roles
```

## Where each thing lives, and only there

- **Requirements** are in `docs/requirements.md`. Nothing else numbers them; everything else cites
  them by identifier.
- **The plan** is on the GitHub board: one issue per epic, one sub-issue per story. Each story
  issue carries its acceptance criteria and names the FRs and NFRs it delivers. No epic or story
  is described in this repository.
- **Status** is on the board too, in its Status, Size, Priority and Sprint fields. It is never
  recorded in a file.
- **Design** is in `docs/gdd.md` and `docs/ux.md`. They describe the game, not the work.
- **How the team operates** is in `agentic-team/`. The roles themselves are in `.claude/agents/`.

## Running things

```bash
bash agentic-team/scripts/orchestrator.sh    # one tick of the team's wake
bash agentic-team/scripts/tests/run-all.sh   # the orchestrator's test suite
cd server && spacetime publish --yes         # build and publish the module locally
```
