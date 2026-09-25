<p align="center">
  <img src="docs/readme/hero.png" width="880" alt="Browser City, a city sim built by six AI agents. The six agents stand on a pixel-art street in front of a hardware store.">
</p>

<p align="center">
  <a href="https://abaudat.github.io/browser-city/"><img src="docs/readme/play.png" width="880" alt="Play in your browser"></a>
</p>

<p align="center">
  <img src="docs/readme/premise.png" width="880" alt="The premise. Scotty, Scrum Master: Welcome to Browser City, a city sim that keeps running whether or not anyone is watching. Nobody on the team building it is human. Six AI agents take work from a GitHub board, argue about it in comments, write the code, review it and ship it. Players play the game and tell us what to build next. 6 agents. All state on GitHub. Always running.">
</p>

<p align="center">
  <img src="docs/readme/team.png" width="880" alt="The team. Four leads direct and review. Only Crew touches the code. Scotty keeps the cycle turning. Scotty, Scrum Master (Fable): runs the cycle, turns demo feedback into stories and rules on task requests. Crew, Implementer (Sonnet): the only one who writes to the repo, implements the story and opens the PR. Tim, Tech Lead (Fable): keeps the code simple and the stack used well, owns CI and deploys. Derek, Game Designer (Fable): guards the design doc, every feature must be a real system, not a one-off. Quentin, QA (Fable): owns TDD, the trace matrix and CI tests, so players never meet a bug. Artie, Art Director (Fable): owns how the city looks and feels, from the pixel art to the UI.">
</p>

<p align="center">
  <img src="docs/readme/process.png" width="880" alt="How a story ships. 1 Pick: the orchestrator takes the highest-priority, smallest story nothing blocks. 2 Analyze: each lead in scope writes its direction on the issue. 3 Build: Crew implements the story and opens a pull request. 4 Review: CI goes green, then every lead approves; after 8 rounds, the Product Owner is paged. Changes asked send it back to Crew. 5 Merge: merged and marked Done, the next story starts. At the end of every Sprint, Scotty opens a Demo issue, the Product Owner plays the build and comments, and Scotty turns the feedback into new epics and stories. All state lives on GitHub: the board, issues, PRs and comments.">
</p>

## Explore the repo

| Where | What you'll find |
| --- | --- |
| [`.claude/agents/`](.claude/agents/) | The six role prompts |
| [`agentic-team/`](agentic-team/) | The flowchart the orchestrator runs, and the scripts that run it |
| [`docs/`](docs/) | What the game is: requirements, game design, UX |
| [Issues and board](https://github.com/Abaudat/browser-city/issues) | Every epic, story, direction and review, in the team's own words |
| [`server/`](server/) · [`client/`](client/) | The SpacetimeDB module (Rust) and the PixiJS browser client |

<details>
<summary><b>Run it locally</b></summary>

```bash
bash agentic-team/scripts/orchestrator.sh    # one tick of the team's wake
bash agentic-team/scripts/tests/run-all.sh   # the orchestrator's test suite
node scripts/team-usage.mjs                  # the team's token usage per role, model and issue, in the terminal
node scripts/team-dashboard/server.mjs       # the team live in a browser: who is working, the task, the budget (:4747)
cd server && spacetime publish --yes         # build and publish the module locally
cd client && npm ci && npm run dev           # the browser client, against the local module
```

</details>

---

<sub>Pixel art: Modern Interiors and Modern Exteriors by LimeZu, used under licence.</sub>
