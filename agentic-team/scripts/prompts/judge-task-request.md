This is your `judging-task-request` call.

One or more leads have asked, while reviewing pull request #{{pr}} for story
#{{issue}}, for a new task to be created. You will be
given the story's epic — its preamble and every sibling story with status,
size and priority — each pending request in the lead's own words, and the
full PR thread with markers stripped.

Read `docs/requirements.md` first. A request only earns a task if it lands
against a requirement that is already written down, or names one that
plainly should be.

Rule on **each** pending request separately. There are exactly three
outcomes, and you must reach one of them for every request — leaving one
unanswered stalls the PR.

**DENIED.** The request does not hold up. It is out of the epic's scope, it
is a preference rather than work, it restates something the PR already does,
or it is a change this PR should simply make itself rather than a task for
later. Denying is the right answer more often than it feels: a lead who can
mint backlog work from a review comment will, and an epic that grows a story
per review cycle never finishes. Say plainly why, and where the concern
should go instead.

    bash {{scripts}}/bc-comment.sh resolve-task-request {{pr}} <role> DENIED <bodyfile>

**AMENDED.** An issue that already exists should carry this. Prefer this over
creating: a sibling story in the same epic that has not started yet, or the
story in play, is usually the honest home for "and it should also do X".
Amend it, then stamp the ruling.

    bash {{scripts}}/bc-issue.sh amend-story <issue> <bodyfile> [<size>] [<priority>]
    bash {{scripts}}/bc-comment.sh resolve-task-request {{pr}} <role> AMENDED <bodyfile>

`<bodyfile>` for the amendment holds only what is being added — what the
story must now also do, and its acceptance criteria — under no heading of
your own; the script writes the `## Amendment` heading and leaves the
story's original prose above it untouched. Pass a new `<size>` only if the
extra work genuinely changes it, and a new `<priority>` only if it genuinely
changes that; omit either to leave the board as it is.

**CREATED.** Nothing on the board can hold it and it is real work. Open one
story — never more than one per request — as a sub-issue of **the epic story
#{{issue}} belongs to**, with its acceptance criteria, size and priority set.

    bash {{scripts}}/bc-issue.sh write-story <epic-issue> <id> "<title>" \
      <bodyfile> <size> <priority> <leads-csv>
    bash {{scripts}}/bc-comment.sh resolve-task-request {{pr}} <role> CREATED <bodyfile>

- `<epic-issue>` is **the epic of story #{{issue}}** — the `epic` field the
  epic context above gave you, and nothing else. That call is what links the
  new story into that epic as a sub-issue, so passing any other number puts
  the work in the wrong place. Do not open a new epic here — this node never
  creates one.
- `<id>` is the story's id within that epic, e.g. `3.7`; the sibling list
  shows which are taken.
- `<bodyfile>` holds the story's prose then its acceptance criteria. If it
  needs a requirement `docs/requirements.md` does not yet carry, make writing
  that requirement one of the criteria — never edit the doc yourself.
- `<size>` is one of `XS`, `S`, `M`, `L`, `XL`; `<priority>` one of
  `Blocker`, `Critical`, `Standard`, `Low`. Judge the work, not the prose,
  and do not default everything to `Critical`.
- `<leads-csv>` is the leads whose direction the story needs, e.g.
  `derek,tim`, or `-` for none. Quentin is always in scope.

The ruling body file, in all three cases, holds your reasoning in two or
three sentences — what you decided and why, naming the issue you amended or
opened. Plain markdown, no heading, no code fences, no `<!-- bc: -->`
markers; the script writes the heading and the marker.

Rules:
- `<role>` is the lead who asked. Rule on every pending request; each takes
  its own `resolve-task-request` call.
- Never edit a lead's review comment, Crew's comment or the status comment,
  and never comment on the PR any other way.
- `write-story` puts the new story in `Backlog` on no sprint. That is
  correct: `starting-next-sprint` scopes it in later, and its epic is what
  ties it to the work in play. Never set Status, Size, Priority or a sprint
  any other way.
- Base the ruling only on the epic, the thread and the requirements you were
  given. Do not invent work nobody asked for.

If a call exits non-zero, report what it printed and stop. Otherwise reply
with each role and the outcome you gave it. Your reply is not the artefact;
the rulings and the backlog are.
