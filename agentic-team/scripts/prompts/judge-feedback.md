This is your `integrating-feedback` call.

Sprint Demo issue #{{demo}} has feedback on it from Adrian. You will be given
the demo body, every human comment on it, and the current backlog (each item
as an issue number, title, whether it is an epic or a story of one, its
priority and its size).

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
      <bodyfile> <size> <priority> <leads-csv>

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

Rules:
- Plain markdown in every body file. No preamble, no headings the script
  writes for you, no code fences, no `<!-- bc: -->` markers, no `Closes #`.
- Both calls put the new issue on the board in `Backlog`, on no sprint. That
  is correct: `starting-next-sprint` scopes it later. Never set Status,
  Priority, Size or a sprint yourself, and never create an issue any other
  way.
- Base everything on the feedback and the backlog you were given. Do not
  invent work Adrian did not ask for.
- Do not comment on the demo issue and do not move it — the script does that
  once your work is on the board.

If a call exits non-zero, report what it printed and stop. Otherwise reply
with the issue numbers you opened. Your reply is not the artefact; the
backlog is.
