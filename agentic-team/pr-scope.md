# PR scope — the scripted Scotty

Scope is `high-level-agentic-flow.mmd` made executable, minus the one node drawn
as a parallelogram.

## What we build

1. **A skill that walks the whole flowchart.** One entry point, one wake, one  
ecision, one action, exit. It reads state, it does not remember it. It is fully scripted, and only wakes agents when necessary.
2. **Orca integration** so every role's session is visible from the skill.
3. **Session reconciliation** so a role whose session stopped is restarted
ather than silently skipped.
4. **Five bash scripts** underneath, holding every deterministic read and write.

The split is the point. The scripts decide *facts* — what is active, who has
commented, whether the head moved. The skill decides *nothing* except which
branch of the flowchart those facts select, and then does the one thing at the
end of it. Anything the skill has to reason about is a fact a script should have
returned.

Two of the five are not Scotty's alone. `bc-comment.sh` and `bc-pr.sh` are
written through by the leads and Crew as well, which is what keeps one writer
per comment and one opener per PR.

---

## `bc-issue.sh` — issues


| Command                       | Node               | Returns                                                                        |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `next`                        | N1                 | highest-priority sub-issue of the highest-priority issue in the Sprint backlog |
| `current`                     | QS / SS            | the active sub-issue and its status, or nothing                                |
| `transition <issue> <status>` | A2, B2, C3, C4, E2 | —                                                                              |
| `create-demo <n>`             | DM                 | the new Sprint N Demo issue number                                             |
| `demo-current`                | QD                 | the active Sprint Demo issue and its status, or nothing                        |
| `demo-commented <issue>`      | DA                 | whether Adrian has commented                                                   |


`demo-current` and `demo-commented` are additions — QD and DA are gates with no
command otherwise.

## `bc-comment.sh` — comments

**Scotty writes:**


| Command                         | Node                                  |
| ------------------------------- | ------------------------------------- |
| `create-analysis-stubs <issue>` | N1                                    |
| `create-review-stubs <pr>`      | B2 — one per lead in scope **+ crew** |
| `create-breaker <pr>`           | C6                                    |


**Scotty reads:**


| Command                        | Node    | Returns                            |
| ------------------------------ | ------- | ---------------------------------- |
| `breaker-exists <pr>`          | C0      | yes/no                             |
| `all-leads-commented &lt;issue | pr&gt;` | A1, C1                             |
| `unapproved-leads <pr>`        | C2      | the list; empty means all approved |
| `crew-addressed <pr>`          | E1      | yes/no                             |
| `should-trigger-breaker <pr>`  | C5      | yes/no — cycle count past 8        |


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
never covers code nobody read — which is why C3 can only merge when every lead
approved *the current head*.

`all-leads-commented` covering both A1 and C1 is deliberate: same question,
different phase. If the two need different arguments, they are two commands.

## `bc-pr.sh` — pull requests


| Command             | Who    | Node                                                                            |
| ------------------- | ------ | ------------------------------------------------------------------------------- |
| `open <issue>`      | Crew   | after implementing; body carries `Closes #<issue>` so the issue closes on merge |
| `merge <pr>`        | Scotty | C3                                                                              |
| `for-issue <issue>` | Scotty | B1 — the PR number and head SHA, or nothing                                     |
| `head <pr>`         | Scotty | the current head SHA, for the reviewed-SHA comparison                           |


`for-issue` and `head` are additions. B1 has no command without the first, and
C1's "reviewed the current head" cannot be evaluated without the second.

## `bc-sprint.sh` — sprints


| Command   | Node                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| `start`   | DN — open the next sprint and scope tasks into it                                   |
| `close`   | DC — move every remaining issue back to the backlog, close the Demo issue           |
| `over`    | QF — It is past 12:00 in Zurich time on the last day of the Sprint                  |
| `current` | the sprint number and its last day, both of which `over` and `create-demo <n>` need |


## `bc-session.sh` — sessions and agents


| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `spawn <role>`          | first start of a role that has no session, returns the sessionId    |
| `state <sessionId>`     | the reconciliation check — absent, idle, or working                 |
| `start <sessionId>`     | start or restart an existing session, resuming from its recorded ID |
| `send <role> <message>` | send a message to an existing, live session                         |


