# PR scope — the scripted Scotty

Scope is `high-level-agentic-flow.mmd` made executable, minus the one node drawn
as a parallelogram.

## What we build

1. **A skill that walks the whole flowchart.** One entry point, one wake, one  
ecision, one action, exit. It reads state, it does not remember it. It is fully scripted, and only wakes agents when necessary.
2. **Orca integration** so every role's session is visible from the skill.
3. **Session reconciliation** so a role whose session stopped is restarted
ather than silently skipped.
4. **Six bash scripts** underneath, holding every deterministic read and write.

The split is the point. The scripts decide *facts* — what is active, who has
commented, whether the head moved. The skill decides *nothing* except which
branch of the flowchart those facts select, and then does the one thing at the
end of it. Anything the skill has to reason about is a fact a script should have
returned.

Two of the six are not Scotty's alone. `bc-comment.sh` and `bc-pr.sh` are
written through by the leads and Crew as well, which is what keeps one writer
per comment and one opener per PR.

---

## `bc-budget.sh` — the budget gate

| Command | Node | Returns |
| ------- | ---- | ------- |
| `check` | budget-available | exit 0 available, 1 spent, 2 broken — plus one line saying which and why |

The first node of the wake and the only one that can stop it before the board
is read. Three outcomes, not two: a spent budget (`1`) and a gate that cannot
answer (`2`) both stop the team, and if they exited the same way a team
stopped for a week would look exactly like a team behaving correctly. The
caps — 85% of the 5-hour window, 80% of the week — are read from
Anthropic's account-wide rate-limit headers, so Adrian's own sessions spend
the same budget and the team's share shrinks without anyone coordinating.

## `bc-issue.sh` — issues


| Command                       | Node                                                                                                     | Returns                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `next`                        | starting-dev-cycle                                                                                       | highest-priority sub-issue of the highest-priority issue in the Sprint backlog |
| `current`                     | subissue-active / subissue-status                                                                        | the active sub-issue and its status, or nothing                                |
| `transition <issue> <status>` | dispatching-implementation, opening-leads-review, merging-pr, dispatching-rework, reopening-leads-review | —                                                                              |
| `create-demo <n>`             | creating-demo-issue                                                                                      | the new Sprint N Demo issue number                                             |
| `demo-current`                | demo-active                                                                                              | the active Sprint Demo issue and its status, or nothing                        |
| `demo-commented <issue>`      | demo-has-feedback                                                                                        | whether Adrian has commented                                                   |


`demo-current` and `demo-commented` are additions — demo-active and
demo-has-feedback are gates with no command otherwise.

## `bc-comment.sh` — comments

**Scotty writes:**


| Command                         | Node                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `create-analysis-stubs <issue>` | starting-dev-cycle                                      |
| `create-review-stubs <pr>`      | opening-leads-review — one per lead in scope **+ crew** |
| `create-breaker <pr>`           | tripping-breaker                                        |


**Scotty reads:**


| Command                                      | Node                                | Returns                            |
| -------------------------------------------- | ----------------------------------- | ---------------------------------- |
| `breaker-exists <pr>`                        | breaker-tripped                     | yes/no                             |
| `all-leads-commented --issue <n> / --pr <n>` | leads-analysed, leads-reviewed-head | yes/no                             |
| `unapproved-leads <pr>`                      | leads-all-approved                  | the list; empty means all approved |
| `crew-addressed <pr>`                        | crew-addressed                      | yes/no                             |
| `should-trigger-breaker <pr>`                | cycles-exhausted                    | yes/no — cycle count past 8        |


**Leads and Crew write:**


| Command                          | Who    | When                              |
| -------------------------------- | ------ | --------------------------------- |
| `update-analysis <issue> <role>` | a lead | writing its direction, To Analyze |
| `approve <pr> <role>`            | a lead | Leads review                      |
| `reject <pr> <role>`             | a lead | Leads review                      |
| `mark-addressed <pr>`            | Crew   | after pushing, Reviewed           |


`approve` and `reject` both stamp the head SHA they reviewed. That stamp is the
whole turn mechanism: a lead owes a review when it has never reviewed or when
the head has moved since. There is no verdict to reset, and an old `APPROVED`
never covers code nobody read — which is why merging-pr can only merge when
every lead approved *the current head*.

`all-leads-commented` covering both leads-analysed and leads-reviewed-head is
deliberate: same question, different phase. If the two need different
arguments, they are two commands.

## `bc-pr.sh` — pull requests


| Command             | Who    | Node                                                                            |
| ------------------- | ------ | ------------------------------------------------------------------------------- |
| `open <issue>`      | Crew   | after implementing; body carries `Closes #<issue>` so the issue closes on merge |
| `merge <pr>`        | Scotty | merging-pr                                                                      |
| `for-issue <issue>` | Scotty | pr-opened — the PR number and head SHA, or nothing                              |
| `head <pr>`         | Scotty | the current head SHA, for the reviewed-SHA comparison                           |


`for-issue` and `head` are additions. pr-opened has no command without the
first, and leads-reviewed-head's "reviewed the current head" cannot be
evaluated without the second.

## `bc-sprint.sh` — sprints


| Command   | Node                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| `start`   | starting-next-sprint — open the next sprint and scope tasks into it                   |
| `close`   | closing-sprint — move every remaining issue back to the backlog, close the Demo issue |
| `over`    | sprint-over — It is past 12:00 in Zurich time on the last day of the Sprint           |
| `current` | the sprint number and its last day, both of which `over` and `create-demo <n>` need   |


## `bc-session.sh` — sessions and agents


| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `spawn <role>`          | first start of a role that has no session, returns the sessionId    |
| `state <sessionId>`     | the reconciliation check — absent, idle, or working                 |
| `start <sessionId>`     | start or restart an existing session, resuming from its recorded ID |
| `send <role> <message>` | send a message to an existing, live session                         |



## `bc-epic.sh` — the epic breakdown as issues

Not part of the wake. `orchestrator.sh` never calls it: it is the one-time
migration of `_bmad-output/planning-artifacts/epics/epic-N.md` onto the board
(Story 0.20), run by hand like `setup-github.sh`, and afterwards the repair
tool for an epic whose import died halfway.

| Command                     | Purpose                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `parse <epic>`              | the epic file as JSON. Reads the file only, never GitHub                      |
| `plan <epic>`               | what `import` would create, skip and repair. Writes nothing, asks nobody      |
| `import <epic>`             | create/repair the epic issue, its sub-issues, their labels and board fields   |
| `check <epic>`              | round-trip the file against the board and name every story on only one side   |

All four take `--only <ids-csv>`; the ids it leaves out come back as
`excluded` and are never counted as drift.

Everything is keyed on two provenance markers, `<!-- bc:epic <n> -->` and
`<!-- bc:story <id> -->`, so a second run creates nothing twice and finishes
what the first started. Nothing is keyed on a title, which a human may
reword, and nothing on GitHub's search index, which lags a bulk write.

Size and Priority are the one judgement here — the epic files record neither —
so they go through `prompts/judge-story-size.md`, one `claude_oneshot` per run
covering every story that still lacks them. A story Scotty does not answer for
is reported `unplaced` and left for a rerun; it is never guessed.
