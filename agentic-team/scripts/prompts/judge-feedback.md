This is your `integrating-feedback` call.

Sprint Demo issue #{{demo}} has feedback on it from Adrian. You will be given
the demo body, every human comment on it, and the current backlog (each item
as an issue number, title, whether it is an epic or a story of one, its
priority, its size and the open issues it is blocked by).

Read `docs/requirements.md` first — the feedback has to land against the
functional and non-functional requirements that are already written down, not
against your reading of the comment alone.

Then, for each thing Adrian asked for, decide where it belongs:

- **An existing backlog story already covers it.** Leave it alone. Do not open
  a duplicate, and do not rewrite someone else's issue.
- **It is feedback on the increment just demoed.** It belongs as a new story
  in the epic that increment came from.
- **It is a new capability, or work for later.** It belongs in a later epic —
  an existing one if it fits, a new one if nothing does.

Open a new epic only when nothing on the backlog can hold the work. An epic is
an outcome, not a bucket.

    bash {{scripts}}/bc-issue.sh write-epic <n> "<title>" <bodyfile> <priority>

`<n>` is the next free epic number (the backlog list shows which are taken).
`<bodyfile>` holds the epic's preamble — what outcome it delivers and why —
and nothing else. `<priority>` is one of `Blocker`, `Critical`, `Standard`,
`Low`. It prints the new issue number; you need that number for the stories.

Then open each story under its epic:

    bash {{scripts}}/bc-issue.sh write-story <epic-issue> <id> "<title>" \
      <bodyfile> <size> <priority> <leads-csv> <blocked-by-csv>

- `<epic-issue>` is the epic's ISSUE number — the one write-epic printed, or
  the one the backlog list shows for an existing epic. Not the epic number.
- `<id>` is the story's id within its epic, e.g. `3.4`.
- `<bodyfile>` holds the story's prose: the story itself, then its acceptance
  criteria. If the work needs a requirement that `docs/requirements.md` does
  not yet carry, make writing that requirement one of the criteria — never
  edit the doc yourself.
- `<size>` is one of `XS`, `S`, `M`, `L`, `XL`; `<priority>` as above. Judge
  the work, not the prose. Do not make everything Critical: a priority every
  story shares orders nothing.
- `<leads-csv>` is the leads whose direction the story needs, e.g.
  `derek,tim`, or `-` for none. Quentin is always in scope and does not need
  listing.
- `<blocked-by-csv>` is the issue numbers of the open stories that must be
  merged before this one can be built or verified, e.g. `97,132`, or `-` for
  none. Think before writing `-`: the team starts, from the whole backlog and
  in no epic order, whichever story has the highest priority and smallest size
  **and no open blocker** — so a story with no blockers may be started next,
  before anything you merely assumed would come first. Name the specific
  stories whose systems, tables or decisions this one uses, in any epic; do
  not name an epic, and do not list a story just because its number is lower.

Priority is one scale across the whole backlog, not one per epic, because the
pick ignores epics: `Blocker` is only for a defect or gap in an increment that
has already shipped or been demoed, or a fix to the team's own process;
`Critical` is work on the dependency path to the nearest milestone the team
has not reached yet — a blocker, direct or indirect, of the next falsification
point or acceptance walk; `Standard` is the rest of the MVP path; `Low` is
explicitly optional polish and everything post-MVP. A story is never `Blocker`
or `Critical` because others wait on it — that is what blockers are for.

If a new story must land **before** a story that already exists — feedback
that a later story turns out to rest on — say so on the existing story:

    bash {{scripts}}/bc-issue.sh write-blockers <existing-issue> <new-issue> [<issue>...]

It only ever adds blockers; a blocker stops blocking when it is closed.

Finally, reply to Adrian on the demo issue with what you decided and why.
This is the only way he sees your ruling, and it is required even when you
opened nothing — an empty answer still owes him a "why":

    bash {{scripts}}/bc-issue.sh write-feedback-reply {{demo}} <bodyfile>

`<bodyfile>` holds your reply's prose only. For each thing he raised, say
where it landed — the issue you opened or amended, that the backlog already
covered it, or that you did not act on it and why. Calling it twice is safe:
it edits your existing reply rather than posting a second one, so re-running
this job after a crash never leaves him two replies.

Rules:
- Plain markdown in every body file. No preamble, no headings the script
  writes for you, no code fences, no `<!-- bc: -->` markers, no `Closes #`.
- Both `write-epic`/`write-story` calls put the new issue on the board in
  `Backlog`, on no sprint. That is correct: nothing is planned into a sprint
  — a story goes onto one when the team starts it. Never set Status,
  Priority, Size or a sprint yourself, and never create an issue or a
  dependency any other way.
- Base everything on the feedback and the backlog you were given. Do not
  invent work Adrian did not ask for. If the backlog already covers everything
  he raised, or he raised nothing to build, open nothing and say so — an empty
  answer is a real one here, and padding it with work he did not ask for is
  worse than no work at all.
- Do not comment on the demo issue any other way than through
  `write-feedback-reply`, and do not move it — the script does that once your
  work is on the board.

If a call exits non-zero, report what it printed and stop. Otherwise reply
with the issue numbers you opened. Your reply is not the artefact; the
backlog is — and neither is complete until `write-feedback-reply` has run.
