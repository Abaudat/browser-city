---
name: bc-sdlc
description: 'The Browser City SDLC scripts — how Crew, the leads (tim, derek, quentin, artie) and Scotty write their work onto a task issue or a PR. Use when you are Crew opening a PR or addressing review comments, a lead writing an analysis direction or a review verdict, or Scotty opening the Sprint Demo issue or posting a breaker note.'
---

# bc-sdlc — the scripted SDLC surface

State lives entirely in GitHub: a task issue carries one **analysis comment**
per lead in scope, a PR carries one **review comment** per lead plus one
**Crew comment**. Each comment has exactly one writer, found by its
`<!-- bc:lead:<role> -->` / `<!-- bc:crew -->` marker.

The level-2 scripts below are the only supported way to write those comments
and to open a PR. **Never** edit a comment with `gh api ... -X PATCH`, never
write a `<!-- bc: -->` marker yourself, and never edit another role's comment
or the orchestrator's `<!-- bc:status -->` comment. The scripts write the
headings, the cycle sections and the markers for you.

Run everything from the repo root of your worktree; `<scripts>` below is that
repo's `agentic-team/scripts/` directory.

Reading is plain `gh`: `gh issue view <issue> --comments`,
`gh pr view <pr> --comments`, `gh pr diff <pr>`.

## Crew

| Command | What it does |
|---|---|
| `bash <scripts>/bc-pr.sh open <issue> "<title>" <bodyfile>` | Pushes the current branch and opens the PR, labelled `story`, with `Closes #<issue>` appended to `<bodyfile>`'s prose. Prints the PR number. Idempotent — if a PR already closes that issue it prints its number and creates nothing. The script picks the base branch; never retarget the PR or open one another way. |
| `bash <scripts>/bc-comment.sh mark-addressed <pr> [bodyfile]` | Rewrites your `### Crew` comment on the PR and stamps it at the PR's **current head**. `[bodyfile]` is optional prose on what you changed; omitted, it writes "Addressed." Push your fixes *first* — the stamp is taken from the head at the moment you run it. |

`<bodyfile>` is a plain text file holding only your prose — no markers, no
`Closes #`, no headings the script writes for you.

Pushing is what returns the PR to the leads, so push once when the whole
cycle is addressed, then `mark-addressed`.

## Leads — tim, derek, quentin, artie

| Command | What it does |
|---|---|
| `bash <scripts>/bc-comment.sh update-analysis <issue> <role> <bodyfile>` | Rewrites *your* analysis comment on the task issue as `### Analysis — <role>` and marks you `READY`. `<bodyfile>` is **required** and holds only your direction prose. Crew is dispatched only when every lead in scope is READY. |
| `bash <scripts>/bc-comment.sh approve <pr> <role> [bodyfile]` | Stamps `APPROVED` on your review comment at the PR's current head. |
| `bash <scripts>/bc-comment.sh reject <pr> <role> [bodyfile]` | Stamps `CHANGES` on your review comment at the PR's current head. |

`<role>` is your own name and nothing else.

For `approve`/`reject`, `[bodyfile]` holds this cycle's findings: omit it for
a plain approval, but **always** include one with `reject` explaining what
must change. The script writes the `#### Cycle N — VERDICT @ <sha>` heading
above your findings and keeps your earlier cycles' sections underneath — do
not write a heading or repeat your history yourself. Re-running for the same
cycle replaces that cycle's section.

A verdict covers the commit it was stamped on. When Crew pushes, your
`APPROVED` no longer covers the head and you are back on the hook — read your
last cycle section, then judge whether Crew addressed it. Eight review cycles
trips the circuit breaker, so do not raise at cycle 5 what you could have
raised at cycle 1.

## Scotty

You are dispatched as a one-shot with a thread or a story list already in
your input, and your reply is thrown away — the artefact is the product. Each
method below takes the prose you just wrote and creates the thing that
carries it in one call, so the two are never out of step.

| Command | What it does |
|---|---|
| `bash <scripts>/bc-issue.sh write-demo <sprint> <bodyfile>` | Opens the `Sprint <n> Demo` issue with `<bodyfile>` as its body, labels it `demo`, adds it to the board and scopes it into Sprint `<n>`. Prints the new issue number. |
| `bash <scripts>/bc-comment.sh write-breaker <pr> <bodyfile>` | Posts the breaker comment on the PR with `<bodyfile>` as the note, adds the `breaker` label and assigns Adrian. Prints the new comment id. Exits 1 and writes nothing if a breaker comment already exists. |

`<bodyfile>` holds your prose only. The scripts write the `### Sprint N Demo`
/ `### Breaker` heading, the `@`-mention of Adrian and the `<!-- bc:demo -->`
/ `<!-- bc:breaker -->` marker — do not write any of them yourself, and do not
create the issue or comment any other way. Nothing else on the board is
yours: never edit a lead's comment, Crew's comment, or the status comment.

## Exit codes

`0` did it · `1` nothing to do, someone got there first (`write-breaker` only)
· `2` bad arguments, an empty body file, or the comment this command must
edit does not exist (the orchestrator creates every stub — if yours is
missing, stop and say so rather than creating one).
